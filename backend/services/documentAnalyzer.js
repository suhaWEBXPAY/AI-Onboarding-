const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { isOverBudget, getRemainingBudget, recordUsage } = require('./costTracker');

const AI_BUDGET_USD = Number(process.env.AI_BUDGET_USD || 0.50);
const WEBXPAY_BASE = 'https://signup.webxpay.com';
const PROMPT_FILE = process.env.DOCUMENT_PROMPT_FILE
  || path.join(__dirname, '../../prompts/merchant_verification_prompt.md');
const GOOGLE_AI_MODEL = process.env.GOOGLE_AI_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MAX_INLINE_FILE_BYTES = Number(process.env.GOOGLE_AI_MAX_INLINE_FILE_MB || 15) * 1024 * 1024;

const FILE_DETAIL_EXPANSIONS = {
  br: 'Business Registration Certificate',
  brc: 'Business Registration Certificate',
  aoa: 'Articles of Association',
  boa: 'Board Resolution',
  'form 01': 'Form 01',
  'form 1': 'Form 01',
  'form 40': 'Form 40',
};

const DOC_NAME_TO_TITLE = {
  business_registration_certificate: 'Business Registration Certificate',
  form_one_or_forty: 'Form 01 / Form 40',
  articles_of_association: 'Articles of Association',
  board_resolution: 'Board Resolution',
  duly_filled_agreement: 'Duly Filled Agreement',
};

const SECTION_KEYS = [
  { key: 'document_prompts_corp', matches: ['private', 'public', 'limited', 'company', 'pvt', 'ltd', 'corp'] },
  { key: 'document_prompts_partnership', matches: ['partnership', 'partner', 'firm'] },
  { key: 'document_prompts_society_club_association', matches: ['society', 'club', 'association', 'ngo', 'charity'] },
  { key: 'document_prompts_individual', matches: ['individual', 'person'] },
  { key: 'document_prompts_prop', matches: ['sole', 'proprietor', 'prop'] },
];

function getGoogleApiKey() {
  return process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
}

function resolveDocType(fileDetail, documentName, filePath) {
  if (fileDetail) {
    const expanded = FILE_DETAIL_EXPANSIONS[fileDetail.toLowerCase().trim()];
    return expanded || fileDetail;
  }
  if (documentName) {
    return DOC_NAME_TO_TITLE[documentName] || documentName.replace(/_/g, ' ');
  }
  return filePath ? path.basename(filePath, path.extname(filePath)).replace(/_/g, ' ') : 'Document';
}

function loadPromptSection(merchantTypeName = '') {
  const content = fs.readFileSync(PROMPT_FILE, 'utf-8');
  const normalized = merchantTypeName.toLowerCase();
  const matched = SECTION_KEYS.find((s) => s.matches.some((m) => normalized.includes(m)));
  const sectionKey = matched ? matched.key : 'document_prompts_corp';

  const startMarker = `[${sectionKey}]`;
  const start = content.indexOf(startMarker);
  if (start === -1) return content.trim();

  const nextSection = content.indexOf('\n[document_prompts_', start + startMarker.length);
  const section = nextSection === -1
    ? content.slice(start + startMarker.length)
    : content.slice(start + startMarker.length, nextSection);

  console.log(`[documentAnalyzer] Prompt section: ${sectionKey} (${section.length} chars)`);
  return section.trim();
}

