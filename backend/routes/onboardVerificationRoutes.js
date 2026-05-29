const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { protect } = require('../middleware/authMiddleware');
const {
  getRequirements, getAllMerchants, saveMerchant,
  uploadDocument, uploadUrl, getDocuments,
  getMerchant, deleteMerchant, deleteDocument,
  runDataVerification, fetchExternalMerchant, runAiAnalysis, getLatestAnalysis,
  runFullApiVerification, getAiUsage,
  triggerAutoRun, getAutoRunStatusHandler,
} = require('../controllers/onboardVerificationController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(pdf|jpg|jpeg|png)$/i;
    if (allowed.test(path.extname(file.originalname))) return cb(null, true);
    cb(new Error('Only PDF, JPG, and PNG files are allowed.'));
  },
});

router.get('/requirements/:merchantTypeId', protect, getRequirements);
router.get('/merchants',                    protect, getAllMerchants);
router.get('/merchant/:mid',                protect, getMerchant);
router.post('/merchant',                    protect, saveMerchant);
router.delete('/merchant/:mid',             protect, deleteMerchant);
router.post('/upload',                      protect, upload.single('file'), uploadDocument);
router.post('/upload-url',                  protect, uploadUrl);
router.get('/documents/:mid',               protect, getDocuments);
router.delete('/document/:id',              protect, deleteDocument);
router.post('/verify-data',                 protect, runDataVerification);
router.get('/external-merchant/:mid',       protect, fetchExternalMerchant);
router.post('/verify-mid/:mid',            protect, runFullApiVerification);
router.post('/analyze/:mid',               protect, runAiAnalysis);
router.get('/latest-analysis/:mid',        protect, getLatestAnalysis);
router.get('/ai-usage',                    protect, getAiUsage);
router.post('/auto-run',                   protect, triggerAutoRun);
router.get('/auto-run-status',             protect, getAutoRunStatusHandler);

module.exports = router;
