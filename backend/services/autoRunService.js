const db = require('../config/db');

let isRunning = false;
let lastRun = null;
let lastResults = [];

// Find merchants eligible for auto-analysis:
// 1. Newly onboarded today (onboarded_date = today) and not yet run today
// 2. Never analyzed but have a known onboarded_date (backfill)
const getEligibleMerchants = async () => {
  const [rows] = await db.query(`
    SELECT mi.mid
    FROM merchant_information mi
    LEFT JOIN (
      SELECT DISTINCT mid FROM merchant_document_json_data
      WHERE DATE(created_at) = CURDATE()
    ) ran_today ON ran_today.mid = mi.mid
    LEFT JOIN (
      SELECT DISTINCT mid FROM merchant_document_json_data
    ) ever_ran ON ever_ran.mid = mi.mid
    WHERE ran_today.mid IS NULL
      AND mi.onboarded_date IS NOT NULL
      AND mi.onboarded_date <= CURDATE()
      AND (
        DATE(mi.onboarded_date) = CURDATE()
        OR ever_ran.mid IS NULL
      )
  `);
  return rows.map((r) => r.mid);
};

const runAutoAnalysis = async (runFullAnalysisForMid) => {
  if (isRunning) {
    console.log('[autoRun] Already running, skipping.');
    return { skipped: true, running: true };
  }

  isRunning = true;
  console.log('[autoRun] Starting auto-analysis run...');

  try {
    const mids = await getEligibleMerchants();
    console.log(`[autoRun] ${mids.length} merchant(s) eligible.`);

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

module.exports = { runAutoAnalysis, getAutoRunStatus };
