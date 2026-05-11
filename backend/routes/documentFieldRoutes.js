const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createDocumentField,
  getAllDocumentFields,
  getDocumentFieldById,
  updateDocumentField,
  deleteDocumentField,
} = require('../controllers/documentFieldController');

router.post('/', protect, createDocumentField);
router.get('/', protect, getAllDocumentFields);
router.get('/:id', protect, getDocumentFieldById);
router.put('/:id', protect, updateDocumentField);
router.delete('/:id', protect, deleteDocumentField);

module.exports = router;
