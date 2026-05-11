const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { protect } = require('../middleware/authMiddleware');
const {
  getRequirements, getAllMerchants, saveMerchant,
  uploadDocument, uploadUrl, getDocuments,
  getMerchant, deleteMerchant, deleteDocument,
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

module.exports = router;
