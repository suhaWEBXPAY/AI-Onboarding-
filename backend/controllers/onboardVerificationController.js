const db = require('../config/db');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { buildVerificationReport, patchReportCompatibleMismatches } = require('../services/verificationEngine');
const { analyzeDocuments, verifyCrossDocumentMismatches } = require('../services/documentAnalyzer');
const { getUsage, getRemainingBudget } = require('../services/costTracker');

const UPLOADS_ROOT = path.join(__dirname, '..');

// WebXPay business_type.type_of_business_id → DB merchant_type name keyword
const WEBXPAY_TYPE_KEYWORDS = {
  1: 'private',      // Private Limited / Public Limited Company
  2: 'proprietor',   // Proprietorship / Sole Proprietor
  3: 'partnership',  // Partnership
  4: 'society',      // Society / Club / Association
  5: 'individual',   // Individual
};

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
              mi.onboarded_date,
              mi.created_at, mi.updated_at,
              latest.created_at AS latest_analysis_at,
              latest.can_onboard,
              latest.satisfaction_score
       FROM merchant_information mi
       JOIN merchant_types mt ON mi.merchant_type_id = mt.id
       LEFT JOIN merchant_document_json_data latest
         ON latest.mid = mi.mid
        AND latest.created_at = (
          SELECT MAX(mdjd.created_at)
          FROM merchant_document_json_data mdjd
          WHERE mdjd.mid = mi.mid
        )
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
              mi.merchant_channel, mi.onboarded_date, mi.created_at, mi.updated_at,
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

const getRequirementRulesForMerchantType = async (merchantTypeId) => {
  const [requirements] = await db.query(
    `SELECT id, merchant_type_id, required_docs, description, is_mandatory
     FROM merchant_requirements
     WHERE merchant_type_id = ?
     ORDER BY is_mandatory DESC, required_docs ASC`,
    [merchantTypeId]
  );

  return requirements.map((requirement) => ({
    ...requirement,
    is_mandatory: Boolean(requirement.is_mandatory),
  }));
};

const computeSatisfactionScore = (summary) => {
  const matched = summary.matchedFields || 0;
  const issues = (summary.missingData || 0) + (summary.invalidData || 0) + (summary.mismatches || 0);
  const total = matched + issues;
  if (total === 0) return 100;
  return Math.round((matched / total) * 100);
};

const normalizeSystemDataForVerification = (systemData) => {
  let normalizedSystemData = systemData;
  let uploadedDocNames = [];
  let apiDocLabels = [];

  if (systemData?.success === true && systemData?.data?.business_information) {
    const d = systemData.data;
    normalizedSystemData = {
      business_information: d.business_information,
      stakeholders: d.stakeholders,
      bank_account: d.bank_account,
      kyc: d.kyc,
      location: d.location,
    };

    if (Array.isArray(d.all_documents)) {
      d.all_documents.forEach((doc) => {
        if (['outlet', 'outlets'].includes(String(doc.source || '').toLowerCase().trim())) return;
        if (doc.document_name) uploadedDocNames.push(doc.document_name.replace(/_/g, ' '));
        if (doc.label) uploadedDocNames.push(doc.label.toLowerCase());
        if (doc.source) uploadedDocNames.push(doc.source);
        const label = doc.label || (doc.document_name ? doc.document_name.replace(/_/g, ' ') : null);
        if (label) apiDocLabels.push(label);
        // Stakeholder ID documents: labels like "ID Copy (Director Front)" don't token-match
        // requirements like "NIC / Passport / DL" because "director"/"front" pollute the token set.
        // Add generic identity keywords so the requirement presence check passes.
        if (String(doc.source || '').toLowerCase() === 'stakeholder') {
          const labelLower = String(label || '').toLowerCase();
          if (labelLower.includes('id') || labelLower.includes('nic') || labelLower.includes('identity')) {
            uploadedDocNames.push('national identity card');
            uploadedDocNames.push('nic');
          }
          if (labelLower.includes('passport')) uploadedDocNames.push('passport');
          if (labelLower.includes('driving') || labelLower.includes(' dl') || labelLower.includes('license') || labelLower.includes('licence')) {
            uploadedDocNames.push('driving licence');
          }
        }
      });
    }

    if (Array.isArray(d.documents)) {
      d.documents
        .filter((doc) => doc.upload_status !== 0)
        .forEach((doc) => {
          if (doc.document_name) uploadedDocNames.push(doc.document_name.replace(/_/g, ' '));
          if (doc.file_detail) uploadedDocNames.push(doc.file_detail);
        });
    }

    if (
      d.bank_account?.three_month_bank_statement
      || d.bank_account?.three_month_bank_statement_url
      || d.bank_account?.supporting_document_uploaded
    ) {
      uploadedDocNames.push('bank statement', 'three month bank statement');
    }

    if (Array.isArray(d.stakeholders)) {
      d.stakeholders.forEach((stakeholder) => {
        if (stakeholder.id_copy_director || stakeholder.id_copy_director_url) {
          uploadedDocNames.push((stakeholder.document_type || 'nic').toLowerCase());
          uploadedDocNames.push('national identity card');
        }
        if (stakeholder.passport_copy || stakeholder.passport_copy_url) uploadedDocNames.push('passport');
      });
    }
  }

  return {
    normalizedSystemData,
    uploadedDocNames: uploadedDocNames.filter(Boolean),
    apiDocLabels,
  };
};