function extractDocumentsFromWebxpay(webxpayData) {
  const docs = [];
  const data = webxpayData?.data || webxpayData;

  // Current WebXPay API format: all documents in data.all_documents with S3 presigned URLs
  if (Array.isArray(data?.all_documents) && data.all_documents.length > 0) {
    data.all_documents.forEach((doc) => {
      const source = doc.source || 'all_documents';
      if (['outlet', 'outlets'].includes(String(source).toLowerCase().trim())) return;

      const url = doc.url || (doc.path ? `${WEBXPAY_BASE}${doc.path}` : null);
      if (!url) return;
      // S3 presigned URLs carry their own auth — no extra headers needed
      const docType = doc.label
        || (doc.document_name
          ? (DOC_NAME_TO_TITLE[doc.document_name] || doc.document_name.replace(/_/g, ' '))
          : 'Document');
      docs.push({ url, docType, label: docType, needsAuth: false, source });
    });
    return docs;
  }

  // Legacy format: separate per-entity arrays
  if (Array.isArray(data?.documents)) {
    data.documents.forEach((doc) => {
      const url = doc.url || (doc.path ? `${WEBXPAY_BASE}${doc.path}` : null);
      if (url && doc.upload_status !== 0) {
        docs.push({
          url,
          docType: resolveDocType(doc.file_detail, doc.document_name, doc.path),
          label: resolveDocType(doc.file_detail, doc.document_name, doc.path),
          needsAuth: true,
          source: 'documents',
        });
      }
    });
  }

  if (Array.isArray(data?.stakeholders)) {
    data.stakeholders.forEach((stakeholder) => {
      const name = [
        stakeholder.name_of_registered_director_partner,
        stakeholder.last_name_of_rdp,
      ].filter(Boolean).join(' ');
      const idType = stakeholder.document_type || 'NIC';

      const addDoc = (url, side) => {
        if (!url) return;
        docs.push({ url, docType: idType, label: `${idType} ${side}`, director: name, side, needsAuth: true, source: 'stakeholders' });
      };

      addDoc(
        stakeholder.id_copy_director_url
          || (stakeholder.id_copy_director ? `${WEBXPAY_BASE}${stakeholder.id_copy_director}` : null),
        'Front'
      );
      addDoc(
        stakeholder.id_copy_director_back_url
          || (stakeholder.id_copy_director_back ? `${WEBXPAY_BASE}${stakeholder.id_copy_director_back}` : null),
        'Back'
      );
      addDoc(
        stakeholder.passport_copy_url
          || (stakeholder.passport_copy ? `${WEBXPAY_BASE}${stakeholder.passport_copy}` : null),
        'Passport'
      );
    });
  }

  const bankUrl = data?.bank_account?.three_month_bank_statement_url
    || (data?.bank_account?.three_month_bank_statement
      ? `${WEBXPAY_BASE}${data.bank_account.three_month_bank_statement}`
      : null);
  if (bankUrl) {
    docs.push({ url: bankUrl, docType: 'Bank Statement', label: 'Bank Statement', period: '3 months', needsAuth: true, source: 'bank_account' });
  }

  return docs;
}

