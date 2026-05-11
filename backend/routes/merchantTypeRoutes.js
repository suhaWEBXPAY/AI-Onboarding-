const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createMerchantType,
  getAllMerchantTypes,
  getMerchantTypeById,
  updateMerchantType,
  deleteMerchantType,
} = require('../controllers/merchantTypeController');

router.post('/', protect, createMerchantType);
router.get('/', protect, getAllMerchantTypes);
router.get('/:id', protect, getMerchantTypeById);
router.put('/:id', protect, updateMerchantType);
router.delete('/:id', protect, deleteMerchantType);

module.exports = router;
