const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createRequirement,
  getAllRequirements,
  getRequirementsByMerchantType,
  getRequirementById,
  updateRequirement,
  deleteRequirement,
} = require('../controllers/requirementController');

router.get('/by-merchant-type/:merchantTypeId', protect, getRequirementsByMerchantType);
router.post('/', protect, createRequirement);
router.get('/', protect, getAllRequirements);
router.get('/:id', protect, getRequirementById);
router.put('/:id', protect, updateRequirement);
router.delete('/:id', protect, deleteRequirement);

module.exports = router;
