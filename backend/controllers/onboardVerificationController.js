const db = require('../config/db');
const path = require('path');
const fs = require('fs');

const getRequirements = async (req, res) => {
  const { merchantTypeId } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT id, merchant_type_id, required_docs, description, is_mandatory
       FROM merchant_requirements
       WHERE merchant_type_id = ?
       ORDER BY is_mandatory DESC, required_docs ASC`,
      [merchantTypeId]
    );
    return res.json(rows);
  } catch (err) {
    console.error('getRequirements error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const saveMerchant = async (req, res) => {
  const { mid, merchant_business_name, merchant_type_id, merchant_channel } = req.body;

  if (!mid || !merchant_business_name?.trim() || !merchant_type_id || !merchant_channel) {
    return res.status(400).json({ message: 'MID, business name, merchant type, and channel are required.' });
  }

  try {
    const [typeCheck] = await db.query('SELECT id FROM merchant_types WHERE id = ?', [merchant_type_id]);
    if (typeCheck.length === 0) {
      return res.status(404).json({ message: 'Merchant type not found.' });
    }

    await db.query(
      `INSERT INTO merchant_information (mid, merchant_business_name, merchant_type_id, merchant_channel, created_at, updated_at)
       VALUES (?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         merchant_business_name = VALUES(merchant_business_name),
         merchant_type_id       = VALUES(merchant_type_id),
         merchant_channel       = VALUES(merchant_channel),
         updated_at             = NOW()`,
      [mid, merchant_business_name.trim(), merchant_type_id, merchant_channel]
    );

    return res.json({ message: 'Merchant information saved.', mid });
  } catch (err) {
    console.error('saveMerchant error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const uploadDocument = async (req, res) => {
  const { mid, merchant_requirement_id, document_type, is_mandatory } = req.body;

  if (!mid || !merchant_requirement_id || !document_type || !req.file) {
    return res.status(400).json({ message: 'MID, requirement, document type, and file are required.' });
  }

  try {
    const [merchantCheck] = await db.query('SELECT mid FROM merchant_information WHERE mid = ?', [mid]);
    if (merchantCheck.length === 0) {
      return res.status(404).json({ message: 'Merchant not found. Save merchant information first.' });
    }

    const dir = path.join(__dirname, '../uploads', String(mid));
    fs.mkdirSync(dir, { recursive: true });

    const sanitized = req.file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '-').toLowerCase();
    const filename = `${Date.now()}-${sanitized}`;
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, req.file.buffer);

    const uploadPath = `uploads/${mid}/${filename}`;
    const mandatory = is_mandatory === 'true' || is_mandatory === true;

    await db.query(
      `INSERT INTO merchant_document (mid, merchant_requirement_id, document_type, upload_path, is_mandatory, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         document_type = VALUES(document_type),
         upload_path   = VALUES(upload_path),
         is_mandatory  = VALUES(is_mandatory),
         updated_at    = NOW()`,
      [mid, merchant_requirement_id, document_type, uploadPath, mandatory]
    );

    return res.json({ message: 'Document uploaded successfully.', upload_path: uploadPath });
  } catch (err) {
    console.error('uploadDocument error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const getDocuments = async (req, res) => {
  const { mid } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT
         md.id,
         md.mid,
         md.merchant_requirement_id,
         md.document_type,
         md.upload_path,
         md.is_mandatory,
         md.created_at,
         md.updated_at,
         mr.required_docs,
         mr.description
       FROM merchant_document md
       JOIN merchant_requirements mr ON md.merchant_requirement_id = mr.id
       WHERE md.mid = ?
       ORDER BY md.created_at DESC`,
      [mid]
    );
    return res.json(rows);
  } catch (err) {
    console.error('getDocuments error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const getAllMerchants = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT mi.mid, mi.merchant_business_name, mi.merchant_channel,
              mi.merchant_type_id, mt.name AS merchant_type_name,
              mi.created_at, mi.updated_at
       FROM merchant_information mi
       JOIN merchant_types mt ON mi.merchant_type_id = mt.id
       ORDER BY mi.created_at DESC`
    );
    return res.json(rows);
  } catch (err) {
    console.error('getAllMerchants error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const getMerchant = async (req, res) => {
  const { mid } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT mi.mid, mi.merchant_business_name, mi.merchant_type_id,
              mi.merchant_channel, mi.created_at, mi.updated_at,
              mt.name AS merchant_type_name
       FROM merchant_information mi
       JOIN merchant_types mt ON mi.merchant_type_id = mt.id
       WHERE mi.mid = ?`,
      [mid]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Merchant not found.' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('getMerchant error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const deleteMerchant = async (req, res) => {
  const { mid } = req.params;
  try {
    const [existing] = await db.query('SELECT mid FROM merchant_information WHERE mid = ?', [mid]);
    if (existing.length === 0) return res.status(404).json({ message: 'Merchant not found.' });

    await db.query('DELETE FROM merchant_document WHERE mid = ?', [mid]);
    await db.query('DELETE FROM merchant_information WHERE mid = ?', [mid]);

    return res.json({ message: 'Merchant and all associated documents deleted.' });
  } catch (err) {
    console.error('deleteMerchant error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const uploadUrl = async (req, res) => {
  const { mid, merchant_requirement_id, document_type, is_mandatory, url } = req.body;
  if (!mid || !merchant_requirement_id || !document_type || !url?.trim())
    return res.status(400).json({ message: 'All fields and URL are required.' });
  try {
    const [mc] = await db.query('SELECT mid FROM merchant_information WHERE mid = ?', [mid]);
    if (mc.length === 0) return res.status(404).json({ message: 'Merchant not found.' });
    const mandatory = is_mandatory === true || is_mandatory === 'true';
    await db.query(
      `INSERT INTO merchant_document (mid, merchant_requirement_id, document_type, upload_path, is_mandatory, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         document_type = VALUES(document_type), upload_path = VALUES(upload_path),
         is_mandatory = VALUES(is_mandatory), updated_at = NOW()`,
      [mid, merchant_requirement_id, document_type, url.trim(), mandatory]
    );
    return res.json({ message: 'URL saved.', upload_path: url.trim() });
  } catch (err) {
    console.error('uploadUrl error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const deleteDocument = async (req, res) => {
  const { id } = req.params;
  try {
    const [existing] = await db.query('SELECT id FROM merchant_document WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Document not found.' });

    await db.query('DELETE FROM merchant_document WHERE id = ?', [id]);
    return res.json({ message: 'Document record deleted.' });
  } catch (err) {
    console.error('deleteDocument error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  getRequirements, getAllMerchants, saveMerchant,
  uploadDocument, uploadUrl, getDocuments,
  getMerchant, deleteMerchant, deleteDocument,
};
