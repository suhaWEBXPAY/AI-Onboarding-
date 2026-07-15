const db = require('../config/db');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { buildVerificationReport, patchReportCompatibleMismatches } = require('../services/verificationEngine');
const { buildVerificationReportDoc, buildAllIssuesReportDoc } = require('../services/reportDocBuilder');
const { analyzeDocuments, verifyCrossDocumentMismatches } = require('../services/documentAnalyzer');
const { getUsage } = require('../services/costTracker');
const { getAllDuplicates, getDuplicatesForMid } = require('../services/stakeholderCrossCheck');

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
              latest.id AS analysis_id,
              latest.created_at AS latest_analysis_at,
              latest.can_onboard,
              latest.satisfaction_score,
              latest.validation_json
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
    await applyOverrideAdjustedScores(rows, { midField: 'mid' });
    rows.forEach((row) => {
      delete row.analysis_id;
      delete row.validation_json;
    });
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

const DASH_SENTINELS = new Set(['-', '\u2014', '\u00e2\u20ac\u201d']);

const overrideKey = (value) => {
  const text = String(value ?? '').trim();
  return DASH_SENTINELS.has(text) ? '' : text;
};

const parseStoredJson = (value, fallback = {}) => {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};

const computeSatisfactionScoreWithOverrides = (report, overrides = []) => {
  if (!report?.summary) return null;
  const summary = report?.summary || {};
  const rows = Array.isArray(report?.unifiedRows) ? report.unifiedRows : [];
  const failureStatuses = new Set(['missing', 'mismatch', 'invalid']);
  let matched = Number(summary.matchedFields) || 0;
  let missing = Number(summary.missingData) || 0;
  let invalid = Number(summary.invalidData) || 0;
  let mismatches = Number(summary.mismatches) || 0;

  rows.forEach((row) => {
    if (!failureStatuses.has(row.status)) return;
    const isOverridden = overrides.some((override) =>
      overrideKey(override.field_name) === overrideKey(row.field) &&
      overrideKey(override.document_source) === overrideKey(row.document)
    );
    if (!isOverridden) return;
    if (row.status === 'missing') missing = Math.max(0, missing - 1);
    if (row.status === 'mismatch') mismatches = Math.max(0, mismatches - 1);
    if (row.status === 'invalid') invalid = Math.max(0, invalid - 1);
    matched += 1;
  });

  return computeSatisfactionScore({
    matchedFields: matched,
    missingData: missing,
    invalidData: invalid,
    mismatches,
  });
};

const refreshOverrideAdjustedScore = async (mid) => {
  if (!mid) return null;
  const [analysisRows] = await db.query(
    `SELECT id, validation_json
     FROM merchant_document_json_data
     WHERE mid = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [mid]
  );
  if (analysisRows.length === 0) return null;

  const [overrides] = await db.query(
    `SELECT field_name, document_source
     FROM merchant_rule_overrides
     WHERE mid = ?`,
    [mid]
  );
  const report = parseStoredJson(analysisRows[0].validation_json, {});
  const score = computeSatisfactionScoreWithOverrides(report, overrides);
  if (score === null) return null;

  await db.query(
    `UPDATE merchant_document_json_data
     SET satisfaction_score = ?
     WHERE id = ?`,
    [score, analysisRows[0].id]
  );
  return score;
};

const getOverridesByMid = async (mids) => {
  const uniqueMids = [...new Set((mids || []).map((mid) => String(mid || '').trim()).filter(Boolean))];
  if (uniqueMids.length === 0) return new Map();

  const placeholders = uniqueMids.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT mid, field_name, document_source
     FROM merchant_rule_overrides
     WHERE mid IN (${placeholders})`,
    uniqueMids
  );

  const map = new Map();
  rows.forEach((row) => {
    const key = String(row.mid);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });
  return map;
};

const applyOverrideAdjustedScores = async (rows, { midField = 'mid', analysisIdField = 'analysis_id' } = {}) => {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const mids = rows.map((row) => row?.[midField]);
  const overridesByMid = await getOverridesByMid(mids);
  const updates = [];

  rows.forEach((row) => {
    if (!row) return;
    const mid = String(row[midField] || '').trim();
    if (!mid) return;

    const report = parseStoredJson(row.validation_json, {});
    const adjustedScore = computeSatisfactionScoreWithOverrides(report, overridesByMid.get(mid) || []);
    if (adjustedScore === null) return;

    if (row.satisfaction_score == null || Number(row.satisfaction_score) !== adjustedScore) {
      const analysisId = row[analysisIdField];
      if (analysisId) {
        updates.push(db.query(
          `UPDATE merchant_document_json_data
           SET satisfaction_score = ?
           WHERE id = ?`,
          [adjustedScore, analysisId]
        ));
      }
    }
    row.satisfaction_score = adjustedScore;
  });

  if (updates.length > 0) await Promise.all(updates);
  return rows;
};

const refreshAllOverrideAdjustedScores = async () => {
  const [rows] = await db.query(`
    SELECT
      mi.mid,
      mdjd.id AS analysis_id,
      mdjd.validation_json,
      mdjd.satisfaction_score
    FROM merchant_information mi
    JOIN merchant_document_json_data mdjd
      ON mdjd.mid = mi.mid
     AND mdjd.created_at = (
       SELECT MAX(latest.created_at)
       FROM merchant_document_json_data latest
       WHERE latest.mid = mi.mid
     )
  `);
  await applyOverrideAdjustedScores(rows, { midField: 'mid' });
};

