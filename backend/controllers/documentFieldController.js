const db = require('../config/db');

const createDocumentField = async (req, res) => {
  const { merchant_requirement_id, field_name, field_label, field_type, is_required } = req.body;

  if (!merchant_requirement_id || !field_name?.trim() || !field_label?.trim() || !field_type) {
    return res.status(400).json({ message: 'Requirement, field name, field label, and field type are required.' });
  }

  const validTypes = ['text', 'textarea', 'number', 'email', 'date', 'dropdown'];
  if (!validTypes.includes(field_type)) {
    return res.status(400).json({ message: 'Invalid field type.' });
  }

  try {
    const [reqCheck] = await db.query('SELECT id FROM merchant_requirements WHERE id = ?', [merchant_requirement_id]);
    if (reqCheck.length === 0) {
      return res.status(404).json({ message: 'Requirement not found.' });
    }

    const [dup] = await db.query(
      'SELECT id FROM merchant_document_fields WHERE merchant_requirement_id = ? AND LOWER(field_name) = LOWER(?)',
      [merchant_requirement_id, field_name.trim()]
    );
    if (dup.length > 0) {
      return res.status(409).json({ message: 'A field with this name already exists for this document.' });
    }

    const required = is_required !== undefined ? Boolean(is_required) : true;

    const [result] = await db.query(
      'INSERT INTO merchant_document_fields (merchant_requirement_id, field_name, field_label, field_type, is_required) VALUES (?, ?, ?, ?, ?)',
      [merchant_requirement_id, field_name.trim(), field_label.trim(), field_type, required]
    );

    return res.status(201).json({ message: 'Document field added successfully.', id: result.insertId });
  } catch (err) {
    console.error('Create document field error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const getAllDocumentFields = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        df.id,
        df.merchant_requirement_id,
        mr.required_docs AS document_name,
        mr.merchant_type_id,
        mt.name AS merchant_type,
        df.field_name,
        df.field_label,
        df.field_type,
        df.is_required,
        df.created_at
      FROM merchant_document_fields df
      JOIN merchant_requirements mr ON df.merchant_requirement_id = mr.id
      JOIN merchant_types mt ON mr.merchant_type_id = mt.id
      ORDER BY mt.name ASC, mr.required_docs ASC, df.field_name ASC
    `);
    return res.json(rows);
  } catch (err) {
    console.error('Get document fields error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const getDocumentFieldById = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query(`
      SELECT
        df.id,
        df.merchant_requirement_id,
        mr.required_docs AS document_name,
        mr.merchant_type_id,
        mt.name AS merchant_type,
        df.field_name,
        df.field_label,
        df.field_type,
        df.is_required,
        df.created_at
      FROM merchant_document_fields df
      JOIN merchant_requirements mr ON df.merchant_requirement_id = mr.id
      JOIN merchant_types mt ON mr.merchant_type_id = mt.id
      WHERE df.id = ?
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Document field not found.' });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error('Get document field by id error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const updateDocumentField = async (req, res) => {
  const { id } = req.params;
  const { merchant_requirement_id, field_name, field_label, field_type, is_required } = req.body;

  if (!merchant_requirement_id || !field_name?.trim() || !field_label?.trim() || !field_type) {
    return res.status(400).json({ message: 'All fields are required.' });
  }

  const validTypes = ['text', 'textarea', 'number', 'email', 'date', 'dropdown'];
  if (!validTypes.includes(field_type)) {
    return res.status(400).json({ message: 'Invalid field type.' });
  }

  try {
    const [existing] = await db.query('SELECT id FROM merchant_document_fields WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Document field not found.' });
    }

    const [dup] = await db.query(
      'SELECT id FROM merchant_document_fields WHERE merchant_requirement_id = ? AND LOWER(field_name) = LOWER(?) AND id != ?',
      [merchant_requirement_id, field_name.trim(), id]
    );
    if (dup.length > 0) {
      return res.status(409).json({ message: 'A field with this name already exists for this document.' });
    }

    const required = is_required !== undefined ? Boolean(is_required) : true;

    await db.query(
      'UPDATE merchant_document_fields SET merchant_requirement_id = ?, field_name = ?, field_label = ?, field_type = ?, is_required = ? WHERE id = ?',
      [merchant_requirement_id, field_name.trim(), field_label.trim(), field_type, required, id]
    );

    return res.json({ message: 'Document field updated successfully.' });
  } catch (err) {
    console.error('Update document field error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const deleteDocumentField = async (req, res) => {
  const { id } = req.params;
  try {
    const [existing] = await db.query('SELECT id FROM merchant_document_fields WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Document field not found.' });
    }

    await db.query('DELETE FROM merchant_document_fields WHERE id = ?', [id]);
    return res.json({ message: 'Document field deleted successfully.' });
  } catch (err) {
    console.error('Delete document field error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  createDocumentField,
  getAllDocumentFields,
  getDocumentFieldById,
  updateDocumentField,
  deleteDocumentField,
};
