require('dotenv').config();

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
const path = require('path');
const cron = require('node-cron');

const authRoutes = require('./routes/authRoutes');
const merchantTypeRoutes = require('./routes/merchantTypeRoutes');
const requirementRoutes = require('./routes/requirementRoutes');
const onboardVerificationRoutes = require('./routes/onboardVerificationRoutes');

const db = require('./config/db');
const { runAutoAnalysis } = require('./services/autoRunService');
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

// Daily auto-run at midnight: analyze merchants with onboarded_date = today
// and any merchants that have never been analyzed (backfill).
cron.schedule('0 0 * * *', async () => {
  console.log('[cron] Daily auto-analysis triggered.');
  try {
    await runAutoAnalysis(runFullAnalysisForMid);
  } catch (err) {
    console.error('[cron] Auto-analysis error:', err.message);
  }
});

// On startup: run migrations then backfill auto-analysis.
// Delay 5s to let the DB connection pool settle first.
setTimeout(async () => {
  await runMigrations();
  console.log('[startup] Running backfill auto-analysis for unanalyzed merchants...');
  try {
    await runAutoAnalysis(runFullAnalysisForMid);
  } catch (err) {
    console.error('[startup] Auto-analysis error:', err.message);
  }
}, 5000);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