async function downloadBuffer(url, authHeaders) {
  const response = await fetch(url, { headers: authHeaders, redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url.slice(0, 80)}`);
  return response.buffer();
}

function mimeFromExt(ext) {
  switch (ext.toLowerCase()) {
    case '.pdf': return 'application/pdf';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}

function buildDocLabel(doc) {
  const parts = [`LABEL: ${doc.label || doc.docType}`, `API_SOURCE: ${doc.source || 'document_api'}`];
  if (doc.director) parts.push(`DIRECTOR: ${doc.director}`);
  if (doc.side) parts.push(`SIDE: ${doc.side}`);
  if (doc.period) parts.push(`PERIOD: ${doc.period}`);
  if (doc.outlet) parts.push(`OUTLET: ${doc.outlet}`);
  return parts.join(' | ');
}

function buildAnalysisInstruction(promptText, merchantTypeName, loadedDocs) {
  const referenceDate = new Date().toISOString().slice(0, 10);
  const docSummary = loadedDocs.map((doc, index) => ({
    index: index + 1,
    label: doc.label,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
  }));

  return [
    promptText,
    '',
    '--- SYSTEM EXECUTION CONTEXT ---',
    `Reference date: ${referenceDate}`,
    `Merchant type: ${merchantTypeName || 'Unknown'}`,
    `Documents attached: ${JSON.stringify(docSummary, null, 2)}`,
    '',
    'Analyze only the attached document files and their document labels.',
    'Do not copy values from any external system/API data; external API comparison is performed separately by the application.',
    'The selected merchant prompt is the source of truth for required documents, expected fields, merchant-type rules, and output structure.',
    'Treat labels such as "ID Copy", "ID Copies", "Identity Document", "NIC", "Passport", "Driving License", and "Driving Licence" as identity-document uploads; determine the exact document type from the document content.',
    'For every field named in the selected merchant prompt output structure, check whether the value is present in the documents.',
    'Extract all visible document data, verify document validity, identify missing documents/fields, invalid data, faulty documents, and document-only compliance issues.',
    '',
    'Always include these top-level arrays in the JSON response, even when empty:',
    '- "PromptFieldCoverage": array of { "section": "", "source": "", "document": "", "field": "", "required": true, "present": true, "value": "", "status": "present|missing|invalid|not_applicable", "reason": "" } for prompt-defined fields.',
    '- "MissingFields": array of { "section": "", "source": "", "document": "", "field": "", "reason": "" } for prompt-defined fields that are required, missing, unreadable, or empty.',
    '- "InvalidData": array of { "section": "", "source": "", "document": "", "field": "", "value": "", "reason": "" } for invalid, expired, inconsistent, or rule-failing document data.',
    '- "CrossDocumentMismatches": array of { "field": "", "leftSource": "", "leftDocument": "", "leftValue": "", "rightSource": "", "rightDocument": "", "rightValue": "", "reason": "" } for mismatches between document sources only.',
    '- "DocumentPresence": array of { "source": "", "document": "", "required": true, "present": true, "status": "present|missing|invalid", "reason": "" }.',
    'Each attached document label is formatted as LABEL: <api label> | API_SOURCE: <api source>.',
    'Use LABEL as the "document" value and UI document name. Never use API_SOURCE as the document name when LABEL is available.',
    'Use API_SOURCE only as source metadata. Do not create PromptFieldCoverage, DocumentPresence, MissingFields, InvalidData, or CrossDocumentMismatches entries when API_SOURCE is "outlet" or "outlets".',
    'Do not include external system/API mismatch results in these arrays; the application performs API-vs-document comparison after this step.',
    'Return ONLY one valid JSON object. No markdown fences, no explanation, no text outside JSON.',
  ].join('\n');
}

function parseJsonFromModel(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Google AI returned an empty response.');

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch (err) {
    const first = withoutFence.indexOf('{');
    const last = withoutFence.lastIndexOf('}');
    if (first >= 0 && last > first) {
      return JSON.parse(withoutFence.slice(first, last + 1));
    }
    throw err;
  }
}

async function loadRemoteDocuments(webxpayData, authHeaders, _requirements = []) {
  const remoteDocs = extractDocumentsFromWebxpay(webxpayData);
  const filteredDocs = remoteDocs;
  console.log(`[documentAnalyzer] Google AI phase - ${filteredDocs.length}/${remoteDocs.length} non-outlet API document(s) queued`);

  const loaded = [];
  const failures = [];

  for (const doc of filteredDocs) {
    const label = buildDocLabel(doc);
    try {
      const headers = doc.needsAuth ? authHeaders : {};
      const buffer = await downloadBuffer(doc.url, headers);
      const urlPath = doc.url.split('?')[0];
      const ext = path.extname(urlPath).toLowerCase() || '.pdf';
      if (buffer.length > MAX_INLINE_FILE_BYTES) {
        throw new Error(`File is ${(buffer.length / 1024 / 1024).toFixed(1)} MB, above inline limit`);
      }
      loaded.push({
        label,
        mimeType: mimeFromExt(ext),
        sizeBytes: buffer.length,
        data: buffer.toString('base64'),
      });
      console.log(`[documentAnalyzer] Loaded "${label}" (${buffer.length} bytes)`);
    } catch (err) {
      console.error(`[documentAnalyzer] Failed "${label}": ${err.message}`);
      failures.push({ label, error: err.message });
    }
  }

  return { loaded, failures };
}

function loadLocalDocuments(localDocuments, uploadsRoot) {
  const loaded = [];
  const failures = [];

  if (!localDocuments?.length) return { loaded, failures };

  localDocuments.forEach((doc) => {
    const uploadPath = doc.upload_path || '';
    if (!uploadPath || uploadPath.startsWith('http')) return;

    const filepath = path.join(uploadsRoot, uploadPath);
    const label = `DOCUMENT TYPE: ${doc.document_type || 'Uploaded Document'}`;
    try {
      if (!fs.existsSync(filepath)) throw new Error('Local file not found');
      const buffer = fs.readFileSync(filepath);
      if (buffer.length > MAX_INLINE_FILE_BYTES) {
        throw new Error(`File is ${(buffer.length / 1024 / 1024).toFixed(1)} MB, above inline limit`);
      }
      loaded.push({
        label,
        mimeType: mimeFromExt(path.extname(filepath)),
        sizeBytes: buffer.length,
        data: buffer.toString('base64'),
      });
      console.log(`[documentAnalyzer] Loaded local "${label}" (${buffer.length} bytes)`);
    } catch (err) {
      console.error(`[documentAnalyzer] Failed local "${label}": ${err.message}`);
      failures.push({ label, error: err.message });
    }
  });

  return { loaded, failures };
}

async function callGoogleAi(prompt, loadedDocs, failedDocs) {
  const apiKey = getGoogleApiKey();
  if (!apiKey) {
    throw new Error('Google AI API key not configured. Set GOOGLE_AI_API_KEY or GEMINI_API_KEY in backend/.env.');
  }

  if (isOverBudget(AI_BUDGET_USD)) {
    const remaining = getRemainingBudget(AI_BUDGET_USD);
    throw new Error(
      `AI analysis budget limit of $${AI_BUDGET_USD.toFixed(2)} has been reached. ` +
      `Remaining: $${remaining.toFixed(5)}. Contact admin to reset the budget.`
    );
  }

  const parts = [{ text: prompt }];

  failedDocs.forEach((doc) => {
    parts.push({ text: `DOCUMENT LOAD FAILURE: ${doc.label}\nReason: ${doc.error}` });
  });

  loadedDocs.forEach((doc) => {
    parts.push({ text: `Attached document: ${doc.label}` });
    parts.push({
      inline_data: {
        mime_type: doc.mimeType,
        data: doc.data,
      },
    });
  });

  const modelPath = GOOGLE_AI_MODEL.startsWith('models/')
    ? GOOGLE_AI_MODEL
    : `models/${GOOGLE_AI_MODEL}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generation_config: {
          temperature: 0.1,
          response_mime_type: 'application/json',
        },
      }),
    }
  );

  const bodyText = await response.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message = body?.error?.message || bodyText.slice(0, 500) || `HTTP ${response.status}`;
    throw new Error(`Google AI request failed: ${message}`);
  }

  const rawText = body?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();

  const usage = body?.usageMetadata || {};
  recordUsage(
    usage.promptTokenCount || usage.totalTokenCount || 0,
    usage.candidatesTokenCount || 0
  );
  console.log(`[documentAnalyzer] Google AI response: ${rawText?.length ?? 0} chars | model=${GOOGLE_AI_MODEL}`);

  return parseJsonFromModel(rawText);
}

async function analyzeDocuments({ merchantTypeName, webxpayData, authHeaders, localDocuments, uploadsRoot, requirements = [] }) {
  const promptText = loadPromptSection(merchantTypeName);
  const remote = webxpayData ? await loadRemoteDocuments(webxpayData, authHeaders, requirements) : { loaded: [], failures: [] };
  const local = loadLocalDocuments(localDocuments, uploadsRoot);
  const loadedDocs = [...remote.loaded, ...local.loaded];
  const failedDocs = [...remote.failures, ...local.failures];

  if (loadedDocs.length === 0) {
    throw new Error('No documents could be loaded from the API or local uploads.');
  }

  const instruction = buildAnalysisInstruction(promptText, merchantTypeName, loadedDocs);
  const result = await callGoogleAi(instruction, loadedDocs, failedDocs);

  result._analysisMetadata = {
    provider: 'google_ai',
    model: GOOGLE_AI_MODEL,
    documentsAnalyzed: loadedDocs.map(({ data, ...doc }) => doc),
    documentLoadFailures: failedDocs,
    generatedAt: new Date().toISOString(),
  };

  return result;
}

module.exports = { analyzeDocuments };
