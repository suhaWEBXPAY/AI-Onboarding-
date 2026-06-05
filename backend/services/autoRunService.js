const db = require('../config/db');

let isRunning = false;
let lastRun = null;
let lastResults = [];

// Cached list of all MIDs from WebXPay — fetched once, reused until stale.
let cachedMids = null;
let cacheTimestamp = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // refresh once per day

// Paginate through the entire WebXPay merchant list and return all MIDs.
// Results are cached for 24 hours so the API is not hit on every cron tick.
const loadAllMidsFromWebXPay = async () => {
  const now = Date.now();
  if (cachedMids && cacheTimestamp && now - cacheTimestamp < CACHE_TTL_MS) {
    console.log(`[autoRun] Using cached WebXPay MID list (${cachedMids.length} MIDs).`);
    return cachedMids;
  }

  const token = process.env.WEBXPAY_TOKEN;
  const cookie = process.env.WEBXPAY_COOKIE;
  if (!token || !cookie) {
    console.warn('[autoRun] WebXPay credentials not configured — skipping WebXPay discovery.');
    return [];
  }

  const fetch = require('node-fetch');
  const mids = [];
  let page = 1;

  console.log('[autoRun] Fetching all merchants from WebXPay...');
  while (true) {
    try {
      const url = new URL('https://signup.webxpay.com/api/merchant-manager/approval-view-list');
      url.searchParams.set('page', page);

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          Cookie: cookie,
        },
        redirect: 'follow',
        timeout: 30000,
      });

      if (!res.ok) {
        console.warn(`[autoRun] WebXPay returned ${res.status} on page ${page}, stopping.`);
        break;
      }

      const data = await res.json();
      const items = data?.data || [];
      if (!items.length) break;

      items.forEach((m) => { if (m.id) mids.push(Number(m.id)); });
      console.log(`[autoRun] Page ${page}: ${items.length} merchants (total so far: ${mids.length})`);

      if (!data?.meta?.next_page_url) break;
      page++;
    } catch (err) {
      console.warn(`[autoRun] WebXPay page ${page} fetch failed: ${err.message}`);
      break;
    }
  }

  cachedMids = mids;
  cacheTimestamp = Date.now();
  console.log(`[autoRun] WebXPay sync complete: ${mids.length} MIDs across ${page} page(s).`);
  return mids;
};

// Invalidate the cache so the next run re-fetches from WebXPay.
// Called once per day from the scheduled sync cron in server.js.
const invalidateMidCache = () => {
  cachedMids = null;
  cacheTimestamp = null;
};

// Return MIDs that have never been analyzed (no row in merchant_document_json_data).
// Combines locally-known merchants with the WebXPay-discovered list.
const getUnanalyzedMids = async (webxpayMids) => {
  const [analyzed] = await db.query('SELECT DISTINCT mid FROM merchant_document_json_data');
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
  console.log('[autoRun] Starting auto-analysis run...');

  try {
    const webxpayMids = await loadAllMidsFromWebXPay();
    const mids = await getUnanalyzedMids(webxpayMids);
    console.log(`[autoRun] ${mids.length} merchant(s) need analysis.`);

    const results = [];
    for (const mid of mids) {
      try {
        console.log(`[autoRun] Analyzing MID: ${mid}`);
        await runFullAnalysisForMid(mid);
        results.push({ mid, status: 'success' });
      } catch (err) {
        console.error(`[autoRun] Failed MID: ${mid} — ${err.message}`);
        results.push({ mid, status: 'error', error: err.message });
      }
    }

    const succeeded = results.filter((r) => r.status === 'success').length;
    const failed = results.filter((r) => r.status === 'error').length;
    console.log(`[autoRun] Done. ${succeeded} succeeded, ${failed} failed.`);

    lastRun = new Date().toISOString();
    lastResults = results;

    return { ran: results.length, succeeded, failed, results };
  } finally {
    isRunning = false;
  }
};

const getAutoRunStatus = () => ({
  running: isRunning,
  lastRun,
  results: lastResults,
});

module.exports = { runAutoAnalysis, getAutoRunStatus, invalidateMidCache };
