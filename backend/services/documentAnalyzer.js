const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { recordUsage } = require('./costTracker');
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
};

// Documents that must never be sent to the AI — skipped at extraction time.
const SKIP_DOC_PATTERNS = [
  /duly.?filled.?agreement/i,
  /duly.?filled/i,
];

const isSkippedDoc = (label) =>
  label && SKIP_DOC_PATTERNS.some((re) => re.test(String(label)));

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
      // Prefer the human-readable title (e.g. "Form 01 / Form 40") over the raw API key
      // (e.g. "form_one_or_forty") so the AI understands compound labels correctly.
      const rawLabel = doc.label;
      const docType = (rawLabel && DOC_NAME_TO_TITLE[rawLabel])
        || (rawLabel ? rawLabel.replace(/_/g, ' ') : null)
        || (doc.document_name
          ? (DOC_NAME_TO_TITLE[doc.document_name] || doc.document_name.replace(/_/g, ' '))
          : 'Document');
      if (isSkippedDoc(docType) || isSkippedDoc(rawLabel) || isSkippedDoc(doc.document_name)) {
        console.log(`[documentAnalyzer] Skipping ignored document: "${docType}"`);
        return;
      }
      docs.push({ url, docType, label: docType, needsAuth: false, source });
    });
    return docs;
  }

  // Legacy format: separate per-entity arrays
  if (Array.isArray(data?.documents)) {
    data.documents.forEach((doc) => {
      const url = doc.url || (doc.path ? `${WEBXPAY_BASE}${doc.path}` : null);
      if (url && doc.upload_status !== 0) {
        const docType = resolveDocType(doc.file_detail, doc.document_name, doc.path);
        if (isSkippedDoc(docType) || isSkippedDoc(doc.file_detail) || isSkippedDoc(doc.document_name)) {
          console.log(`[documentAnalyzer] Skipping ignored document: "${docType}"`);
          return;
        }
        docs.push({ url, docType, label: docType, needsAuth: true, source: 'documents' });
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
  const response = await fetch(url, { headers: authHeaders, redirect: 'follow', timeout: 30000 });
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
    '=== CRITICAL — READ BEFORE EVERYTHING ELSE ===',
    `TODAY'S DATE (reference date): ${referenceDate}`,
    `You MUST use ${referenceDate} as the current date for ALL date comparisons in this analysis.`,
    `DO NOT use your model training cutoff or any assumed date. The ONLY valid reference date is ${referenceDate}.`,
    `Any document date whose year is less than ${referenceDate.slice(0, 4)} is UNCONDITIONALLY in the past — never flag it as future.`,
    `A date is "future" ONLY if it is strictly after ${referenceDate} under every reasonable format interpretation.`,
    '=== END CRITICAL CONTEXT ===',
    '',
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
    'DOCUMENT LABEL VALIDATION (mandatory for every uploaded file): For each document, compare the label (the expected document type) against the actual visual content. If the file content clearly does not match the label — for example a file labelled "Business Registration Certificate" that actually contains a National ID, or a file labelled "Bank Statement" that actually contains a passport — add a FaultyDocument entry with reason: "Document content does not match label: expected [label], found [actual document type detected from content]." Do this check before all other validation. If the content is unreadable or ambiguous, do not flag a mismatch — only flag when the content is clearly a different document type than the label.',
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

  // Download all documents in parallel — much faster than sequential for 8–12 docs.
  const results = await Promise.allSettled(
    filteredDocs.map(async (doc) => {
      const label = buildDocLabel(doc);
      const headers = doc.needsAuth ? authHeaders : {};
      const buffer = await downloadBuffer(doc.url, headers);
      const urlPath = doc.url.split('?')[0];
      const ext = path.extname(urlPath).toLowerCase() || '.pdf';
      if (buffer.length > MAX_INLINE_FILE_BYTES) {
        throw new Error(`File is ${(buffer.length / 1024 / 1024).toFixed(1)} MB, above inline limit`);
      }
      console.log(`[documentAnalyzer] Loaded "${label}" (${buffer.length} bytes)`);
      return { label, mimeType: mimeFromExt(ext), sizeBytes: buffer.length, data: buffer.toString('base64') };
    })
  );

  const loaded = [];
  const failures = [];
  results.forEach((result, i) => {
    const label = buildDocLabel(filteredDocs[i]);
    if (result.status === 'fulfilled') {
      loaded.push(result.value);
    } else {
      console.error(`[documentAnalyzer] Failed "${label}": ${result.reason?.message}`);
      failures.push({ label, error: result.reason?.message || 'Unknown error' });
    }
  });

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

  let response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        }),
        timeout: 180000,
      }
    );
  } catch (fetchErr) {
    if (fetchErr.type === 'request-timeout') {
      const err = new Error('Google AI request timed out after 3 minutes. The model may be overloaded. Please try again.');
      err.statusCode = 504;
      throw err;
    }
    if (fetchErr.type === 'request-timeout') {
      throw new Error('Google AI request timed out after 3 minutes. The model may be overloaded — please try again.');
    }
    throw fetchErr;
  }

  let bodyText;
  try {
    bodyText = await response.text();
  } catch (readErr) {
    const err = new Error('Google AI request timed out or connection dropped while reading response. Please try again.');
    err.statusCode = 504;
    throw err;
  }
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message = body?.error?.message || bodyText.slice(0, 500) || `HTTP ${response.status}`;
    const err = new Error(`Google AI request failed: ${message}`);
    err.statusCode = response.status === 429 ? 429 : 502;
    err.data = body?.error || body || bodyText.slice(0, 500);
    throw err;
  }

  const rawText = body?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();

  const usage = body?.usageMetadata || {};
  const { callCost } = recordUsage(
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

async function generateVerificationInsight(report) {
  const apiKey = getGoogleApiKey();
  if (!apiKey) return null;

  const lines = [];

  (report.mismatches || []).forEach((row) => {
    lines.push(`MISMATCH — Field: "${row.field}" | Document: "${row.document || '?'}" | AI read: "${row.documentValue ?? row.value}" | System has: "${row.systemValue}" | ${row.reason || ''}`);
  });

  (report.missingData || []).forEach((row) => {
    lines.push(`MISSING — Field/Document: "${row.field}" | ${row.reason || 'not found in extraction'}`);
  });

  (report.invalidData || []).forEach((row) => {
    lines.push(`INVALID — Field: "${row.field}" | ${row.reason || 'failed validation'}`);
  });

  if (lines.length === 0) return 'All verified fields matched. No issues requiring attention were found.';

  const prompt = `You are a merchant onboarding compliance analyst. Below are the issues found during document verification for a ${report.merchantType || 'merchant'} account:

${lines.join('\n')}

Write a concise plain-English summary (4–7 sentences) that:
- Explains each real issue clearly and what it means in practice
- Identifies if any mismatch is likely just a formatting difference vs a genuine data conflict
- Calls out if the same field conflicts across multiple documents or involves different people
- States exactly what the onboarding officer must do to resolve each issue before approval

Use **bold** to highlight field names, specific values, and critical action items. Be direct and specific. Use no jargon. Return only the summary text with **bold** markdown for emphasis — no JSON, no bullet points, no headings.`;

  try {
    const modelPath = GOOGLE_AI_MODEL.startsWith('models/') ? GOOGLE_AI_MODEL : `models/${GOOGLE_AI_MODEL}`;
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3 },
        }),
        timeout: 30000,
      }
    );
    const body = await resp.json();
    const usage = body?.usageMetadata || {};
    recordUsage(usage.promptTokenCount || 0, usage.candidatesTokenCount || 0);
    const text = (body?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    return text || null;
  } catch (err) {
    console.warn('[generateVerificationInsight] skipped:', err.message);
    return null;
  }
}