// ── Effective verdict (reviewer overrides + corrections applied) ─────────────
// A reviewer can "Ignore" a blocking finding (merchant_rule_overrides) or correct
// a misread value (extraction_corrections). Both must feed back into the persisted
// verdict so the dashboard counts, the Status column, and the filters reflect the
// effective review state — when every blocking issue is resolved the merchant
// automatically becomes "verified" without waiting for a fresh analysis run.
const normalizeDecisionKey = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const sameDecisionTarget = (leftField, leftDocument, rightField, rightDocument) => {
  const lf = normalizeDecisionKey(leftField);
  const rf = normalizeDecisionKey(rightField);
  const ld = normalizeDecisionKey(leftDocument);
  const rd = normalizeDecisionKey(rightDocument);
  if (!lf || !rf || lf !== rf) return false;
  if (!ld || !rd) return true;
  return ld === rd || ld.includes(rd) || rd.includes(ld);
};

const issueHasManualResolution = (issue, overrides = [], corrections = []) => {
  const field = issue.field || issue.title || '';
  const documentSource = issue.document || '';
  return overrides.some((ov) => sameDecisionTarget(field, documentSource, ov.field_name, ov.document_source))
    || corrections.some((corr) => sameDecisionTarget(field, documentSource, corr.field_name, corr.document_source));
};

const computeRemainingBlockingIssues = (report, overrides = [], corrections = []) =>
  (report?.onboardingDecision?.blockingIssues || [])
    .filter((issue) => !issueHasManualResolution(issue, overrides, corrections));

const getCorrectionsByMid = async (mids) => {
  const uniqueMids = [...new Set((mids || []).map((mid) => String(mid || '').trim()).filter(Boolean))];
  if (uniqueMids.length === 0) return new Map();
  const map = new Map();
  try {
    await ensureCorrectionsTable();
    const placeholders = uniqueMids.map(() => '?').join(',');
    const [rows] = await db.query(
      `SELECT mid, field_name, document_source FROM extraction_corrections WHERE mid IN (${placeholders})`,
      uniqueMids
    );
    rows.forEach((row) => {
      const key = String(row.mid);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    });
  } catch { /* corrections are best-effort */ }
  return map;
};

// Recompute the persisted verdict for a set of rows that carry validation_json.
// Mirrors applyOverrideAdjustedScores: mutates the rows in place and persists any
// change so subsequent reads (dashboard stats, list filters) stay consistent.
const applyEffectiveVerdicts = async (rows, { midField = 'mid', analysisIdField = 'analysis_id' } = {}) => {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const mids = rows.map((row) => row?.[midField]);
  const [overridesByMid, correctionsByMid] = await Promise.all([
    getOverridesByMid(mids),
    getCorrectionsByMid(mids),
  ]);
  const updates = [];

  rows.forEach((row) => {
    if (!row) return;
    const mid = String(row[midField] || '').trim();
    if (!mid || !row.validation_json) return;

    const report = parseStoredJson(row.validation_json, {});
    const originalBlocking = report?.onboardingDecision?.blockingIssues || [];
    if (originalBlocking.length === 0) return; // engine verdict stands

    const remaining = computeRemainingBlockingIssues(
      report,
      overridesByMid.get(mid) || [],
      correctionsByMid.get(mid) || []
    );
    const status = remaining.length > 0 ? 'review_required' : 'verified';
    const canOnboard = remaining.length > 0 ? 0 : 1;

    if (row.computed_status !== status || Number(row.can_onboard) !== canOnboard) {
      const analysisId = row[analysisIdField];
      if (analysisId) {
        updates.push(db.query(
          'UPDATE merchant_document_json_data SET computed_status = ?, can_onboard = ? WHERE id = ?',
          [status, canOnboard, analysisId]
        ));
      }
    }
    row.computed_status = status;
    row.can_onboard = canOnboard;
    if ('effective_status' in row) row.effective_status = row.review_status || status;
  });

  if (updates.length > 0) await Promise.all(updates);
  return rows;
};

