const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const REQUIRED_ENV = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'JWT_SECRET'];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.error('=== MISSING ENVIRONMENT VARIABLES ===');
  missingEnv.forEach((key) => console.error(`  MISSING: ${key}`));
  console.error('=====================================');
  console.error('Set these in backend/.env then restart.');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const authRoutes = require('./routes/authRoutes');
const merchantTypeRoutes = require('./routes/merchantTypeRoutes');
const requirementRoutes = require('./routes/requirementRoutes');
const onboardVerificationRoutes = require('./routes/onboardVerificationRoutes');

const db = require('./config/db');
const { runAutoAnalysis, invalidateMidCache } = require('./services/autoRunService');
const { runFullAnalysisForMid } = require('./controllers/onboardVerificationController');

const runMigrations = async () => {
  try {
    const [cols] = await db.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = 'merchant_information'
        AND COLUMN_NAME  = 'onboarded_date'
    `);
    if (cols.length === 0) {
      await db.query(`
        ALTER TABLE merchant_information
        ADD COLUMN onboarded_date DATE NULL DEFAULT NULL AFTER merchant_channel
      `);
      console.log('[migration] Added onboarded_date column to merchant_information.');
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS merchant_rule_overrides (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        mid             VARCHAR(100)  NOT NULL,
        rule_check_name VARCHAR(200)  NOT NULL,
        field_name      VARCHAR(300)  NOT NULL DEFAULT '',
        document_source VARCHAR(300)  NOT NULL DEFAULT '',
        comment         TEXT          NOT NULL,
        created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_override (mid, rule_check_name(100), field_name(100), document_source(100))
      )
    `);
    console.log('[migration] merchant_rule_overrides table ready.');
  } catch (err) {
    console.error('[migration] Error running migrations:', err.message);
  }
};

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/merchant-types', merchantTypeRoutes);
app.use('/api/requirements', requirementRoutes);
app.use('/api/onboard-verification', onboardVerificationRoutes);

app.get('/', (req, res) => {
  res.json({ message: 'AI-Onboarding-V2 API is running.' });
});

// Every 4 hours: analyze any merchants that still have no analysis record.
// Uses the cached WebXPay MID list — no fresh API fetch each time.
cron.schedule('0 */4 * * *', async () => {
  console.log('[cron] Scheduled auto-analysis triggered.');
  try {
    await runAutoAnalysis(runFullAnalysisForMid);
  } catch (err) {
    console.error('[cron] Auto-analysis error:', err.message);
  }
});

// Once a day at midnight: expire the cached MID list so the next auto-run
// re-fetches from WebXPay and picks up any newly onboarded merchants.
cron.schedule('0 0 * * *', () => {
  console.log('[cron] Invalidating WebXPay MID cache for daily refresh.');
  invalidateMidCache();
});

// On startup: run migrations, then kick off background analysis for any
// merchants that have never been analyzed. Runs non-blocking so the server
// is immediately available. Guarded by isRunning flag, so restarting mid-run is safe.
setTimeout(async () => {
  await runMigrations();
  console.log('[startup] Launching background auto-analysis for unanalyzed merchants...');
  runAutoAnalysis(runFullAnalysisForMid).then(({ skipped, ran, succeeded, failed }) => {
    if (skipped) return;
    console.log(`[startup] Auto-analysis complete: ${ran} analyzed, ${succeeded} succeeded, ${failed} failed.`);
  }).catch((err) => {
    console.error('[startup] Auto-analysis error:', err.message);
  });
}, 5000);

// Catch-all Express error handler — returns JSON instead of the default HTML error page.
// This fires if a route throws synchronously (e.g. res.json() serialization failure)
// or calls next(err). Without this, Express would return an HTML 500 page and the
// frontend would see no `message` in the response body.
app.use((err, req, res, next) => {
  console.error('[Express error handler]', err);
  if (res.headersSent) return next(err);
  res.status(err.statusCode || err.status || 500).json({
    message: err.message || 'Internal server error.',
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('=== UNHANDLED REJECTION ===', reason);
});

process.on('uncaughtException', (err) => {
  console.error('=== UNCAUGHT EXCEPTION — SERVER WILL RESTART ===');
  console.error(err);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