// After building a report, call this with the cross-document mismatches to let the AI
// decide which ones are semantically compatible (same meaning, different wording).
// Returns a Set of field names that are compatible — callers use patchReportCompatibleMismatches.
async function verifyCrossDocumentMismatches(mismatches) {
  const toCheck = mismatches.filter(
    (m) => m.documentValue && m.documentValue !== '—' && m.systemValue && m.systemValue !== '—'
  );
  if (!toCheck.length) return new Set();

  const apiKey = getGoogleApiKey();
  if (!apiKey) return new Set();

  const items = toCheck
    .map((m, i) => `${i + 1}. Field: "${m.field}" | Document A: "${m.documentValue}" | Document B: "${m.systemValue}"`)
    .join('\n');

  const prompt = `You are a merchant onboarding compliance analyst reviewing cross-document discrepancies.
For each field below, two documents contain different values. Decide which are SEMANTICALLY COMPATIBLE
(same meaning worded differently — e.g. "Book Shop, Communication" and "Stationery items" describe the
same type of retail business) versus GENUINELY DIFFERENT (a real data conflict that must be resolved).

${items}

Return ONLY a JSON array of 1-based item numbers that are semantically compatible. Return [] if none.
Be conservative: only mark items compatible when you are highly confident they mean the same thing.`;

  try {
    const modelPath = GOOGLE_AI_MODEL.startsWith('models/') ? GOOGLE_AI_MODEL : `models/${GOOGLE_AI_MODEL}`;
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${modelPath}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
        timeout: 30000,
      }
    );
    const body = await resp.json();
    const usage = body?.usageMetadata || {};
    recordUsage(usage.promptTokenCount || 0, usage.candidatesTokenCount || 0);
    const raw = (body?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    const indices = JSON.parse(raw);
    if (!Array.isArray(indices)) return new Set();
    const compatible = new Set();
    indices.forEach((idx) => {
      const item = toCheck[idx - 1];
      if (item) compatible.add(item.field);
    });
    if (compatible.size) {
      console.log(`[semanticCheck] Compatible cross-doc mismatch(es): ${[...compatible].join(', ')}`);
    }
    return compatible;
  } catch (err) {
    console.warn('[verifyCrossDocumentMismatches] AI check skipped:', err.message);
    return new Set();
  }
}

module.exports = { analyzeDocuments, generateVerificationInsight, verifyCrossDocumentMismatches };