const fetchWebxpayApprovalView = async (mid) => {
  const token = process.env.WEBXPAY_TOKEN;
  const cookie = process.env.WEBXPAY_COOKIE;

  if (!token || !cookie) {
    const err = new Error('WebXPay credentials not configured on server.');
    err.statusCode = 500;
    throw err;
  }

  let response;
  try {
    response = await fetch(
      `https://signup.webxpay.com/api/merchant-manager/approval-view/${encodeURIComponent(mid)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          Cookie: cookie,
        },
        redirect: 'follow',
        timeout: 30000,
      }
    );
  } catch (fetchErr) {
    if (fetchErr.type === 'request-timeout') {
      const err = new Error('WebXPay API request timed out. Please try again.');
      err.statusCode = 504;
      throw err;
    }
    throw fetchErr;
  }

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const err = new Error('WebXPay returned non-JSON response.');
    err.statusCode = 502;
    err.raw = text.slice(0, 500);
    throw err;
  }

  if (!response.ok) {
    const err = new Error('WebXPay API error.');
    err.statusCode = response.status;
    err.data = data;
    throw err;
  }

  return data;
};

// Extract onboarded_date from WebXPay response
// Confirmed path: data.signup.onboarded_date (e.g. "2026-05-14")
const extractOnboardedDate = (webxpayData) => {
  const candidates = [
    webxpayData?.data?.signup?.onboarded_date,
    webxpayData?.data?.onboarded_date,
    webxpayData?.data?.business_information?.onboarded_date,
    webxpayData?.data?.signup?.approved_date,
    webxpayData?.data?.signup?.completed_at,
  ];
  for (const val of candidates) {
    if (val) return val;
  }
  return null;
};

const resolveMerchantContext = async (mid, webxpayData, merchantTypeIdFromRequest) => {
  const bizInfo = webxpayData?.data?.business_information || {};
  let merchantTypeId = merchantTypeIdFromRequest || null;
  let merchantTypeName = 'Private Limited';

  if (merchantTypeId) {
    const [typeRows] = await db.query('SELECT id, name FROM merchant_types WHERE id = ?', [merchantTypeId]);
    if (typeRows.length > 0) {
      merchantTypeName = typeRows[0].name;
    } else {
      merchantTypeId = null;
    }
  }

  if (!merchantTypeId) {
    const [merchantRows] = await db.query(
      `SELECT mi.merchant_type_id, mt.name AS merchant_type_name
       FROM merchant_information mi
       JOIN merchant_types mt ON mi.merchant_type_id = mt.id
       WHERE mi.mid = ?`,
      [mid]
    );

    if (merchantRows.length > 0) {
      merchantTypeId = merchantRows[0].merchant_type_id;
      merchantTypeName = merchantRows[0].merchant_type_name;
    }
  }

  if (!merchantTypeId) {
    const webxpayTypeId = webxpayData?.data?.business_type?.type_of_business_id;
    const keyword = WEBXPAY_TYPE_KEYWORDS[Number(webxpayTypeId)]
      || String(bizInfo.merchant_type || bizInfo.business_type || merchantTypeName).toLowerCase().split(' ')[0];

    const [typeRows] = await db.query(
      'SELECT id, name FROM merchant_types WHERE LOWER(name) LIKE ? LIMIT 1',
      [`%${keyword}%`]
    );
    if (typeRows.length > 0) {
      merchantTypeId = typeRows[0].id;
      merchantTypeName = typeRows[0].name;
    }
  }

  const businessName = bizInfo.name_of_company_business
    || bizInfo.registered_name_of_business
    || `Merchant ${mid}`;

  const onboardedDate = extractOnboardedDate(webxpayData);

  if (merchantTypeId) {
    await db.query(
      `INSERT INTO merchant_information
         (mid, merchant_business_name, merchant_type_id, merchant_channel, onboarded_date, created_at, updated_at)
       VALUES (?, ?, ?, 'IPG', ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         merchant_business_name = VALUES(merchant_business_name),
         merchant_type_id = VALUES(merchant_type_id),
         onboarded_date = COALESCE(VALUES(onboarded_date), onboarded_date),
         updated_at = NOW()`,
      [mid, businessName, merchantTypeId, onboardedDate]
    );
  }

  return {
    merchantTypeId,
    merchantTypeName,
    merchantType: merchantTypeId ? { id: merchantTypeId, name: merchantTypeName } : { id: null, name: merchantTypeName },
  };
};

const saveVerificationSnapshot = async ({ mid, merchantTypeName, documentData, report }) => {
  const canOnboard = report.status === 'verified' ? 1 : 0;
  const satisfactionScore = computeSatisfactionScore(report.summary);
  const extractedJson = JSON.stringify(documentData);
  const validationJson = JSON.stringify(report);

  try {
    const [existing] = await db.query(
      `SELECT id FROM merchant_document_json_data WHERE mid = ? ORDER BY created_at DESC LIMIT 1`,
      [mid || null]
    );

    if (existing.length > 0) {
      await db.query(
        `UPDATE merchant_document_json_data
         SET document_type = ?, extracted_json = ?, validation_json = ?, can_onboard = ?, satisfaction_score = ?
         WHERE id = ?`,
        [merchantTypeName, extractedJson, validationJson, canOnboard, satisfactionScore, existing[0].id]
      );
    } else {
      await db.query(
        `INSERT INTO merchant_document_json_data
           (mid, merchant_document_id, document_type, uploaded_file_path, extracted_json, validation_json, can_onboard, satisfaction_score)
         VALUES (?, NULL, ?, NULL, ?, ?, ?, ?)`,
        [mid || null, merchantTypeName, extractedJson, validationJson, canOnboard, satisfactionScore]
      );
    }
  } catch (err) {
    console.error('merchant_document_json_data upsert error:', err);
  }
};

const runDataVerification = async (req, res) => {
  const {
    mid,
    merchant_type_id,
    merchantTypeId,
    merchant_channel,
    merchantChannel,
    documentData,
    systemData,
  } = req.body;

  const selectedMerchantTypeId = merchant_type_id || merchantTypeId;

  if (!selectedMerchantTypeId) {
    return res.status(400).json({ message: 'Merchant type is required.' });
  }

  if (documentData === undefined || documentData === null || systemData === undefined || systemData === null) {
    return res.status(400).json({ message: 'Google AI document extraction data and external system API data are required.' });
  }

  try {
    const [merchantTypes] = await db.query('SELECT id, name FROM merchant_types WHERE id = ?', [selectedMerchantTypeId]);
    if (merchantTypes.length === 0) {
      return res.status(404).json({ message: 'Merchant type not found.' });
    }

    const requirements = await getRequirementRulesForMerchantType(selectedMerchantTypeId);

    const { normalizedSystemData, uploadedDocNames, apiDocLabels } = normalizeSystemDataForVerification(systemData);

    let report = buildVerificationReport({
      mid,
      merchantType: merchantTypes[0],
      merchantChannel: merchant_channel || merchantChannel,
      requirements,
      documentData,
      systemData: normalizedSystemData,
      uploadedDocNames,
      apiDocLabels,
    });

    const crossDocMismatches = (report.mismatches || []).filter((m) => m.category === 'ai_cross_document_mismatch');
    if (crossDocMismatches.length > 0) {
      const compatible = await verifyCrossDocumentMismatches(crossDocMismatches).catch(() => new Set());
      if (compatible.size > 0) report = patchReportCompatibleMismatches(report, compatible);
    }

    await saveVerificationSnapshot({
      mid,
      merchantTypeName: merchantTypes[0].name,
      documentData,
      report,
    });

    return res.json(report);
  } catch (err) {
    console.error('runDataVerification error:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Server error.' });
  }
};

const fetchExternalMerchant = async (req, res) => {
  const { mid } = req.params;
  if (!mid) return res.status(400).json({ message: 'MID is required.' });

  try {
    const data = await fetchWebxpayApprovalView(mid);
    return res.json(data);
  } catch (err) {
    console.error('fetchExternalMerchant error:', err);
    return res.status(err.statusCode || 500).json({
      message: err.message || 'Failed to reach WebXPay API.',
      data: err.data,
      raw: err.raw,
    });
  }
};

const getLatestAnalysis = async (req, res) => {
  const { mid } = req.params;
  if (!mid) return res.status(400).json({ message: 'MID is required.' });

  try {
    const [rows] = await db.query(
      `SELECT extracted_json, validation_json, can_onboard, satisfaction_score, created_at
       FROM merchant_document_json_data
       WHERE mid = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [mid]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'No analysis found for this MID.' });
    }
    return res.json(rows[0]);
  } catch (err) {
    console.error('getLatestAnalysis error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const runAiAnalysis = async (req, res) => {
  const { mid } = req.params;
  if (!mid) return res.status(400).json({ message: 'MID is required.' });

  if (!process.env.GOOGLE_AI_API_KEY && !process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    return res.status(500).json({ message: 'Google AI API key not configured. Set GOOGLE_AI_API_KEY or GEMINI_API_KEY on server.' });
  }
  if (!process.env.WEBXPAY_TOKEN || !process.env.WEBXPAY_COOKIE) {
    return res.status(500).json({ message: 'WebXPay credentials not configured on server.' });
  }

  try {
    console.log(`[runAiAnalysis] Fetching WebXPay approval-view for MID: ${mid}`);
    const webxpayResponse = await fetch(
      `https://signup.webxpay.com/api/merchant-manager/approval-view/${encodeURIComponent(mid)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${process.env.WEBXPAY_TOKEN}`,
          Cookie: process.env.WEBXPAY_COOKIE,
        },
        redirect: 'follow',
        timeout: 30000,
      }
    );

    if (!webxpayResponse.ok) {
      return res.status(502).json({
        message: `WebXPay API returned HTTP ${webxpayResponse.status}. Check credentials or MID.`,
      });
    }

    let webxpayData;
    try {
      webxpayData = await webxpayResponse.json();
    } catch {
      return res.status(502).json({ message: 'WebXPay returned non-JSON response.' });
    }

    console.log(`[runAiAnalysis] WebXPay data received (${JSON.stringify(webxpayData).length} chars)`);

    const bizInfo = webxpayData?.data?.business_information || {};
    let merchantTypeName = 'Private Limited';

    const webxpayTypeId = webxpayData?.data?.business_type?.type_of_business_id;
    const typeKeyword = WEBXPAY_TYPE_KEYWORDS[Number(webxpayTypeId)];

    if (typeKeyword) {
      const [kwRows] = await db.query(
        'SELECT name FROM merchant_types WHERE LOWER(name) LIKE ? LIMIT 1',
        [`%${typeKeyword}%`]
      );
      if (kwRows.length > 0) merchantTypeName = kwRows[0].name;
    } else {
      const [merchantRows] = await db.query(
        `SELECT mi.merchant_type_id, mt.name AS merchant_type_name
         FROM merchant_information mi
         JOIN merchant_types mt ON mi.merchant_type_id = mt.id
         WHERE mi.mid = ?`,
        [mid]
      );
      if (merchantRows.length > 0) merchantTypeName = merchantRows[0].merchant_type_name;
    }

    const ipg = Number(webxpayData?.data?.signup?.ipg_merchant);
    const pos = Number(webxpayData?.data?.signup?.pos_merchant);
    const merchantChannel = (ipg && pos) ? 'IPG & POS' : (pos ? 'POS' : 'IPG');

    const businessName = bizInfo.name_of_company_business
      || bizInfo.registered_name_of_business
      || `Merchant ${mid}`;

    const [typeRows] = await db.query(
      `SELECT id FROM merchant_types WHERE LOWER(name) LIKE ? LIMIT 1`,
      [`%${merchantTypeName.toLowerCase().split(' ')[0]}%`]
    );
    const merchantTypeId = typeRows[0]?.id || null;

    const onboardedDate = extractOnboardedDate(webxpayData);

    if (merchantTypeId) {
      await db.query(
        `INSERT INTO merchant_information
           (mid, merchant_business_name, merchant_type_id, merchant_channel, onboarded_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           merchant_business_name = VALUES(merchant_business_name),
           onboarded_date = COALESCE(VALUES(onboarded_date), onboarded_date),
           updated_at = NOW()`,
        [mid, businessName, merchantTypeId, merchantChannel, onboardedDate]
      );
      console.log(`[runAiAnalysis] merchant_information upserted for MID: ${mid}`);
    }

    const authHeaders = {
      Authorization: `Bearer ${process.env.WEBXPAY_TOKEN}`,
      Cookie: process.env.WEBXPAY_COOKIE,
    };

    const [[localDocuments], requirements] = await Promise.all([
      db.query('SELECT id, mid, document_type, upload_path FROM merchant_document WHERE mid = ? ORDER BY created_at ASC', [mid]),
      merchantTypeId ? getRequirementRulesForMerchantType(merchantTypeId) : Promise.resolve([]),
    ]);

    const result = await analyzeDocuments({
      merchantTypeName,
      webxpayData,
      authHeaders,
      localDocuments,
      uploadsRoot: UPLOADS_ROOT,
      requirements,
    });

    const canOnboard = result?.OnboardingEligibility?.canOnboard === true ? 1 : 0;
    const satisfactionScore = result?.satisfactionaSocre?.score ?? result?.satisfactionScore?.score ?? null;

    if (merchantTypeId) {
      try {
        const [existing] = await db.query(
          `SELECT id FROM merchant_document_json_data WHERE mid = ? ORDER BY created_at DESC LIMIT 1`,
          [mid]
        );
        if (existing.length > 0) {
          await db.query(
            `UPDATE merchant_document_json_data
             SET document_type = ?, extracted_json = ?, can_onboard = ?, satisfaction_score = ?
             WHERE id = ?`,
            [merchantTypeName, JSON.stringify(result), canOnboard, satisfactionScore, existing[0].id]
          );
        } else {
          await db.query(
            `INSERT INTO merchant_document_json_data
               (mid, merchant_document_id, document_type, uploaded_file_path, extracted_json, validation_json, can_onboard, satisfaction_score)
             VALUES (?, NULL, ?, NULL, ?, NULL, ?, ?)`,
            [mid, merchantTypeName, JSON.stringify(result), canOnboard, satisfactionScore]
          );
        }
      } catch (dbErr) {
        console.error('[runAiAnalysis] Could not save to merchant_document_json_data:', dbErr.message);
      }
    }

    return res.json({ message: 'AI analysis complete.', result, canOnboard: !!canOnboard, satisfactionScore });
  } catch (err) {
    console.error('=== AI ANALYSIS ERROR ===');
    console.error('Message :', err.message);
    console.error('Code    :', err.code);
    console.error('Stack   :', err.stack);
    console.error('=========================');
    return res.status(500).json({ message: err.message || 'AI analysis failed.' });
  }
};