// Recompute + persist the effective verdict for one merchant's latest analysis.
// Returns the effective state, or null when there is nothing to recompute.
const refreshEffectiveVerdict = async (mid) => {
  if (!mid) return null;
  const [rows] = await db.query(
    `SELECT id AS analysis_id, validation_json, computed_status, can_onboard, review_status
     FROM merchant_document_json_data
     WHERE mid = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [mid]
  );
  if (rows.length === 0) return null;
  rows[0].mid = mid;
  await applyEffectiveVerdicts(rows, { midField: 'mid' });
  return {
    computed_status: rows[0].computed_status,
    can_onboard: rows[0].can_onboard,
  };
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
    const detail = data?.message || data?.error || JSON.stringify(data).slice(0, 300);
    const err = new Error(`WebXPay API error (HTTP ${response.status}): ${detail}`);
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
  // Caution = minor non-blocking issues only → still allowed to onboard.
  // Only review_required (a hard blocking issue) prevents onboarding.
  const computedStatus = report.status || 'review_required';
  const canOnboard = (computedStatus === 'verified' || computedStatus === 'caution') ? 1 : 0;
  let satisfactionScore = computeSatisfactionScore(report.summary);
  if (mid) {
    try {
      const [overrides] = await db.query(
        `SELECT field_name, document_source
         FROM merchant_rule_overrides
         WHERE mid = ?`,
        [mid]
      );
      satisfactionScore = computeSatisfactionScoreWithOverrides(report, overrides) ?? satisfactionScore;
    } catch { /* overrides are best-effort for score display */ }
  }
  const extractedJson = JSON.stringify(documentData);
  const validationJson = JSON.stringify(report);

  try {
    const [existing] = await db.query(
      `SELECT id FROM merchant_document_json_data WHERE mid = ? ORDER BY created_at DESC LIMIT 1`,
      [mid || null]
    );

    if (existing.length > 0) {
      // Re-analysis refreshes the computed status but never clobbers a human's
      // manual review_status override — that column is left untouched here.
      await db.query(
        `UPDATE merchant_document_json_data
         SET document_type = ?, extracted_json = ?, validation_json = ?, can_onboard = ?, satisfaction_score = ?, computed_status = ?
         WHERE id = ?`,
        [merchantTypeName, extractedJson, validationJson, canOnboard, satisfactionScore, computedStatus, existing[0].id]
      );
    } else {
      await db.query(
        `INSERT INTO merchant_document_json_data
           (mid, merchant_document_id, document_type, uploaded_file_path, extracted_json, validation_json, can_onboard, satisfaction_score, computed_status)
         VALUES (?, NULL, ?, NULL, ?, ?, ?, ?, ?)`,
        [mid || null, merchantTypeName, extractedJson, validationJson, canOnboard, satisfactionScore, computedStatus]
      );
    }

    // Re-apply reviewer ignores/corrections so a re-run never flips a manually
    // cleared merchant back to review_required.
    if (mid) await refreshEffectiveVerdict(mid);
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

    let effectiveDocumentData = documentData;
    try {
      const corrections = await loadCorrectionsForMid(mid);
      if (corrections.length) effectiveDocumentData = applyExtractionCorrections(documentData, corrections);
    } catch { /* corrections are best-effort */ }

    const { normalizedSystemData, uploadedDocNames, apiDocLabels } = normalizeSystemDataForVerification(systemData);

    let report = buildVerificationReport({
      mid,
      merchantType: merchantTypes[0],
      merchantChannel: merchant_channel || merchantChannel,
      requirements,
      documentData: effectiveDocumentData,
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
      `SELECT id AS analysis_id, extracted_json, validation_json, can_onboard, satisfaction_score,
              computed_status, review_status, review_status_by, review_status_at, created_at
       FROM merchant_document_json_data
       WHERE mid = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [mid]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'No analysis found for this MID.' });
    }
    const row = rows[0];
    row.mid = mid;
    await applyOverrideAdjustedScores([row]);
    await applyEffectiveVerdicts([row]);
    row.effective_status = row.review_status || row.computed_status || null;
    delete row.analysis_id;
    delete row.mid;
    return res.json(row);
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
    const computedStatus = canOnboard ? 'verified' : 'review_required';

    if (merchantTypeId) {
      try {
        const [existing] = await db.query(
          `SELECT id FROM merchant_document_json_data WHERE mid = ? ORDER BY created_at DESC LIMIT 1`,
          [mid]
        );
        if (existing.length > 0) {
          await db.query(
            `UPDATE merchant_document_json_data
             SET document_type = ?, extracted_json = ?, can_onboard = ?, satisfaction_score = ?, computed_status = ?
             WHERE id = ?`,
            [merchantTypeName, JSON.stringify(result), canOnboard, satisfactionScore, computedStatus, existing[0].id]
          );
        } else {
          await db.query(
            `INSERT INTO merchant_document_json_data
               (mid, merchant_document_id, document_type, uploaded_file_path, extracted_json, validation_json, can_onboard, satisfaction_score, computed_status)
             VALUES (?, NULL, ?, NULL, ?, NULL, ?, ?, ?)`,
            [mid, merchantTypeName, JSON.stringify(result), canOnboard, satisfactionScore, computedStatus]
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
          // A run that failed to download some documents produced a crippled
          // extraction (documents wrongly reported missing/invalid). Never reuse
          // it — force a fresh AI pass so the verdict reflects the real uploads.
          const loadFailures = parsed?._analysisMetadata?.documentLoadFailures;
          if (Array.isArray(loadFailures) && loadFailures.length > 0) {
            console.log(`[runFullAnalysisForMid] Cached extraction for MID ${mid} had ${loadFailures.length} document download failure(s) — ignoring cache, re-extracting.`);
          } else {
            documentData = parsed;
            console.log(`[runFullAnalysisForMid] Using cached extraction for MID: ${mid}`);
          }
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

  // Reviewer corrections overlay — re-applies on every run, including after a
  // fresh AI extraction, so manual fixes are never lost.
  try {
    const corrections = await loadCorrectionsForMid(mid);
    if (corrections.length) {
      documentData = applyExtractionCorrections(documentData, corrections);
      console.log(`[runFullAnalysisForMid] Applied ${corrections.length} manual correction(s) for MID: ${mid}`);
    }
  } catch (corrErr) {
    console.warn(`[runFullAnalysisForMid] Corrections could not be applied: ${corrErr.message}`);
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

const stopAutoRunHandler = (req, res) => {
  const { stopAutoRun, getAutoRunStatus } = require('../services/autoRunService');
  const accepted = stopAutoRun();
  return res.json({
    message: accepted
      ? 'Stop requested. In-flight analyses will finish; queued merchants are skipped.'
      : 'No auto-run is currently active.',
    ...getAutoRunStatus(),
  });
};

const getAiUsage = (req, res) => {
  const usage = getUsage();
  return res.json({
    total_cost_usd:      Number(usage.total_cost_usd.toFixed(5)),
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

  const VALID_FILTERS = ['analyzed', 'remaining', 'above50', 'below50', 'verified', 'caution', 'review'];
  // Effective status = human override if set, else the computed verdict.
  const EFFECTIVE_STATUS_SQL = 'COALESCE(mdjd.review_status, mdjd.computed_status)';

  // Remaining = every WebXPay merchant without a completed analysis (status "Pending").
  // The local-DB query below only knows merchants that were analyzed at least once,
  // so it would miss WebXPay-only merchants; use the full (cached) WebXPay list.
  if (filter === 'remaining') {
    try {
      const { loadAllMerchantsFromWebXPay } = require('../services/autoRunService');
      const allMerchants = await loadAllMerchantsFromWebXPay();
      if (allMerchants.length > 0) {
        const [analyzedRows] = await db.query(
          'SELECT DISTINCT mid FROM merchant_document_json_data WHERE can_onboard IS NOT NULL'
        );
        const analyzedSet = new Set(analyzedRows.map((r) => Number(r.mid)));
        let pending = allMerchants.filter((m) => m?.id && !analyzedSet.has(Number(m.id)));

        if (search) {
          const q = search.toLowerCase();
          pending = pending.filter((m) =>
            String(m.id).includes(search)
            || String(m.doing_business_name || '').toLowerCase().includes(q)
            || String(m.registered_business_name || '').toLowerCase().includes(q));
        }

        const perPage = 15;
        const total = pending.length;
        const pageItems = pending.slice((page - 1) * perPage, page * perPage);

        let enriched = pageItems;
        if (pageItems.length > 0) {
          const mids = pageItems.map((m) => m.id);
          const placeholders = mids.map(() => '?').join(',');
          const [dbRows] = await db.query(
            `SELECT mi.mid, mi.merchant_channel, mt.name AS merchant_type_name
             FROM merchant_information mi
             LEFT JOIN merchant_types mt ON mt.id = mi.merchant_type_id
             WHERE mi.mid IN (${placeholders})`,
            mids
          );
          const dbMap = new Map(dbRows.map((r) => [Number(r.mid), r]));
          enriched = pageItems.map((m) => {
            const local = dbMap.get(Number(m.id)) || {};
            return {
              ...m,
              merchant_channel:   local.merchant_channel   || null,
              merchant_type_name: local.merchant_type_name || null,
              can_onboard:        null,
              satisfaction_score: null,
              computed_status:    null,
              review_status:      null,
              effective_status:   null,
              last_analysis_at:   null,
            };
          });
        }

        return res.json({
          data: enriched,
          meta: {
            total,
            per_page:     perPage,
            current_page: page,
            last_page:    Math.max(1, Math.ceil(total / perPage)),
          },
        });
      }
    } catch (err) {
      console.warn('fetchMerchantList remaining-via-WebXPay failed, falling back to local DB:', err.message);
    }
    // fall through to the local-DB remaining query below
  }

  if (filter && VALID_FILTERS.includes(filter)) {
    try {
      const perPage = 15;
      const offset  = (page - 1) * perPage;

      if (filter === 'above50' || filter === 'below50') {
        await refreshAllOverrideAdjustedScores();
      }

      let joinType   = 'LEFT JOIN';
      let whereExtra = '';
      if (filter === 'analyzed')  { whereExtra = 'AND mdjd.can_onboard IS NOT NULL'; }
      if (filter === 'remaining') { whereExtra = 'AND (mdjd.mid IS NULL OR mdjd.can_onboard IS NULL)'; }
      if (filter === 'above50')   { joinType = 'INNER JOIN'; whereExtra = 'AND mdjd.satisfaction_score >= 50'; }
      if (filter === 'below50')   { joinType = 'INNER JOIN'; whereExtra = 'AND mdjd.satisfaction_score IS NOT NULL AND mdjd.satisfaction_score < 50'; }
      if (filter === 'verified')  { joinType = 'INNER JOIN'; whereExtra = `AND ${EFFECTIVE_STATUS_SQL} = 'verified'`; }
      if (filter === 'caution')   { joinType = 'INNER JOIN'; whereExtra = `AND ${EFFECTIVE_STATUS_SQL} = 'caution'`; }
      if (filter === 'review')    { joinType = 'INNER JOIN'; whereExtra = `AND ${EFFECTIVE_STATUS_SQL} IN ('review','review_required')`; }

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
           mdjd.id                       AS analysis_id,
           mdjd.can_onboard,
           mdjd.satisfaction_score,
           mdjd.validation_json,
           mdjd.computed_status,
           mdjd.review_status,
           ${EFFECTIVE_STATUS_SQL}       AS effective_status,
           mdjd.updated_at               AS last_analysis_at
         FROM merchant_information mi
         ${joinType} merchant_document_json_data mdjd ON mdjd.mid = mi.mid
         LEFT JOIN merchant_types mt ON mt.id = mi.merchant_type_id
         WHERE 1=1 ${whereExtra} ${searchClause}
         ORDER BY mdjd.updated_at DESC, mi.mid ASC
         LIMIT ? OFFSET ?`,
        [...searchParams, perPage, offset]
      );

      await applyOverrideAdjustedScores(rows, { midField: 'id' });
      await applyEffectiveVerdicts(rows, { midField: 'id' });
      rows.forEach((row) => {
        delete row.analysis_id;
        delete row.validation_json;
      });

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
           mdjd.id            AS analysis_id,
           mdjd.can_onboard,
           mdjd.satisfaction_score,
           mdjd.validation_json,
           mdjd.computed_status,
           mdjd.review_status,
           ${EFFECTIVE_STATUS_SQL} AS effective_status,
           mdjd.updated_at    AS last_analysis_at
         FROM merchant_information mi
         LEFT JOIN merchant_types mt ON mt.id = mi.merchant_type_id
         LEFT JOIN merchant_document_json_data mdjd ON mdjd.mid = mi.mid
         WHERE mi.mid IN (${placeholders})`,
        mids
      );

      await applyOverrideAdjustedScores(dbRows, { midField: 'mid' });
      await applyEffectiveVerdicts(dbRows, { midField: 'mid' });

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
          computed_status:    local.computed_status    || null,
          review_status:      local.review_status      || null,
          effective_status:   local.effective_status   || null,
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

// Generate a Word (.docx) verification report for one merchant: the onboarding
// decision, rule checks, document validity, issues + clarity comments, and any
// manual overrides. Does NOT include the merchant's source documents.
const downloadVerificationReport = async (req, res) => {
  const { mid } = req.params;
  if (!mid) return res.status(400).json({ message: 'MID is required.' });

  try {
    const [rows] = await db.query(
      `SELECT validation_json, can_onboard, satisfaction_score,
              computed_status, review_status, review_status_by, review_status_at,
              created_at, updated_at
       FROM merchant_document_json_data
       WHERE mid = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [mid]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'No verification analysis found for this merchant. Run analysis first.' });
    }

    const analysis = rows[0];
    let report = analysis.validation_json;
    if (typeof report === 'string') {
      try { report = JSON.parse(report); } catch { report = {}; }
    }
    report = report && typeof report === 'object' ? report : {};

    const [[merchant]] = await db.query(
      `SELECT mi.mid, mi.merchant_business_name, mi.merchant_channel, mi.onboarded_date,
              mt.name AS merchant_type_name
       FROM merchant_information mi
       LEFT JOIN merchant_types mt ON mt.id = mi.merchant_type_id
       WHERE mi.mid = ?`,
      [mid]
    );

    const [overrides] = await db.query(
      `SELECT rule_check_name, field_name, document_source, comment
       FROM merchant_rule_overrides WHERE mid = ? ORDER BY created_at`,
      [mid]
    );

    const buffer = await buildVerificationReportDoc({
      merchant: merchant || { mid },
      analysis,
      report,
      overrides: overrides || [],
    });

    const safeName = String((merchant && merchant.merchant_business_name) || `merchant_${mid}`)
      .replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 60) || `merchant_${mid}`;

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${safeName}_verification_report.docx"`,
      'Content-Length': buffer.length,
    });
    return res.send(buffer);
  } catch (err) {
    console.error('downloadVerificationReport error:', err);
    return res.status(500).json({ message: err.message || 'Failed to generate report.' });
  }
};

// One combined Word (.docx) report covering every merchant that has a stored
// analysis: a summary table plus, per merchant, each open issue and the action
// needed to resolve it (e.g. which missing document to upload).
const downloadAllIssuesReport = async (req, res) => {
  try {
    const [analyses] = await db.query(
      `SELECT t.mid, t.validation_json, t.can_onboard, t.satisfaction_score,
              t.computed_status, t.review_status, t.created_at, t.updated_at
       FROM merchant_document_json_data t
       JOIN (
         SELECT mid, MAX(created_at) AS max_created
         FROM merchant_document_json_data
         GROUP BY mid
       ) latest ON latest.mid = t.mid AND latest.max_created = t.created_at
       ORDER BY t.mid`
    );
    if (analyses.length === 0) {
      return res.status(404).json({ message: 'No verification analyses found. Run analysis for at least one merchant first.' });
    }

    const mids = analyses.map((a) => a.mid);
    const placeholders = mids.map(() => '?').join(',');

    const [merchantRows] = await db.query(
      `SELECT mi.mid, mi.merchant_business_name, mi.merchant_channel,
              mt.name AS merchant_type_name
       FROM merchant_information mi
       LEFT JOIN merchant_types mt ON mt.id = mi.merchant_type_id
       WHERE mi.mid IN (${placeholders})`,
      mids
    );
    const merchantByMid = new Map(merchantRows.map((m) => [String(m.mid), m]));

    const [overrideRows] = await db.query(
      `SELECT mid, rule_check_name, field_name, document_source, comment
       FROM merchant_rule_overrides WHERE mid IN (${placeholders})`,
      mids
    );
    const overridesByMid = new Map();
    for (const ov of overrideRows) {
      const key = String(ov.mid);
      if (!overridesByMid.has(key)) overridesByMid.set(key, []);
      overridesByMid.get(key).push(ov);
    }

    const entries = analyses.map((analysis) => {
      let report = analysis.validation_json;
      if (typeof report === 'string') {
        try { report = JSON.parse(report); } catch { report = {}; }
      }
      report = report && typeof report === 'object' ? report : {};
      const key = String(analysis.mid);
      return {
        merchant: merchantByMid.get(key) || { mid: analysis.mid },
        analysis,
        report,
        overrides: overridesByMid.get(key) || [],
      };
    });

    const buffer = await buildAllIssuesReportDoc(entries);
    const dateTag = new Date().toISOString().slice(0, 10);

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="merchant_issues_report_${dateTag}.docx"`,
      'Content-Length': buffer.length,
    });
    return res.send(buffer);
  } catch (err) {
    console.error('downloadAllIssuesReport error:', err);
    return res.status(500).json({ message: err.message || 'Failed to generate the consolidated issues report.' });
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
    await refreshOverrideAdjustedScore(mid);
    await refreshEffectiveVerdict(mid);
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
    const [rows] = await db.query(`
      SELECT
        mi.mid,
        mdjd.id AS analysis_id,
        mdjd.validation_json,
        mdjd.can_onboard,
        mdjd.satisfaction_score,
        mdjd.computed_status,
        mdjd.review_status
      FROM merchant_information mi
      LEFT JOIN merchant_document_json_data mdjd
        ON mdjd.mid = mi.mid
       AND mdjd.created_at = (
         SELECT MAX(latest.created_at)
         FROM merchant_document_json_data latest
         WHERE latest.mid = mi.mid
       )
    `);

    await applyOverrideAdjustedScores(rows, { midField: 'mid' });
    await applyEffectiveVerdicts(rows, { midField: 'mid' });

    const stats = rows.reduce((acc, row) => {
      const score = row.satisfaction_score == null ? null : Number(row.satisfaction_score);
      const effectiveStatus = row.review_status || row.computed_status || null;

      acc.total += 1;
      if (row.can_onboard != null) acc.analyzed += 1;
      if (!row.analysis_id || row.can_onboard == null) acc.remaining += 1;
      if (score != null && score >= 50) acc.above50 += 1;
      if (score != null && score < 50) acc.below50 += 1;
      if (effectiveStatus === 'verified') acc.verified += 1;
      if (effectiveStatus === 'caution') acc.caution += 1;
      if (effectiveStatus === 'review' || effectiveStatus === 'review_required') acc.review += 1;
      return acc;
    }, {
      total: 0,
      analyzed: 0,
      remaining: 0,
      above50: 0,
      below50: 0,
      verified: 0,
      caution: 0,
      review: 0,
    });

    return res.json({
      total:     stats.total,
      analyzed:  stats.analyzed,
      remaining: stats.remaining,
      above50:   stats.above50,
      below50:   stats.below50,
      verified:  stats.verified,
      caution:   stats.caution,
      review:    stats.review,
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
      await refreshOverrideAdjustedScore(mid);
      await refreshEffectiveVerdict(mid);
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

// Manually set (or clear) a human review status for a merchant. This overrides
// the system-computed verdict for display/filtering — e.g. a reviewer can mark a
// blocked merchant "verified" after manually confirming it, or downgrade a clean
// one to "caution". Pass review_status: 'auto' (or null) to revert to the computed status.
const updateReviewStatus = async (req, res) => {
  const { mid } = req.params;
  let reviewStatus = req.body ? req.body.review_status : undefined;
  if (!mid) return res.status(400).json({ message: 'MID is required.' });

  if (reviewStatus === null || reviewStatus === '' || reviewStatus === 'auto' || reviewStatus === undefined) {
    reviewStatus = null; // clear override → fall back to computed_status
  } else {
    reviewStatus = String(reviewStatus).toLowerCase();
    if (reviewStatus === 'review_required') reviewStatus = 'review';
    if (!['verified', 'caution', 'review'].includes(reviewStatus)) {
      return res.status(400).json({ message: "Invalid status. Use 'verified', 'caution', 'review', or 'auto' to clear." });
    }
  }

  try {
    const [rows] = await db.query(
      `SELECT id, computed_status, validation_json FROM merchant_document_json_data WHERE mid = ? ORDER BY created_at DESC LIMIT 1`,
      [mid]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'No analysis record for this merchant yet. Run analysis first.' });
    }

    // A merchant cannot be manually marked Verified while blocking issues are
    // still unresolved — each must be fixed or explicitly ignored with a reason.
    if (reviewStatus === 'verified') {
      const report = parseStoredJson(rows[0].validation_json, {});
      const originalBlocking = report?.onboardingDecision?.blockingIssues || [];
      if (originalBlocking.length > 0) {
        const [overrides] = await db.query(
          'SELECT field_name, document_source FROM merchant_rule_overrides WHERE mid = ?',
          [mid]
        );
        const corrections = await loadCorrectionsForMid(mid).catch(() => []);
        const remaining = computeRemainingBlockingIssues(report, overrides, corrections);
        if (remaining.length > 0) {
          const names = remaining.slice(0, 3).map((i) => i.field || i.title).filter(Boolean).join(', ');
          return res.status(409).json({
            message: `Cannot mark as Verified: ${remaining.length} blocking issue(s) are still unresolved${names ? ` (${names}${remaining.length > 3 ? ', …' : ''})` : ''}. Fix the data or ignore each issue with a documented reason first.`,
            remaining_blocking: remaining.length,
          });
        }
      }
    }

    const by = req.user?.email || req.user?.username || req.user?.id || null;
    await db.query(
      `UPDATE merchant_document_json_data
       SET review_status = ?, review_status_by = ?, review_status_at = ${reviewStatus ? 'NOW()' : 'NULL'}
       WHERE id = ?`,
      [reviewStatus, reviewStatus ? by : null, rows[0].id]
    );

    const effective = reviewStatus || rows[0].computed_status || 'review_required';
    return res.json({
      mid,
      review_status:    reviewStatus,
      computed_status:  rows[0].computed_status || null,
      effective_status: effective,
      can_onboard:      (effective === 'verified' || effective === 'caution') ? 1 : 0,
    });
  } catch (err) {
    console.error('updateReviewStatus error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// Cross-business stakeholder detection — flags people (director/owner/partner)
// registered under more than one business. Read-only: reads the merchant list
// from the DB and fetches WebXPay live; no DB writes, no schema changes.
const getDuplicateStakeholders = async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
    const result = await getAllDuplicates({ forceRefresh });
    return res.json(result);
  } catch (err) {
    console.error('getDuplicateStakeholders error:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Server error.' });
  }
};

// ── Manual extraction corrections ───────────────────────────────────────────
// When the AI misreads a value, a reviewer can correct it. Corrections are an
// overlay stored per (mid, field, document): the original AI output is never
// destroyed, corrections re-apply automatically on every verification run
// (including after a fresh re-extraction), and each records who made it.
let correctionsTableReady = false;
const ensureCorrectionsTable = async () => {
  if (correctionsTableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS extraction_corrections (
      id INT AUTO_INCREMENT PRIMARY KEY,
      mid VARCHAR(32) NOT NULL,
      field_name VARCHAR(255) NOT NULL,
      document_source VARCHAR(255) NOT NULL DEFAULT '',
      old_value TEXT NULL,
      new_value TEXT NULL,
      corrected_by VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_correction (mid, field_name, document_source)
    )`);
  correctionsTableReady = true;
};

const normCorr = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Apply corrections onto a deep copy of the AI extraction:
//  1. Any object property whose key matches the corrected field AND whose value
//     equals the recorded old value is replaced (covers section objects like
//     BusinessRegistration and BankDetails).
//  2. PromptFieldCoverage items matching field + document get the new value and
//     are marked present (covers correcting values the AI reported missing).
const applyExtractionCorrections = (documentData, corrections = []) => {
  if (!corrections.length || !documentData || typeof documentData !== 'object') return documentData;
  const data = JSON.parse(JSON.stringify(documentData));

  corrections.forEach((c) => {
    const fieldNorm = normCorr(c.field_name);
    if (!fieldNorm) return;
    const oldTrim = String(c.old_value ?? '').trim();

    const walk = (obj) => {
      if (Array.isArray(obj)) { obj.forEach(walk); return; }
      if (!obj || typeof obj !== 'object') return;
      Object.keys(obj).forEach((key) => {
        const value = obj[key];
        if (value && typeof value === 'object') { walk(value); return; }
        if (normCorr(key) === fieldNorm && String(value ?? '').trim() === oldTrim) {
          obj[key] = c.new_value;
        }
      });
    };
    walk(data);

    const docNorm = normCorr(c.document_source);
    (Array.isArray(data.PromptFieldCoverage) ? data.PromptFieldCoverage : []).forEach((item) => {
      if (!item || typeof item !== 'object') return;
      if (normCorr(item.field) !== fieldNorm) return;
      const itemDocNorm = normCorr(item.document || item.source || '');
      if (docNorm && itemDocNorm && itemDocNorm !== docNorm
        && !itemDocNorm.includes(docNorm) && !docNorm.includes(itemDocNorm)) return;
      item.value = c.new_value;
      item.status = 'present';
      item.present = true;
      item.reason = 'Manually corrected by reviewer.';
    });
  });

  return data;
};

const loadCorrectionsForMid = async (mid) => {
  if (!mid) return [];
  await ensureCorrectionsTable();
  const [rows] = await db.query('SELECT * FROM extraction_corrections WHERE mid = ? ORDER BY created_at DESC', [mid]);
  return rows;
};

const getExtractionCorrections = async (req, res) => {
  try {
    return res.json(await loadCorrectionsForMid(req.params.mid));
  } catch (err) {
    console.error('getExtractionCorrections error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const saveExtractionCorrection = async (req, res) => {
  const { mid, field_name, document_source, old_value, new_value } = req.body || {};
  if (!mid || !field_name || new_value === undefined) {
    return res.status(400).json({ message: 'mid, field_name, and new_value are required.' });
  }
  try {
    await ensureCorrectionsTable();
    const correctedBy = req.user?.name || req.user?.email || null;
    await db.query(
      `INSERT INTO extraction_corrections (mid, field_name, document_source, old_value, new_value, corrected_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE old_value = VALUES(old_value), new_value = VALUES(new_value), corrected_by = VALUES(corrected_by)`,
      [String(mid), String(field_name).slice(0, 255), String(document_source || '').slice(0, 255),
        old_value == null ? null : String(old_value), String(new_value), correctedBy]
    );
    await refreshEffectiveVerdict(mid);
    return res.json(await loadCorrectionsForMid(mid));
  } catch (err) {
    console.error('saveExtractionCorrection error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const deleteExtractionCorrection = async (req, res) => {
  const { id } = req.params;
  const { mid } = req.query;
  if (!id) return res.status(400).json({ message: 'id is required.' });
  try {
    await ensureCorrectionsTable();
    await db.query('DELETE FROM extraction_corrections WHERE id = ?', [id]);
    if (mid) await refreshEffectiveVerdict(mid);
    return res.json(await loadCorrectionsForMid(mid));
  } catch (err) {
    console.error('deleteExtractionCorrection error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

// ── Stakeholder alert dismissals ─────────────────────────────────────────────
// Shared across all admins (DB-backed, not per-browser). alert_key encodes the
// identity + the exact business set, so a dismissed alert resurfaces on its own
// if the person later appears in a NEW business.
let dismissalsTableReady = false;
const ensureDismissalsTable = async () => {
  if (dismissalsTableReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS stakeholder_alert_dismissals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      alert_key VARCHAR(512) NOT NULL UNIQUE,
      identifier VARCHAR(255) NOT NULL,
      match_type VARCHAR(32) NOT NULL,
      dismissed_by VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
  dismissalsTableReady = true;
};

const getStakeholderAlertDismissals = async (req, res) => {
  try {
    await ensureDismissalsTable();
    const [rows] = await db.query(
      'SELECT id, alert_key, identifier, match_type, dismissed_by, created_at FROM stakeholder_alert_dismissals ORDER BY created_at DESC'
    );
    return res.json(rows);
  } catch (err) {
    console.error('getStakeholderAlertDismissals error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const saveStakeholderAlertDismissal = async (req, res) => {
  const { alert_key, identifier, match_type } = req.body || {};
  if (!alert_key || !identifier) {
    return res.status(400).json({ message: 'alert_key and identifier are required.' });
  }
  try {
    await ensureDismissalsTable();
    const dismissedBy = req.user?.name || req.user?.email || null;
    await db.query(
      `INSERT INTO stakeholder_alert_dismissals (alert_key, identifier, match_type, dismissed_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE dismissed_by = VALUES(dismissed_by)`,
      [String(alert_key).slice(0, 512), String(identifier).slice(0, 255), String(match_type || '').slice(0, 32), dismissedBy]
    );
    const [rows] = await db.query(
      'SELECT id, alert_key, identifier, match_type, dismissed_by, created_at FROM stakeholder_alert_dismissals ORDER BY created_at DESC'
    );
    return res.json(rows);
  } catch (err) {
    console.error('saveStakeholderAlertDismissal error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const deleteStakeholderAlertDismissal = async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ message: 'id is required.' });
  try {
    await ensureDismissalsTable();
    await db.query('DELETE FROM stakeholder_alert_dismissals WHERE id = ?', [id]);
    const [rows] = await db.query(
      'SELECT id, alert_key, identifier, match_type, dismissed_by, created_at FROM stakeholder_alert_dismissals ORDER BY created_at DESC'
    );
    return res.json(rows);
  } catch (err) {
    console.error('deleteStakeholderAlertDismissal error:', err);
    return res.status(500).json({ message: 'Server error.' });
  }
};

const getDuplicateStakeholdersForMid = async (req, res) => {
  const { mid } = req.params;
  if (!mid) return res.status(400).json({ message: 'MID is required.' });
  try {
    const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
    const result = await getDuplicatesForMid(mid, { forceRefresh });
    return res.json(result);
  } catch (err) {
    console.error('getDuplicateStakeholdersForMid error:', err);
    return res.status(err.statusCode || 500).json({ message: err.message || 'Server error.' });
  }
};

module.exports = {
  getRequirements, getAllMerchants, saveMerchant,
  uploadDocument, uploadUrl, getDocuments,
  getMerchant, deleteMerchant, deleteDocument,
  runDataVerification, fetchExternalMerchant, runAiAnalysis, getLatestAnalysis,
  runFullApiVerification, runFullAnalysisForMid,
  triggerAutoRun, getAutoRunStatusHandler, stopAutoRunHandler,
  getAiUsage, downloadMerchantDocuments, fetchMerchantList, getDashboardStats,
  getRuleOverrides, saveRuleOverride, deleteRuleOverride,
  updateReviewStatus, downloadVerificationReport, downloadAllIssuesReport,
  getDuplicateStakeholders, getDuplicateStakeholdersForMid,
  getStakeholderAlertDismissals, saveStakeholderAlertDismissal, deleteStakeholderAlertDismissal,
  getExtractionCorrections, saveExtractionCorrection, deleteExtractionCorrection,
  // exported for offline verdict regression testing
  normalizeSystemDataForVerification, getRequirementRulesForMerchantType,
};
