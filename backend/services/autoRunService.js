const db = require('../config/db');

// How many merchants are analyzed simultaneously. Each analysis spends most of
// its time waiting on OpenAI / document downloads, so high parallelism is safe
// for the Node process; tune down via env if OpenAI rate limits start biting.
const CONCURRENCY = Math.max(1, Number(process.env.AUTO_RUN_CONCURRENCY) || 10);

let isRunning = false;
let stopRequested = false;
let lastRun = null;
let lastResults = [];
let progress = { done: 0, total: 0 };
// MIDs currently being analyzed and results completed so far in the active run —
// exposed via the status endpoint so the UI can show a per-merchant spinner.
const currentMids = new Set();
let liveResults = [];

// Cached list of all merchants from WebXPay — fetched once, reused until stale.
let cachedMerchants = null;
let cacheTimestamp = null;
let inFlightLoad = null; // concurrent callers share one fetch
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // refresh once per day
const PAGE_CONCURRENCY = 6;

const fetchWebxpayListPage = async (page) => {
  const fetch = require('node-fetch');
  const url = new URL('https://signup.webxpay.com/api/merchant-manager/approval-view-list');
  url.searchParams.set('page', page);
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${process.env.WEBXPAY_TOKEN}`,
      Cookie: process.env.WEBXPAY_COOKIE,
    },
    redirect: 'follow',
    timeout: 30000,
  });
  if (!res.ok) throw new Error(`WebXPay returned ${res.status} on page ${page}`);
  return res.json();
};

// Paginate through the entire WebXPay merchant list and return the full items.
// NOTE: the approval-view-list meta has NO next_page_url — it exposes last_page
// (e.g. { current_page, per_page, total, last_page }), so pagination must be
// driven by last_page. Pages 2..last are fetched in parallel batches.
// Results are cached for 24 hours so the API is not hit on every request.
const loadAllMerchantsFromWebXPay = async () => {
  const now = Date.now();
  if (cachedMerchants && cacheTimestamp && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedMerchants;
  }
  if (inFlightLoad) return inFlightLoad;

  const token = process.env.WEBXPAY_TOKEN;
  const cookie = process.env.WEBXPAY_COOKIE;
  if (!token || !cookie) {
    console.warn('[autoRun] WebXPay credentials not configured — skipping WebXPay discovery.');
    return [];
  }

  inFlightLoad = (async () => {
    try {
      console.log('[autoRun] Fetching all merchants from WebXPay...');
      const first = await fetchWebxpayListPage(1);
      const merchants = (first?.data || []).filter((m) => m?.id);
      const lastPage = Number(first?.meta?.last_page) || 1;

      let nextPage = 2;
      let failedPages = 0;
      const worker = async () => {
        while (nextPage <= lastPage) {
          const page = nextPage++;
          try {
            const data = await fetchWebxpayListPage(page);
            (data?.data || []).forEach((m) => { if (m?.id) merchants.push(m); });
          } catch (err) {
            failedPages++;
            console.warn(`[autoRun] WebXPay page ${page} fetch failed: ${err.message}`);
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(PAGE_CONCURRENCY, Math.max(0, lastPage - 1)) }, () => worker())
      );

      console.log(`[autoRun] WebXPay sync complete: ${merchants.length} merchants across ${lastPage} page(s)${failedPages ? ` (${failedPages} page(s) failed)` : ''}.`);
      cachedMerchants = merchants;
      cacheTimestamp = Date.now();
      return merchants;
    } catch (err) {
      // Page 1 failed — don't cache, so the next request retries.
      console.warn(`[autoRun] WebXPay merchant list fetch failed: ${err.message}`);
      return cachedMerchants || [];
    } finally {
      inFlightLoad = null;
    }
  })();

  return inFlightLoad;
};

const loadAllMidsFromWebXPay = async () => {
  const merchants = await loadAllMerchantsFromWebXPay();
  return merchants.map((m) => Number(m.id)).filter(Boolean);
};

// Invalidate the cache so the next run re-fetches from WebXPay.
// Called once per day from the scheduled sync cron in server.js.
const invalidateMidCache = () => {
  cachedMerchants = null;
  cacheTimestamp = null;
};

// Return MIDs without a completed analysis. A row with can_onboard NULL means a
// previous run started but never produced a verdict (shown as "Pending" in the
// UI), so those merchants are picked up again alongside never-analyzed ones.
// Combines locally-known merchants with the WebXPay-discovered list.
const getUnanalyzedMids = async (webxpayMids) => {
  const [analyzed] = await db.query(
    'SELECT DISTINCT mid FROM merchant_document_json_data WHERE can_onboard IS NOT NULL'
  );
  const analyzedSet = new Set(analyzed.map((r) => Number(r.mid)));

  const [localMerchants] = await db.query('SELECT mid FROM merchant_information');
  const eligible = new Set(
    localMerchants.map((r) => Number(r.mid)).filter((mid) => !analyzedSet.has(mid))
  );

  webxpayMids.forEach((mid) => {
    if (!analyzedSet.has(mid)) eligible.add(mid);
  });

  return [...eligible];
};

const runAutoAnalysis = async (runFullAnalysisForMid) => {
  if (isRunning) {
    console.log('[autoRun] Already running, skipping.');
    return { skipped: true, running: true };
  }

  isRunning = true;
  stopRequested = false;
  console.log('[autoRun] Starting auto-analysis run...');

  try {
    const webxpayMids = await loadAllMidsFromWebXPay();
    const mids = await getUnanalyzedMids(webxpayMids);
    console.log(`[autoRun] ${mids.length} merchant(s) need analysis (concurrency: ${CONCURRENCY}).`);

    progress = { done: 0, total: mids.length };
    currentMids.clear();
    liveResults = [];
    const results = liveResults;
    let nextIndex = 0;

    // Worker pool: up to CONCURRENCY analyses in flight at once, each worker
    // pulling the next MID as soon as it finishes its current one. A stop
    // request lets in-flight analyses finish but nothing new is picked up.
    const worker = async () => {
      while (!stopRequested && nextIndex < mids.length) {
        const mid = mids[nextIndex++];
        currentMids.add(mid);
        try {
          console.log(`[autoRun] Analyzing MID: ${mid}`);
          await runFullAnalysisForMid(mid);
          results.push({ mid, status: 'success' });
        } catch (err) {
          console.error(`[autoRun] Failed MID: ${mid} — ${err.message}`);
          results.push({ mid, status: 'error', error: err.message });
        } finally {
          currentMids.delete(mid);
        }
        progress.done += 1;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, mids.length) }, () => worker())
    );

    const succeeded = results.filter((r) => r.status === 'success').length;
    const failed = results.filter((r) => r.status === 'error').length;
    const skipped = mids.length - results.length;
    console.log(`[autoRun] ${stopRequested ? 'Stopped by user' : 'Done'}. ${succeeded} succeeded, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}.`);

    lastRun = new Date().toISOString();
    lastResults = results;

    return { ran: results.length, succeeded, failed, skipped, stopped: stopRequested, results };
  } finally {
    isRunning = false;
    stopRequested = false;
    currentMids.clear();
  }
};

// Ask the active run to stop: in-flight analyses finish, queued MIDs are skipped.
// Returns false when no run is active.
const stopAutoRun = () => {
  if (!isRunning) return false;
  stopRequested = true;
  console.log('[autoRun] Stop requested — finishing in-flight analyses, skipping the rest.');
  return true;
};

const getAutoRunStatus = () => ({
  running: isRunning,
  stopping: isRunning && stopRequested,
  lastRun,
  progress,
  currentMids: [...currentMids],
  results: isRunning ? liveResults : lastResults,
});

module.exports = { runAutoAnalysis, getAutoRunStatus, stopAutoRun, invalidateMidCache, loadAllMerchantsFromWebXPay };
