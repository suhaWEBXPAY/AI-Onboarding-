const db = require('../config/db');

const createMerchantType = async (req, res) => {
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Merchant type name is required.' });
  }

  try {
    const [existing] = await db.query(
      'SELECT id FROM merchant_types WHERE LOWER(name) = LOWER(?)',
      [name.trim()]
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: 'Merchant type already exists.' });
    }

    const [result] = await db.query(
      'INSERT INTO merchant_types (name) VALUES (?)',
      [name.trim()]
    );

    return res.status(201).json({
      message: 'Merchant type added successfully.',
      id: result.insertId,
    });
  } catch (err) {
    console.error('Create merchant type error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const getAllMerchantTypes = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM merchant_types ORDER BY created_at DESC'
    );
    return res.json(rows);
  } catch (err) {
    console.error('Get merchant types error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const getMerchantTypeById = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query('SELECT * FROM merchant_types WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Merchant type not found.' });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error('Get merchant type by id error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const updateMerchantType = async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Merchant type name is required.' });
  }

  try {
    const [existing] = await db.query('SELECT id FROM merchant_types WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Merchant type not found.' });
    }

    const [duplicate] = await db.query(
      'SELECT id FROM merchant_types WHERE LOWER(name) = LOWER(?) AND id != ?',
      [name.trim(), id]
    );
    if (duplicate.length > 0) {
      return res.status(409).json({ message: 'Merchant type name already exists.' });
    }

    await db.query('UPDATE merchant_types SET name = ? WHERE id = ?', [name.trim(), id]);
    return res.json({ message: 'Merchant type updated successfully.' });
  } catch (err) {
    console.error('Update merchant type error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const deleteMerchantType = async (req, res) => {
  const { id } = req.params;
  try {
    const [existing] = await db.query('SELECT id FROM merchant_types WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Merchant type not found.' });
    }

    const [linked] = await db.query(
      'SELECT id FROM merchant_requirements WHERE merchant_type_id = ? LIMIT 1',
      [id]
    );
    if (linked.length > 0) {
      return res.status(409).json({
        message: 'Cannot delete — this merchant type has requirements linked to it.',
      });
    }

    await db.query('DELETE FROM merchant_types WHERE id = ?', [id]);
    return res.json({ message: 'Merchant type deleted successfully.' });
  } catch (err) {
    console.error('Delete merchant type error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  createMerchantType,
  getAllMerchantTypes,
  getMerchantTypeById,
  updateMerchantType,
  deleteMerchantType,
};
