const db = require('../config/db');

const createRequirement = async (req, res) => {
  const { merchant_type_id, required_docs, description, is_mandatory } = req.body;

  if (!merchant_type_id || !required_docs || !required_docs.trim()) {
    return res.status(400).json({ message: 'Merchant type and required document are required.' });
  }

  try {
    const [typeCheck] = await db.query('SELECT id FROM merchant_types WHERE id = ?', [merchant_type_id]);
    if (typeCheck.length === 0) {
      return res.status(404).json({ message: 'Merchant type not found.' });
    }

    const mandatory = is_mandatory !== undefined ? Boolean(is_mandatory) : true;

    const [result] = await db.query(
      'INSERT INTO merchant_requirements (merchant_type_id, required_docs, description, is_mandatory) VALUES (?, ?, ?, ?)',
      [merchant_type_id, required_docs.trim(), description ? description.trim() : null, mandatory]
    );

    return res.status(201).json({ message: 'Requirement added successfully.', id: result.insertId });
  } catch (err) {
    console.error('Create requirement error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const getAllRequirements = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        mr.id,
        mr.merchant_type_id,
        mt.name AS merchant_type,
        mr.required_docs,
        mr.description,
        mr.is_mandatory,
        mr.created_at,
        mr.updated_at
      FROM merchant_requirements mr
      JOIN merchant_types mt ON mr.merchant_type_id = mt.id
      ORDER BY mr.created_at DESC
    `);
    return res.json(rows);
  } catch (err) {
    console.error('Get requirements error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const getRequirementsByMerchantType = async (req, res) => {
  const { merchantTypeId } = req.params;
  try {
    const [rows] = await db.query(
      'SELECT id, required_docs, is_mandatory FROM merchant_requirements WHERE merchant_type_id = ? ORDER BY required_docs ASC',
      [merchantTypeId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Get requirements by merchant type error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const getRequirementById = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query(`
      SELECT
        mr.id,
        mr.merchant_type_id,
        mt.name AS merchant_type,
        mr.required_docs,
        mr.description,
        mr.is_mandatory,
        mr.created_at,
        mr.updated_at
      FROM merchant_requirements mr
      JOIN merchant_types mt ON mr.merchant_type_id = mt.id
      WHERE mr.id = ?
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Requirement not found.' });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error('Get requirement by id error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const updateRequirement = async (req, res) => {
  const { id } = req.params;
  const { merchant_type_id, required_docs, description, is_mandatory } = req.body;

  if (!merchant_type_id || !required_docs || !required_docs.trim()) {
    return res.status(400).json({ message: 'Merchant type and required document are required.' });
  }

  try {
    const [existing] = await db.query('SELECT id FROM merchant_requirements WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Requirement not found.' });
    }

    const [typeCheck] = await db.query('SELECT id FROM merchant_types WHERE id = ?', [merchant_type_id]);
    if (typeCheck.length === 0) {
      return res.status(404).json({ message: 'Merchant type not found.' });
    }

    const mandatory = is_mandatory !== undefined ? Boolean(is_mandatory) : true;

    await db.query(
      'UPDATE merchant_requirements SET merchant_type_id = ?, required_docs = ?, description = ?, is_mandatory = ?, updated_at = NOW() WHERE id = ?',
      [merchant_type_id, required_docs.trim(), description ? description.trim() : null, mandatory, id]
    );

    return res.json({ message: 'Requirement updated successfully.' });
  } catch (err) {
    console.error('Update requirement error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const deleteRequirement = async (req, res) => {
  const { id } = req.params;
  try {
    const [existing] = await db.query('SELECT id FROM merchant_requirements WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Requirement not found.' });
    }

    await db.query('DELETE FROM merchant_requirements WHERE id = ?', [id]);
    return res.json({ message: 'Requirement deleted successfully.' });
  } catch (err) {
    console.error('Delete requirement error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  createRequirement,
  getAllRequirements,
  getRequirementsByMerchantType,
  getRequirementById,
  updateRequirement,
  deleteRequirement,
};