// Extracted business logic — callable without req/res (used by auto-run and the HTTP handler).
// By default reuses the last stored AI extraction to keep results consistent and avoid
// re-spending API budget on unchanged documents. Pass forceReExtract=true only when
// documents have genuinely changed and a fresh AI pass is needed.
const runFullAnalysisForMid = async (mid, options = {}) => {
  const {
    merchant_type_id, merchantTypeId,
    merchant_channel, merchantChannel,
    forceReExtract = false,
  } = options;

  console.log(`[runFullAnalysisForMid] MID: ${mid}, forceReExtract: ${forceReExtract}`);
  const systemData = await fetchWebxpayApprovalView(mid);
  const merchantContext = await resolveMerchantContext(mid, systemData, merchant_type_id || merchantTypeId);

  if (!merchantContext.merchantTypeId) {
    const err = new Error('Merchant type could not be resolved. Select a merchant type and retry.');
    err.statusCode = 400;
    throw err;
  }

  const [[localDocuments], requirements] = await Promise.all([
    db.query('SELECT id, mid, document_type, upload_path FROM merchant_document WHERE mid = ? ORDER BY created_at ASC', [mid]),
    getRequirementRulesForMerchantType(merchantContext.merchantTypeId),
  ]);

  // Try to reuse the last saved AI extraction so results are deterministic and
  // we don't spend AI budget on unchanged documents.
  let documentData = null;
  if (!forceReExtract) {
    try {
      const [cached] = await db.query(
        `SELECT extracted_json FROM merchant_document_json_data
         WHERE mid = ? AND extracted_json IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
        [mid]
      );
      if (cached.length > 0 && cached[0].extracted_json) {
        const raw = cached[0].extracted_json;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          documentData = parsed;
          console.log(`[runFullAnalysisForMid] Using cached extraction for MID: ${mid}`);
        }
      }
    } catch (cacheErr) {
      console.warn(`[runFullAnalysisForMid] Cache read failed, will re-run AI: ${cacheErr.message}`);
    }
  }

  const usedCachedExtraction = documentData !== null;

  if (!documentData) {
    console.log(`[runFullAnalysisForMid] Running fresh AI extraction for MID: ${mid}`);
    const authHeaders = {
      Authorization: `Bearer ${process.env.WEBXPAY_TOKEN}`,
      Cookie: process.env.WEBXPAY_COOKIE,
    };
    documentData = await analyzeDocuments({
      merchantTypeName: merchantContext.merchantTypeName,
      webxpayData: systemData,
      authHeaders,
      localDocuments,
      uploadsRoot: UPLOADS_ROOT,
      requirements,
    });
  }

  const { normalizedSystemData, uploadedDocNames, apiDocLabels } = normalizeSystemDataForVerification(systemData);

  let report = buildVerificationReport({
    mid,
    merchantType: merchantContext.merchantType,
    merchantChannel: merchant_channel || merchantChannel || 'IPG',
    requirements,
    documentData,
    systemData: normalizedSystemData,
    uploadedDocNames,
    apiDocLabels,
  });

  const crossDocMismatches = (report.mismatches || []).filter((m) => m.category === 'ai_cross_document_mismatch');
  if (crossDocMismatches.length > 0) {
    const compatible = await verifyCrossDocumentMismatches(crossDocMismatches).catch(() => new Set());
    if (compatible.size > 0) {
      report = patchReportCompatibleMismatches(report, compatible);
      console.log(`[runFullAnalysisForMid] Resolved ${compatible.size} semantically compatible cross-doc mismatch(es) for MID: ${mid}`);
    }
  }

  await saveVerificationSnapshot({
    mid,
    merchantTypeName: merchantContext.merchantTypeName,
    documentData,
    report,
  });

  return { documentData, systemData, report, usedCachedExtraction };
};

const runFullApiVerification = async (req, res) => {
  const { mid } = req.params;
  if (!mid) return res.status(400).json({ message: 'MID is required.' });

  try {
    const result = await runFullAnalysisForMid(mid, req.body || {});
    const modeMsg = result.usedCachedExtraction
      ? 'Verification complete (used cached document extraction).'
      : 'Verification complete (fresh AI document extraction).';
    return res.json({ message: modeMsg, ...result });
  } catch (err) {
    console.error('runFullApiVerification error:', err);
    return res.status(err.statusCode || 500).json({
      message: err.message || 'Full verification failed.',
      data: err.data,
      raw: err.raw,
    });
  }
};

const triggerAutoRun = (req, res) => {
  const { runAutoAnalysis, getAutoRunStatus } = require('../services/autoRunService');
  const status = getAutoRunStatus();
  if (status.running) {
    return res.json({ message: 'Auto-run already in progress.', ...status });
  }
  // Fire and forget — do not await. Analysis of many merchants can take 30+ minutes
  // and would exceed the HTTP proxy timeout if awaited.
  runAutoAnalysis(runFullAnalysisForMid).catch((err) => {
    console.error('triggerAutoRun background error:', err.message);
  });
  return res.json({ message: 'Auto-run started in background. Check status endpoint for progress.', running: true });
};

const getAutoRunStatusHandler = (req, res) => {
  const { getAutoRunStatus } = require('../services/autoRunService');
  return res.json(getAutoRunStatus());
};

const getAiUsage = (req, res) => {
  const usage = getUsage();
  const budgetUsd = Number(process.env.AI_BUDGET_USD || 5.00);
  return res.json({
    total_cost_usd:      Number(usage.total_cost_usd.toFixed(5)),
    budget_usd:          budgetUsd,
    remaining_usd:       Number(getRemainingBudget(budgetUsd).toFixed(5)),
    total_input_tokens:  usage.total_input_tokens,
    total_output_tokens: usage.total_output_tokens,
    call_count:          usage.call_count,
    last_updated:        usage.last_updated || null,
  });
};

const fetchMerchantList = async (req, res) => {
  const page   = parseInt(req.query.page, 10) || 1;
  const search = req.query.search ? req.query.search.trim() : '';
  const filter = req.query.filter || '';

  const VALID_FILTERS = ['analyzed', 'remaining', 'above50', 'below50'];
  if (filter && VALID_FILTERS.includes(filter)) {
    try {
      const perPage = 15;
      const offset  = (page - 1) * perPage;

      let joinType   = 'LEFT JOIN';
      let whereExtra = '';
      if (filter === 'analyzed')  { whereExtra = 'AND mdjd.can_onboard IS NOT NULL'; }
      if (filter === 'remaining') { whereExtra = 'AND (mdjd.mid IS NULL OR mdjd.can_onboard IS NULL)'; }
      if (filter === 'above50')   { joinType = 'INNER JOIN'; whereExtra = 'AND mdjd.satisfaction_score >= 50'; }
      if (filter === 'below50')   { joinType = 'INNER JOIN'; whereExtra = 'AND mdjd.satisfaction_score IS NOT NULL AND mdjd.satisfaction_score < 50'; }

      const searchClause = search ? 'AND (mi.mid LIKE ? OR mi.merchant_business_name LIKE ?)' : '';
      const searchParams = search ? [`%${search}%`, `%${search}%`] : [];

      const [[{ total }]] = await db.query(
        `SELECT COUNT(*) AS total
         FROM merchant_information mi
         ${joinType} merchant_document_json_data mdjd ON mdjd.mid = mi.mid
         LEFT JOIN merchant_types mt ON mt.id = mi.merchant_type_id
         WHERE 1=1 ${whereExtra} ${searchClause}`,
        [...searchParams]
      );

      const [rows] = await db.query(
        `SELECT
           mi.mid                        AS id,
           mi.merchant_business_name     AS doing_business_name,
           mi.merchant_business_name     AS registered_business_name,
           mi.merchant_channel,
           mt.name                       AS merchant_type_name,
           mdjd.can_onboard,
           mdjd.satisfaction_score,
           mdjd.updated_at               AS last_analysis_at
         FROM merchant_information mi
         ${joinType} merchant_document_json_data mdjd ON mdjd.mid = mi.mid
         LEFT JOIN merchant_types mt ON mt.id = mi.merchant_type_id
         WHERE 1=1 ${whereExtra} ${searchClause}
         ORDER BY mdjd.updated_at DESC, mi.mid ASC
         LIMIT ? OFFSET ?`,
        [...searchParams, perPage, offset]
      );

      return res.json({
        data: rows,
        meta: {
          total,
          per_page:      perPage,
          current_page:  page,
          last_page:     Math.max(1, Math.ceil(total / perPage)),
        },
      });
    } catch (err) {
      console.error('fetchMerchantList (filtered) error:', err);
      return res.status(500).json({ message: err.message || 'Server error.' });
    }
  }

  const token  = process.env.WEBXPAY_TOKEN;
  const cookie = process.env.WEBXPAY_COOKIE;

  if (!token || !cookie) {
    return res.status(500).json({ message: 'WebXPay credentials not configured on server.' });
  }

  try {
    const url = new URL('https://signup.webxpay.com/api/merchant-manager/approval-view-list');
    url.searchParams.set('page', page);
    if (search) url.searchParams.set('search', search);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        Cookie: cookie,
      },
      redirect: 'follow',
      timeout: 30000,
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch {
      return res.status(502).json({ message: 'WebXPay returned non-JSON response.' });
    }

    if (!response.ok) {
      return res.status(response.status).json({ message: 'WebXPay API error.', data });
    }

    // Enrich each merchant with local DB data: channel, type, score, analysis status
    const items = data?.data || [];
    if (items.length > 0) {
      const mids = items.map((m) => m.id).filter(Boolean);
      const placeholders = mids.map(() => '?').join(',');

      const [dbRows] = await db.query(
        `SELECT
           mi.mid,
           mi.merchant_channel,
           mi.onboarded_date,
           mt.name            AS merchant_type_name,
           mdjd.can_onboard,
           mdjd.satisfaction_score,
           mdjd.updated_at    AS last_analysis_at
         FROM merchant_information mi
         LEFT JOIN merchant_types mt ON mt.id = mi.merchant_type_id
         LEFT JOIN merchant_document_json_data mdjd ON mdjd.mid = mi.mid
         WHERE mi.mid IN (${placeholders})`,
        mids
      );

      const dbMap = new Map();
      dbRows.forEach((row) => dbMap.set(Number(row.mid), row));

      data.data = items.map((m) => {
        const local = dbMap.get(Number(m.id)) || {};
        return {
          ...m,
          merchant_channel:   local.merchant_channel   || null,
          merchant_type_name: local.merchant_type_name || null,
          can_onboard:        local.can_onboard        != null ? local.can_onboard : null,
          satisfaction_score: local.satisfaction_score != null ? local.satisfaction_score : null,
          last_analysis_at:   local.last_analysis_at   || null,
          onboarded_date:     local.onboarded_date     || m.onboarded_date || null,
        };
      });
    }

    return res.json(data);
  } catch (err) {
    console.error('fetchMerchantList error:', err);
    return res.status(500).json({ message: err.message || 'Server error.' });
  }
};

const downloadMerchantDocuments = async (req, res) => {
  const { mid } = req.params;
  const { PDFDocument } = require('pdf-lib');

  try {
    const systemData = await fetchWebxpayApprovalView(mid);
    const allDocs = (systemData?.data?.all_documents || []).filter(
      (d) => d.source !== 'outlet' && d.source !== 'outlets'
    );

    if (allDocs.length === 0) {
      return res.status(404).json({ message: 'No documents found for this merchant.' });
    }

    const mergedPdf = await PDFDocument.create();
    let pagesAdded = 0;

    for (const doc of allDocs) {
      const docUrl = doc.url || (doc.path ? `https://signup.webxpay.com${doc.path}` : null);
      if (!docUrl) continue;

      try {
        const resp = await fetch(docUrl);
        if (!resp.ok) continue;

        const buffer = await resp.buffer();
        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        const urlLower = docUrl.toLowerCase();

        if (ct.includes('pdf') || urlLower.includes('.pdf')) {
          const donor = await PDFDocument.load(buffer, { ignoreEncryption: true });
          const copied = await mergedPdf.copyPages(donor, donor.getPageIndices());
          copied.forEach((p) => mergedPdf.addPage(p));
          pagesAdded += copied.length;
        } else if (ct.includes('jpeg') || ct.includes('jpg') || urlLower.match(/\.(jpg|jpeg)/)) {
          const img = await mergedPdf.embedJpg(buffer);
          const page = mergedPdf.addPage([img.width, img.height]);
          page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          pagesAdded++;
        } else if (ct.includes('png') || urlLower.includes('.png')) {
          const img = await mergedPdf.embedPng(buffer);
          const page = mergedPdf.addPage([img.width, img.height]);
          page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
          pagesAdded++;
        }
      } catch (docErr) {
        console.warn(`[download-docs] Skipped "${doc.label}":`, docErr.message);
      }
    }

    if (pagesAdded === 0) {
      return res.status(422).json({ message: 'Documents found but none could be processed.' });
    }

    const pdfBytes = await mergedPdf.save();
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="merchant_${mid}_documents.pdf"`,
      'Content-Length': pdfBytes.length,
    });
    return res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('downloadMerchantDocuments error:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Server error.' });
  }
};

const getRuleOverrides = async (req, res) => {
  const { mid } = req.params;
  try {
    const [rows] = await db.query(
      `SELECT id, mid, rule_check_name, field_name, document_source, comment, created_at
       FROM merchant_rule_overrides
       WHERE mid = ?
       ORDER BY created_at DESC`,
      [mid]
    );
    return res.json(rows);
  } catch (err) {
    console.error('getRuleOverrides error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const saveRuleOverride = async (req, res) => {
  const { mid, rule_check_name, field_name, document_source, comment } = req.body;
  if (!mid || !rule_check_name || !comment?.trim()) {
    return res.status(400).json({ message: 'mid, rule_check_name, and comment are required.' });
  }
  try {
    await db.query(
      `INSERT INTO merchant_rule_overrides
         (mid, rule_check_name, field_name, document_source, comment, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         comment = VALUES(comment),
         updated_at = NOW()`,
      [mid, rule_check_name, field_name || '', document_source || '', comment.trim()]
    );
    const [rows] = await db.query(
      `SELECT id, mid, rule_check_name, field_name, document_source, comment, created_at
       FROM merchant_rule_overrides
       WHERE mid = ?
       ORDER BY created_at DESC`,
      [mid]
    );
    return res.json(rows);
  } catch (err) {
    console.error('saveRuleOverride error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const getDashboardStats = async (req, res) => {
  try {
    const [[stats]] = await db.query(`
      SELECT
        COUNT(*)                                                                                    AS total,
        SUM(CASE WHEN mdjd.can_onboard IS NOT NULL                                     THEN 1 ELSE 0 END) AS analyzed,
        SUM(CASE WHEN mdjd.mid IS NULL OR mdjd.can_onboard IS NULL                     THEN 1 ELSE 0 END) AS remaining,
        SUM(CASE WHEN mdjd.satisfaction_score >= 50                                    THEN 1 ELSE 0 END) AS above50,
        SUM(CASE WHEN mdjd.satisfaction_score IS NOT NULL AND mdjd.satisfaction_score < 50 THEN 1 ELSE 0 END) AS below50
      FROM merchant_information mi
      LEFT JOIN merchant_document_json_data mdjd ON mdjd.mid = mi.mid
    `);
    return res.json({
      total:     Number(stats.total)     || 0,
      analyzed:  Number(stats.analyzed)  || 0,
      remaining: Number(stats.remaining) || 0,
      above50:   Number(stats.above50)   || 0,
      below50:   Number(stats.below50)   || 0,
    });
  } catch (err) {
    console.error('getDashboardStats error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const deleteRuleOverride = async (req, res) => {
  const { id } = req.params;
  const { mid } = req.query;
  try {
    await db.query('DELETE FROM merchant_rule_overrides WHERE id = ?', [id]);
    if (mid) {
      const [rows] = await db.query(
        `SELECT id, mid, rule_check_name, field_name, document_source, comment, created_at
         FROM merchant_rule_overrides
         WHERE mid = ?
         ORDER BY created_at DESC`,
        [mid]
      );
      return res.json(rows);
    }
    return res.json([]);
  } catch (err) {
    console.error('deleteRuleOverride error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

module.exports = {
  getRequirements, getAllMerchants, saveMerchant,
  uploadDocument, uploadUrl, getDocuments,
  getMerchant, deleteMerchant, deleteDocument,
  runDataVerification, fetchExternalMerchant, runAiAnalysis, getLatestAnalysis,
  runFullApiVerification, runFullAnalysisForMid,
  triggerAutoRun, getAutoRunStatusHandler,
  getAiUsage, downloadMerchantDocuments, fetchMerchantList, getDashboardStats,
  getRuleOverrides, saveRuleOverride, deleteRuleOverride,
};
