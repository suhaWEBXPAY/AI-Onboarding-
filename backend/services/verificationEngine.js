const SOURCE_DOCUMENTS = 'Google AI Document Extraction';
const SOURCE_SYSTEM = 'External System API';

// Top-level keys in the AI response that are metadata, NOT extractable document fields.
// Excluding these prevents internal AI tracking sections appearing in the results table.
const AI_METADATA_SECTION_KEYS = new Set([
  'faultydocument',
  'documentrequirements',
  'warnings',
  'onboardingeligibility',
  'satisfactionascore',
  'satisfactionasocre', // AI typo variant — "Socre" instead of "Score"
  'satisfactionscore',
  'promptfieldcoverage',
  'documentpresence',
  'analysismetadata',
  // AI internal tracking sections
  'missingfields',
  'missingdata',
  'fieldcoverage',
  'invaliddata',
  'invalidfields',
  'crossdocumentmismatches',
  'documentmismatches',
  'mismatches',
  'aifinings',
  'aifindings',
  // website insights has no WebXPay system counterpart — excluded from flat comparison
  'websiteinsights',
  'websiteinfo',
  'websitedata',
  // shareholder data is AI-internal — no WebXPay system counterpart
  'shareholdersinformation',
  // amendment notes are narrative text, not field data
  'amendments',
]);

// Canonical field names from the WebXPay system data that are internal/operational
// and must never appear as "System Data" rows in the results table.
const SYSTEM_SKIP_CANONICAL = new Set([
  // internal numeric IDs
  'merchantid', 'signupmerchantid', 'webxpartnerid',
  'provinceid', 'districtid', 'cityid', 'outletcity',
  'bankid', 'bankbranchid', 'outletbankid', 'outletbankbranchid', 'categorycodeid',
  // status / verification flags
  'isactive', 'idstatus', 'rmstatus', 'creditstatus', 'issignatory',
  'rmverificationstatus', 'creditbusinessinfoverificationstatus',
  'creditbankaccountverificationstatus', 'uploadstatusbankconfirmation',
  'uploadstatusbankstatement', 'locationstatusrdp', 'addressverification',
  'nationalityverification',
  // timestamps
  'createdat', 'updatedat',
  // document file paths and signed S3 URLs
  'idcopydirector', 'idcopydirectorback', 'idcopydirectorurl', 'idcopydirectorbackurl',
  'threemonthbankstatement', 'threemonthbankstatementurl',
  'outletthreemonthbankstatement', 'outletthreemonthbankstatementurl',
  // WebXPay staff / KYC officer fields
  'witness1name', 'witness1email', 'witness1nic',
  'witness2name', 'witness2email', 'witness2nic',
  'representativename', 'representativeemail', 'verifiedandinspectedby',
  'merchantlocationtype', 'furthercommentsbyinspector', 'businesssize',
  // operational / business config
  'averagemonthlysalesvolume', 'averageticketsize', 'averagemonthlycount',
  'sizeofbusiness', 'deliverymethod', 'deliverydays',
  'maximumtransactionvalue', 'minimumtransactionvalue',
  // compliance flags not present in documents
  'taxliability', 'usstakeholder', 'politicalaffiliations', 'secondarycountryrdp',
  // financial asset declarations
  'residentalpropertyvalue', 'businesspremisesvalue',
  'motorvehicles', 'financialassets', 'investments',
  // numeric type/category codes (not human-readable)
  'typeofbusiness',
  // outlet/terminal counts
  'noofterminals', 'countryrdp',
  // invalid system date placeholder (0000-00-00)
  'visaexpirydate',
  // duplicate/internal address fields
  // NOTE: street_address_business is intentionally NOT skipped — it is the true
  // counterpart for a document's "Business Address" (street_address is the
  // owner's legal/home address and produced false mismatches).
  'cityidbusiness', 'zipcodebusiness',
]);

const DOC_LIST_KEYS = [
  'documents',
  'documentData',
  'document_data',
  'docs',
  'files',
  'items',
  'records',
];

const DOC_NAME_KEYS = [
  'label',
  'documentLabel',
  'document_label',
  'documentType',
  'document_type',
  'documentName',
  'document_name',
  'type',
  'name',
  'required_docs',
];

const DOC_SOURCE_KEYS = [
  'source',
  'apiSource',
  'api_source',
  'documentSource',
  'document_source',
];

const DOC_DATA_KEYS = [
  'fields',
  'data',
  'extractedData',
  'extracted_data',
  'values',
  'payload',
  'content',
];

const AI_FIELD_COVERAGE_KEYS = [
  'PromptFieldCoverage',
  'promptFieldCoverage',
  'prompt_field_coverage',
  'FieldCoverage',
  'fieldCoverage',
  'field_coverage',
];

const AI_MISSING_FIELD_KEYS = [
  'MissingFields',
  'missingFields',
  'missing_fields',
  'RequiredMissingFields',
  'requiredMissingFields',
  'required_missing_fields',
];

const AI_INVALID_DATA_KEYS = [
  'InvalidData',
  'invalidData',
  'invalid_data',
  'InvalidFields',
  'invalidFields',
  'invalid_fields',
];

const AI_CROSS_DOCUMENT_MISMATCH_KEYS = [
  'CrossDocumentMismatches',
  'crossDocumentMismatches',
  'cross_document_mismatches',
  'DocumentMismatches',
  'documentMismatches',
  'document_mismatches',
  'Mismatches',
  'mismatches',
];

const AI_DOCUMENT_PRESENCE_KEYS = [
  'DocumentPresence',
  'documentPresence',
  'document_presence',
];

const FIELD_ALIAS_GROUPS = [
  [
    'customer_name',
    'customer name',
    'account_holder_name',
    'account holder name',
    'account_name',
    'account name',
    'bank_account_name',
    'bank account name',
  ],
  [
    'company_name',
    'company name',
    'business_name',
    'business name',
    'merchant_business_name',
    'merchant business name',
    'registered_name_of_business',
    'registered name of business',
    'name_of_company_business',
    'name of company business',
  ],
  [
    'registration_number',
    'registration number',
    'business_registration_number',
    'business registration number',
    'br_number',
    'brc_number',
    'company_registration_number',
    'company registration number',
  ],
  [
    'registration_date',
    'registration date',
    'date_of_registration',
    'date of registration',
    'incorporation_date',
    'date_of_incorporation',
  ],
  [
    'business_address',
    'business address',
    'legal_address',
    'legal address',
    'registered_address',
    'registered address',
    'street_address',
    'street address',
    'customer_address',
    'customer address',
  ],
  [
    'owner_address',
    'owner address',
    'present_address',
    'present address',
    'residential_address',
    'residential address',
    'address',
  ],
  [
    'nature_of_business',
    'nature of business',
    'business_nature',
    'business nature',
    'business_activity',
    'business activity',
  ],
  [
    'bank_branch',
    'bank branch',
    'bank_branch_name',
    'bank branch name',
    'branch_name',
    'branch name',
  ],
  [
    'account_number',
    'account number',
    'bank_account_number',
    'bank account number',
  ],
  [
    'nic_number',
    'nic number',
    'nic_passport_dl_number',
    'nic/passport/dl number',
    'nic passport dl number',
    'nic_passport_driving_license_number',
    'nic/passport/driving license number',
    'nic passport driving license number',
    'owner_nic',
    'owner nic',
    'id_number',
    'id number',
    'id',             // stakeholders[n].id in WebXPay is the NIC
    'stakeholder_id',
    'stakeholder id',
    'nic',
    'passport_number',
    'passport number',
    'driving_license_number',
    'driving license number',
    'driving_licence_number',
    'driving licence number',
    'driver_license_number',
    'driver license number',
    'driver_licence_number',
    'driver licence number',
    'dl_number',
    'dl number',
  ],
  [
    'name',           // stakeholders[n].name in WebXPay — full name stored here
    'full_name',
    'full name',
    'owner_name',
    'owner name',
    'first_name',
    'first name',
    'firstname',
    'given_name',
    'given name',
  ],
  [
    'postal_code',
    'postal code',
    'zip_code',
    'zip code',
    'postcode',
  ],
  [
    'catcode',
    'mcc',
    'merchant_category_code',
    'merchant category code',
    'category_code',
  ],
  [
    'district',
    'district_id',
    'district id',
    'district_name',
    'district name',
  ],
  [
    'designation',
    'role',
    'position',
    'stakeholder_designation',
    'stakeholder designation',
  ],
  // citizenship maps to country in the system API — "Sri Lankan" near-matches "Sri Lanka"
  [
    'citizenship',
    'country',
    'country_citizenship',
    'resident_country',
  ],
  [
    'date_of_birth',
    'date of birth',
    'dob',
    'birth_date',
    'birthdate',
  ],
  [
    'gender',
    'sex',
  ],
  [
    'document_type',
    'document type',
    'documenttype',
    'id_type',
    'id type',
    'identity_document_type',
  ],
];


const normalizeKey = (value = '') => String(value)
  .toLowerCase()
  .replace(/&/g, 'and')
  .replace(/[^a-z0-9]/g, '');

const isIgnoredSource = (value = '') => ['outlet', 'outlets', 'na'].includes(normalizeKey(value));

const FIELD_ALIAS_LOOKUP = FIELD_ALIAS_GROUPS.reduce((lookup, group) => {
  const normalizedGroup = [...new Set(group.map(normalizeKey).filter(Boolean))];
  normalizedGroup.forEach((key) => {
    lookup[key] = normalizedGroup;
  });
  return lookup;
}, {});

const normalizeDocName = (value = '') => String(value)
  .toLowerCase()
  // Underscores are word characters, so \b-anchored replacements below never fire
  // inside labels like "upload_nat_business_doc" — split separators first.
  .replace(/[_-]+/g, ' ')
  // WebXPay label abbreviation: "upload nat business doc" = Nature of Business document
  .replace(/\bnat\b/g, 'nature')
  .replace(/\bbrc\b/g, 'business registration certificate')
  .replace(/\bnic\b/g, 'national identity card')
  .replace(/\bdl\b/g, 'driving licence')
  .replace(/\bdriver'?s?\s+license\b/g, 'driving licence')
  .replace(/\bdriving\s+license\b/g, 'driving licence')
  .replace(/\bthree\s+month\s+bank\s+statement\b/g, 'bank statement')
  .replace(/\bbank\s+(account\s+)?confirmation(\s+letter)?\b/g, 'bank statement')
  .replace(/\bbank\s+letter\b/g, 'bank statement')
  .replace(/\bid\s*copy\b/g, 'identity document')
  .replace(/\bid\s*copies\b/g, 'identity document')
  .replace(/\bnational\s+identity\s+card\b/g, 'identity document')
  .replace(/\bpassport\b/g, 'identity document')
  .replace(/\bdriving\s+licence\b/g, 'identity document')
  .replace(/\baoa\b/g, 'articles of association')
  .replace(/\bboa\b/g, 'board resolution')
  // Form number aliases — handle underscore and word forms before stripping
  .replace(/form[_\s]one(?:[_\s]or[_\s]forty)?/g, 'form 1')
  .replace(/\bform[_\s]0*1\b/g, 'form 1')
  .replace(/\bform[_\s]0*20\b/g, 'form 20')
  .replace(/\bform[_\s]twenty\b/g, 'form 20')
  .replace(/\bform[_\s]0*13\b/g, 'form 13')
  .replace(/\bform[_\s]thirteen\b/g, 'form 13')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const humanizeKey = (value = '') => {
  const text = String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();

  if (!text) return 'Unknown field';
  return text.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
};

const isPlainObject = (value) => (
  value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && !(value instanceof Date)
);

// Placeholder strings the AI emits for absent values — treated as blank so they
// are never compared, matched, or format-validated as real data.
const NA_PLACEHOLDERS = new Set([
  'na', 'notapplicable', 'notavailable', 'notfound', 'none', 'null', 'unreadable', 'unknown',
]);

const isBlank = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed === '-') return true;
    return NA_PLACEHOLDERS.has(trimmed.toLowerCase().replace(/[^a-z]/g, ''));
  }
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
};

const displayValue = (value) => {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
};

const sentence = (value = '') => {
  const text = String(value || '').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
};

// Sri Lankan NIC: old format is 9 digits + V/X (e.g. 640453060V); new format is
// 12 digits (e.g. 196404503060). They map 1:1 — the same person carries both,
// and a single ID card prints the new number on the front and the old on the
// back. Convert old → new so a document quoting one format matches a source
// quoting the other.  old YY DDD SSS C  ->  new 19YY DDD 0SSS
const oldNicToNew = (d9) => `19${d9.slice(0, 5)}0${d9.slice(5)}`;

const normalizeIdentityToken = (value = '') => {
  const cleaned = String(value || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  // New-format 12-digit NIC that picked up a trailing V/X from OCR.
  if (cleaned.length === 13 && /^\d{12}[vx]$/.test(cleaned)) return cleaned.slice(0, 12);
  // AI hybrid: century prefix glued onto the OLD format ("19" + 9 digits + V,
  // e.g. 19740240013V) — canonicalise like an old NIC with that century.
  const hybrid = cleaned.match(/^(19|20)(\d{9})[vx]$/);
  if (hybrid) return `${hybrid[1]}${hybrid[2].slice(0, 5)}0${hybrid[2].slice(5)}`;
  // Old 9-digit + V/X format → canonical new 12-digit form.
  if (/^\d{9}[vx]$/.test(cleaned)) return oldNicToNew(cleaned.slice(0, 9));
  return cleaned;
};

const STRICT_IDENTITY_TOKEN_RE = /\b(?:[A-Z]{1,3}\d{6,9}|\d{9}\s*[VX]|\d{11}[VX]|\d{12}[VX]?)\b/g;
const LOOSE_IDENTITY_TOKEN_RE = /\b(?:[A-Z]{1,3}\d{5,10}|\d{9}\s*[VX]|\d{11}[VX]|\d{12}[VX]?|\d{6,10})\b/g;

const extractIdentityTokens = (value = '', options = {}) => {
  const text = String(value || '').toUpperCase();
  // Tolerate a space before the old-format check letter ("640453060 V").
  // \d{11}[VX] catches the AI's hybrid "century + old format" form.
  // In explicit identity contexts, also accept numeric passport / driving
  // licence values such as UK passport number "129384735".
  const matches = text.match(options.loose ? LOOSE_IDENTITY_TOKEN_RE : STRICT_IDENTITY_TOKEN_RE) || [];
  return [...new Set(matches.map(normalizeIdentityToken).filter(Boolean))];
};

const isIdentityValueContext = (...parts) => {
  const raw = parts.map((part) => String(part || '')).join(' ');
  const key = normalizeKey(raw);
  const partKeys = parts.map((part) => normalizeKey(part || '')).filter(Boolean);
  const docName = normalizeDocName(raw);
  return partKeys.some((partKey) => isIdentityComparisonContext(partKey))
    || isIdentityComparisonContext(key)
    || docName.includes('identity document')
    || docName.includes('passport')
    || docName.includes('driving licence')
    || /\b(dl|licen[cs]e)\b/i.test(raw);
};

const extractIdentityTokensForContext = (value, ...contextParts) => extractIdentityTokens(value, {
  loose: isIdentityValueContext(...contextParts),
});

// True when a free-text reason cites two or more distinct NIC/identity
// representations that all resolve to the SAME canonical identity — i.e. the
// "mismatch" is only an old-vs-new NIC format difference, not a real conflict.
const isPureIdentityFormatMismatch = (text = '') => {
  const raw = String(text || '').toUpperCase().match(STRICT_IDENTITY_TOKEN_RE) || [];
  const distinctRaw = new Set(raw.map((t) => t.replace(/\s/g, '')));
  if (distinctRaw.size < 2) return false;
  const canonical = new Set([...distinctRaw].map(normalizeIdentityToken).filter(Boolean));
  return canonical.size === 1;
};

const isValidNicToken = (value) => /^(\d{9}[vx]|\d{12})$/.test(normalizeIdentityToken(value));
const isValidPassportToken = (value) => /^([a-z]{1,3}\d{5,10}|\d{6,10})$/.test(normalizeIdentityToken(value));
const isValidDrivingLicenseToken = (value) => (
  /^[a-z0-9]{6,12}$/.test(normalizeIdentityToken(value)) && !isValidNicToken(value)
);
const isValidIdentityToken = (value) => (
  isValidNicToken(value) || isValidPassportToken(value) || isValidDrivingLicenseToken(value)
);

const identityTokenType = (value) => {
  if (isValidNicToken(value)) return 'nic';
  if (isValidPassportToken(value)) return 'passport';
  if (isValidDrivingLicenseToken(value)) return 'driving_license';
  return null;
};

const identityTypesIn = (value = '') => new Set(
  extractIdentityTokens(value).map(identityTokenType).filter(Boolean)
);

const hasCrossTypeIdentityPair = (left = '', right = '') => {
  const leftTokens = extractIdentityTokens(left, { loose: true });
  const rightTokens = extractIdentityTokens(right, { loose: true });
  if (!leftTokens.length || !rightTokens.length) return false;
  if (leftTokens.some((token) => rightTokens.includes(token))) return false;

  const leftTypes = new Set(leftTokens.map(identityTokenType).filter(Boolean));
  const rightTypes = new Set(rightTokens.map(identityTokenType).filter(Boolean));
  if (!leftTypes.size || !rightTypes.size) return false;

  return ![...leftTypes].some((type) => rightTypes.has(type));
};

const hasMixedIdentityTypesInText = (value = '') => {
  const types = identityTypesIn(value);
  return types.has('nic') && types.has('passport');
};

const isIdentityComparisonContext = (key = '') => (
  key.includes('nic')
  || key.includes('passport')
  || key.includes('nationalidentity')
  || key.includes('drivinglicense')
  || key.includes('drivinglicence')
  || key.includes('driverlicense')
  || key.includes('driverlicence')
  || key.includes('dlnumber')
  || key.includes('idnumber')
  || key.includes('stakeholderid')
  || key === 'id'
  || key === 'idid'
);

const flattenObject = (input, prefix = '', rows = []) => {
  if (Array.isArray(input)) {
    input.forEach((item, index) => {
      flattenObject(item, prefix ? `${prefix}.${index}` : String(index), rows);
    });
    return rows;
  }

  if (isPlainObject(input)) {
    Object.entries(input).forEach(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (Array.isArray(value) || isPlainObject(value)) {
        flattenObject(value, path, rows);
      } else {
        rows.push({
          field: key,
          label: humanizeKey(key),
          path,
          canonical: normalizeKey(key),
          pathCanonical: normalizeKey(path),
          value,
        });
      }
    });
    return rows;
  }

  if (prefix) {
    rows.push({
      field: prefix,
      label: humanizeKey(prefix),
      path: prefix,
      canonical: normalizeKey(prefix),
      pathCanonical: normalizeKey(prefix),
      value: input,
    });
  }

  return rows;
};

const firstValueByKeys = (item, keys) => {
  if (!isPlainObject(item)) return undefined;
  const entries = Object.entries(item);
  for (const requestedKey of keys) {
    const normalizedKey = normalizeKey(requestedKey);
    const match = entries.find(([key]) => normalizeKey(key) === normalizedKey);
    if (match) return match[1];
  }
  return undefined;
};

const firstNonBlankByKeys = (item, keys) => {
  const value = firstValueByKeys(item, keys);
  return isBlank(value) ? undefined : value;
};

const aiArraysFor = (payload, keys) => {
  if (!isPlainObject(payload)) return [];
  return keys.flatMap((key) => {
    const value = firstValueByKeys(payload, [key]);
    return Array.isArray(value) ? value : [];
  });
};

const aiBool = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return undefined;
  const normalized = normalizeKey(value);
  if (['true', 'yes', 'y', 'present', 'found', '1'].includes(normalized)) return true;
  if (['false', 'no', 'n', 'missing', 'absent', 'notfound', '0'].includes(normalized)) return false;
  return undefined;
};

const aiStatus = (item) => normalizeKey(
  firstNonBlankByKeys(item, ['status', 'state', 'result', 'verificationStatus', 'verification_status']) || ''
);

const aiField = (item, fallback = 'Prompt field') => {
  if (typeof item === 'string') return item;
  return firstNonBlankByKeys(item, [
    'field',
    'fieldName',
    'field_name',
    'name',
    'promptField',
    'prompt_field',
    'dataItem',
    'data_item',
  ]) || fallback;
};

const aiSection = (item) => firstNonBlankByKeys(item, [
  'section',
  'sectionName',
  'section_name',
  'group',
  'category',
]);

const aiDocument = (item, fallback = 'Prompt document') => (
  firstNonBlankByKeys(item, [
    'label',
    'documentLabel',
    'document_label',
    'document',
    'documentName',
    'document_name',
    'Document Name',
    'documentType',
    'document_type',
    'sourceDocument',
    'source_document',
    'source',
    'apiSource',
    'api_source',
  ])
  || aiSection(item)
  || fallback
);

const aiSource = (item, fallback = 'Prompt source') => (
  firstNonBlankByKeys(item, [
    'source',
    'apiSource',
    'api_source',
    'documentSource',
    'document_source',
    'apiSourceName',
    'api_source_name',
  ])
  || fallback
);

const isIgnoredItemSource = (item) => (
  isIgnoredSource(aiSource(item, '')) || isIgnoredSource(aiDocument(item, ''))
);

const aiReason = (item, fallback) => (
  typeof item === 'string'
    ? fallback
    : (firstNonBlankByKeys(item, ['reason', 'Reason', 'issue', 'comment', 'remarks', 'remark']) || fallback)
);

const omitKeys = (item, keys) => {
  if (!isPlainObject(item)) return item;
  const normalizedKeys = keys.map(normalizeKey);
  return Object.entries(item).reduce((acc, [key, value]) => {
    if (!normalizedKeys.includes(normalizeKey(key))) acc[key] = value;
    return acc;
  }, {});
};

const unwrapDocumentArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (!isPlainObject(payload)) return [];

  for (const key of DOC_LIST_KEYS) {
    const value = firstValueByKeys(payload, [key]);
    if (Array.isArray(value)) return value;
    if (isPlainObject(value)) {
      const nested = unwrapDocumentArray(value);
      if (nested.length) return nested;
    }
  }

  if (isPlainObject(payload.data)) {
    const nested = unwrapDocumentArray(payload.data);
    if (nested.length) return nested;
  }

  return [];
};

const normalizeApiDocuments = (payload) => {
  const arrayPayload = unwrapDocumentArray(payload);

  if (arrayPayload.length) {
    return arrayPayload
      .filter((item) => !isIgnoredSource(firstValueByKeys(item, DOC_SOURCE_KEYS)))
      .map((item, index) => {
      const source = firstValueByKeys(item, DOC_SOURCE_KEYS);
      const documentType = firstValueByKeys(item, DOC_NAME_KEYS) || `Document ${index + 1}`;
      const fields = firstValueByKeys(item, DOC_DATA_KEYS) || omitKeys(item, [...DOC_NAME_KEYS, ...DOC_SOURCE_KEYS, ...DOC_DATA_KEYS]);
      return {
        documentType: String(documentType || source || `Document ${index + 1}`),
        originalDocumentType: String(documentType || `Document ${index + 1}`),
        source: source ? String(source) : null,
        canonicalType: normalizeDocName(documentType || `Document ${index + 1}`),
        fields: isBlank(fields) ? {} : fields,
        raw: item,
      };
    });
  }

  if (isPlainObject(payload)) {
    const objectDocuments = Object.entries(payload)
      .filter(([, value]) => isPlainObject(value) || Array.isArray(value))
      .map(([key, value]) => ({
        documentType: humanizeKey(key),
        canonicalType: normalizeDocName(key),
        fields: value,
        raw: value,
      }));

    if (objectDocuments.length > 1) return objectDocuments;
  }

  return [{
    documentType: 'Document Extraction Payload',
    canonicalType: normalizeDocName('Document Extraction Payload'),
    fields: payload || {},
    raw: payload || {},
  }];
};

const tokenizeDocName = (value) => {
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'with',
    'of',
    'copy',
    'certified',
    'valid',
    'latest',
    'document',
    'documents',
    'doc',
    'docs',
    'upload',
    'uploaded',
    'proof',
    'letter',
    'form',
    'declaration',
  ]);

  return normalizeDocName(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopWords.has(token));
};

const namesMatch = (left, right) => {
  const leftNormalized = normalizeKey(normalizeDocName(left));
  const rightNormalized = normalizeKey(normalizeDocName(right));
  if (!leftNormalized || !rightNormalized) return false;
  if (leftNormalized.includes(rightNormalized) || rightNormalized.includes(leftNormalized)) return true;

  const leftTokens = tokenizeDocName(left);
  const rightTokens = tokenizeDocName(right);
  if (!leftTokens.length || !rightTokens.length) return false;

  const matched = leftTokens.filter((token) => rightTokens.includes(token)).length;
  return matched / Math.min(leftTokens.length, rightTokens.length) >= 0.6;
};

// Fields too generic to compare cross-context (e.g. "id" in Directors vs business_information.id)
const COMPARISON_SKIP_FIELDS = new Set([
  'id', 'name', 'type', 'status', 'code', 'source', 'label', 'value',
  'index', 'order', 'sequence', 'count', 'total', 'size',
]);

// Fields to skip for path-suffix matching — their short names appear as suffixes in
// unrelated WebXPay paths and produce cross-context false matches
const SUFFIX_SKIP_FIELDS = new Set([
  'id', 'name', 'type', 'status', 'email', 'phone', 'address',
  'city', 'zip', 'date', 'number', 'total', 'count',
]);

const findMatchingDocument = (requirement, documents, uploadedDocNames = []) => {
  // Check AI JSON sections first
  const fromAI = documents.find((document) => namesMatch(requirement.required_docs, document.documentType));
  if (fromAI) return fromAI;

  // Fallback: check the list of uploaded document names from WebXPay
  const fromUpload = uploadedDocNames.find((name) => namesMatch(requirement.required_docs, name));
  if (fromUpload) {
    return {
      documentType: requirement.required_docs,
      canonicalType: normalizeDocName(requirement.required_docs),
      fields: {},
      raw: {},
    };
  }

  return null;
};

const findFlatValue = (flatRows, aliases) => {
  const normalizedAliases = aliases.map(normalizeKey).filter(Boolean);
  if (!normalizedAliases.length) return null;

  const exact = flatRows.find((row) => (
    !isBlank(row.value)
    && (
      normalizedAliases.includes(row.canonical)
      || normalizedAliases.includes(stripTrailingIndex(row.canonical))
    )
  ));
  if (exact) return exact;

  return flatRows.find((row) => (
    !isBlank(row.value)
    && normalizedAliases.some((alias) => (
      !SUFFIX_SKIP_FIELDS.has(alias)
      && (row.pathCanonical.endsWith(alias) || stripTrailingIndex(row.pathCanonical).endsWith(alias))
    ))
  )) || null;
};

const comparisonAliasesFor = (...values) => {
  const aliases = values
    .filter(Boolean)
    .flatMap((value) => String(value).split('.'))
    .filter(Boolean);

  const expanded = new Set();
  aliases.forEach((alias) => {
    const normalized = normalizeKey(alias);
    if (!normalized) return;
    expanded.add(alias);
    expanded.add(normalized);
    (FIELD_ALIAS_LOOKUP[normalized] || []).forEach((linkedAlias) => expanded.add(linkedAlias));
  });

  return [...expanded];
};

const aliasesForRow = (row) => comparisonAliasesFor(row?.field, row?.label, row?.path);

// Aliases for prompt-coverage system lookups: alias-group expansion is applied to
// the FIELD and SECTION only. The document label and API source are appended as
// raw tokens without expansion — expanding them poisoned lookups: an ID-document
// field with apiSource "NIC" (e.g. Age, Gender, Date of Birth) inherited the whole
// identity alias group and "matched" the stakeholder's NIC number as its system value.
const promptComparisonAliases = ({ field, section, documentName, apiSource }) => {
  const aliases = new Set(comparisonAliasesFor(field, section));
  [documentName, apiSource].forEach((value) => {
    const normalized = normalizeKey(value || '');
    if (normalized) aliases.add(normalized);
  });
  return [...aliases];
};

const stripTrailingIndex = (value = '') => String(value).replace(/\d+$/, '');

const sourceLabelForRow = (row) => {
  const firstPathSegment = String(row?.path || '').split('.')[0];
  return firstPathSegment ? humanizeKey(firstPathSegment) : (row?.document || 'System record');
};

const MONTH_NAME_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;

const parseDateValue = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Sri Lankan documents use slash, dash, AND dotted separators (27.02.2031).
  const dmy = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (dmy) {
    const date = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Last resort: only trust the JS date parser for strings that plainly look
  // like dates (contain a month name). V8's lenient parser reads junk like
  // "WU 10537" as year 10537 and "8760" as year 8760, which corrupted
  // registration-number comparisons into garbage ISO dates.
  if (!MONTH_NAME_RE.test(text)) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  return year >= 1900 && year <= 2100 ? date : null;
};

const normalizeComparable = (value) => {
  const date = parseDateValue(value);
  if (date) return date.toISOString().slice(0, 10);

  return String(value)
    .toLowerCase()
    .trim()
    .replace(/\bheadquarters\b/g, 'head office')
    // Colombo place-name synonyms: the same suburb has an English/colonial name
    // and a Sinhala name — bank branches use them interchangeably.
    .replace(/\bcolpetty\b/g, 'kollupitiya')
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const numbersIn = (value) => String(value).match(/\d+/g) || [];

const tokenSimilarity = (left, right) => {
  const leftTokens = normalizeComparable(left).split(/\s+/).filter(Boolean);
  const rightTokens = normalizeComparable(right).split(/\s+/).filter(Boolean);
  if (!leftTokens.length || !rightTokens.length) return 0;

  const used = new Set();
  const matched = leftTokens.filter((leftToken) => {
    const exactIndex = rightTokens.findIndex((rightToken, index) => !used.has(index) && rightToken === leftToken);
    if (exactIndex >= 0) {
      used.add(exactIndex);
      return true;
    }

    const fuzzyIndex = rightTokens.findIndex((rightToken, index) => (
      !used.has(index)
      && leftToken.length >= 4
      && rightToken.length >= 4
      && (
        leftToken.includes(rightToken)
        || rightToken.includes(leftToken)
        || levenshteinDistance(leftToken, rightToken) <= 1
      )
    ));

    if (fuzzyIndex >= 0) {
      used.add(fuzzyIndex);
      return true;
    }

    return false;
  }).length;

  return matched / Math.max(leftTokens.length, rightTokens.length);
};

const levenshteinDistance = (left, right) => {
  const a = String(left);
  const b = String(right);
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);

  for (let j = 1; j <= b.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]) + 1;
    }
  }

  return dp[a.length][b.length];
};

const addressesEqual = (left, right) => {
  const leftNumbers = numbersIn(left);
  const rightNumbers = numbersIn(right);
  if (leftNumbers.length && rightNumbers.length) {
    const hasSharedNumber = leftNumbers.some((number) => rightNumbers.includes(number));
    if (!hasSharedNumber) return false;
  }

  const leftTokens = normalizeComparable(left).split(/\s+/).filter(Boolean);
  const rightTokens = normalizeComparable(right).split(/\s+/).filter(Boolean);
  const shorter = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
  const longer = leftTokens.length <= rightTokens.length ? rightTokens : leftTokens;

  if (shorter.length >= 2) {
    const subsetMatches = shorter.filter((shortToken) => longer.some((longToken) => (
      shortToken === longToken
      || (
        shortToken.length >= 4
        && longToken.length >= 4
        && (shortToken.includes(longToken) || longToken.includes(shortToken) || levenshteinDistance(shortToken, longToken) <= 1)
      )
    ))).length;

    if (subsetMatches / shorter.length >= 0.85) return true;
  }

  return tokenSimilarity(left, right) >= 0.72;
};

const valuesEqual = (left, right, context = '') => {
  if (isBlank(left) && isBlank(right)) return true;
  if (isBlank(left) || isBlank(right)) return false;
  if (normalizeComparable(left) === normalizeComparable(right)) return true;

  // Alphanumeric codes (registration numbers, NICs, account numbers) — spacing is not meaningful
  const leftNoSpace = normalizeComparable(left).replace(/\s/g, '');
  const rightNoSpace = normalizeComparable(right).replace(/\s/g, '');
  if (
    leftNoSpace === rightNoSpace
    && /^[a-z0-9]+$/.test(leftNoSpace)
    && /\d/.test(leftNoSpace)
  ) return true;

  const key = normalizeKey(context);

  if (isIdentityComparisonContext(key)) {
    const leftIds = extractIdentityTokens(left, { loose: true });
    const rightIds = extractIdentityTokens(right, { loose: true });
    if (leftIds.length && rightIds.length && leftIds.some((id) => rightIds.includes(id))) {
      return true;
    }
  }

  // NIC: new-format 12-digit NICs sometimes have a trailing V/X added by OCR.
  // "198604601285V" and "198604601285" refer to the same person.
  if (key.includes('nic') || key.includes('nationalidentity') || key.includes('nicpassport')) {
    const stripNicSuffix = (s) => (s.length === 13 && /^\d{12}[vx]$/.test(s)) ? s.slice(0, 12) : s;
    if (stripNicSuffix(leftNoSpace) === stripNicSuffix(rightNoSpace)) return true;
  }

  // Registration numbers may carry a province prefix in one source but not the other.
  // e.g. "U 10537" (BRC) vs "WU10537" (system) — numeric core "10537" is the same.
  if (key.includes('registrationnumber') || key.includes('brcnumber')) {
    const leftCore = leftNoSpace.replace(/^[a-z]+/, '');
    const rightCore = rightNoSpace.replace(/^[a-z]+/, '');
    if (leftCore && rightCore && leftCore === rightCore
        && /^\d+$/.test(leftCore) && leftCore.length >= 3) return true;
  }
  if (key.includes('address')) {
    // Fuzzy address matching applies only to business/registered addresses.
    // Stakeholder personal addresses (owner, residential, present) use standard comparison only.
    const isBusinessAddr = key.includes('business') || key.includes('legal')
      || key.includes('registered') || key.includes('customer') || key.includes('street');
    const isPersonalAddr = key.includes('owner') || key.includes('residential')
      || key.includes('present') || key.includes('stakeholder');
    if (isBusinessAddr && !isPersonalAddr) return addressesEqual(left, right);
  }

  // First/last name — system stores full name; derive the relevant part for comparison.
  // e.g. firstName "Mohamed" vs fullName "Mohamed Hashim" → extract first token.
  const isFirstNameCtx = key.includes('firstname') || key.includes('givenname');
  const isLastNameCtx = key.includes('lastname') || key.includes('surname') || key.includes('familyname');
  if (isFirstNameCtx || isLastNameCtx) {
    const leftTokens = normalizeComparable(left).split(/\s+/).filter(Boolean);
    const rightTokens = normalizeComparable(right).split(/\s+/).filter(Boolean);
    if (rightTokens.length >= 2 && leftTokens.length === 1) {
      const part = isFirstNameCtx ? rightTokens[0] : rightTokens[rightTokens.length - 1];
      if (leftTokens[0] === part) return true;
    }
    if (leftTokens.length >= 2 && rightTokens.length === 1) {
      const part = isFirstNameCtx ? leftTokens[0] : leftTokens[leftTokens.length - 1];
      if (rightTokens[0] === part) return true;
    }
  }

  if (key.includes('natureofbusiness') || key.includes('businessactivity') || key.includes('productcategories')) {
    const genericBusinessTokens = new Set([
      'business', 'products', 'product', 'trading', 'trade', 'exporting', 'export',
      'importing', 'import', 'wholesale', 'retail', 'services', 'service', 'and',
    ]);
    const leftTokens = normalizeComparable(left).split(/\s+/).filter((token) => token.length > 2 && !genericBusinessTokens.has(token));
    const rightTokens = normalizeComparable(right).split(/\s+/).filter((token) => token.length > 2 && !genericBusinessTokens.has(token));
    const shorter = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
    const longer = leftTokens.length <= rightTokens.length ? rightTokens : leftTokens;
    if (shorter.length && shorter.every((token) => longer.includes(token))) return true;
  }

  return false;
};

const DATE_SHAPE_RE = /^\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\s*$/;

const valuesNearMatch = (left, right) => {
  if (isBlank(left) || isBlank(right)) return false;
  // Two values that are both dates either match exactly (valuesEqual) or they
  // are DIFFERENT dates — token similarity must never soft-match them
  // (2008-10-18 vs 2018-10-15 previously near-matched on shared tokens).
  if (DATE_SHAPE_RE.test(String(left)) && DATE_SHAPE_RE.test(String(right))) return false;
  const leftNorm = normalizeComparable(left);
  const rightNorm = normalizeComparable(right);
  if (leftNorm.includes(rightNorm) || rightNorm.includes(leftNorm)) return true;
  if (tokenSimilarity(left, right) >= 0.70) return true;

  // Subset match: one side is a summary/elaboration of the other.
  // e.g. "Foods, Beverages and Groceries" vs "Food & Beverage Trading, Manufacturing, Retail Groceries"
  const STOP = new Set(['and', 'or', 'of', 'the', 'a', 'an', 'in', 'at', 'for', 'to', 'with', 'by']);
  const leftTokens = leftNorm.split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t));
  const rightTokens = rightNorm.split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t));
  if (leftTokens.length >= 2 && rightTokens.length >= 2) {
    const shorter = leftTokens.length <= rightTokens.length ? leftTokens : rightTokens;
    const longer  = leftTokens.length <= rightTokens.length ? rightTokens : leftTokens;
    const subsetMatches = shorter.filter((token) =>
      longer.some((longToken) =>
        token === longToken
        || (token.length >= 4 && longToken.length >= 4
            && (token.includes(longToken) || longToken.includes(token) || levenshteinDistance(token, longToken) <= 1))
      )
    ).length;
    if (subsetMatches / shorter.length >= 0.6) return true;
  }

  return false;
};

const stripAiDocumentLabel = (name) => String(name || '')
  .replace(/^LABEL:\s*/i, '')
  .replace(/\s*\|\s*API_SOURCE:\s*.*/i, '')
  .replace(/_/g, ' ')
  .trim();

// Returns true only when a date string is provably future under EVERY reasonable
// format interpretation. If any interpretation yields a past/present date, returns false.
const isDateActuallyFuture = (dateStr) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const m = String(dateStr || '').match(/(\d{1,4})[-\/\.](\d{1,2})[-\/\.](\d{1,4})/);
  if (!m) return true;
  const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]);
  const candidates = [];
  if (m[1].length === 4) { candidates.push(new Date(a, b - 1, c)); candidates.push(new Date(a, c - 1, b)); }
  if (m[3].length === 4) { candidates.push(new Date(c, b - 1, a)); candidates.push(new Date(c, a - 1, b)); }
  const valid = candidates.filter((d) => !isNaN(d.getTime()) && d.getFullYear() >= 1900 && d.getFullYear() <= today.getFullYear() + 10);
  if (!valid.length) return true;
  return !valid.some((d) => d <= today); // false = at least one interpretation is past
};

const isFalseFutureDateIssue = (row = {}) => {
  const text = `${row.reason || ''} ${row.rule || ''}`;
  if (!/\bfuture\b/i.test(text)) return false;
  const dateText = [
    row.value,
    row.documentValue,
    row.systemValue,
    text,
  ].map((part) => String(part || ' ')).join(' ');
  const match = dateText.match(/\d{4}-\d{2}-\d{2}|\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{2,4}/);
  return Boolean(match && !isDateActuallyFuture(match[0]));
};

// A "faulty document" note that is NOT a validity failure: duplicates and
// out-of-scope/not-required uploads mean a valid document already exists (or the
// extra file simply isn't needed). These must never invalidate a required
// document or block onboarding — e.g. WebXPay exposes the same bank statement
// under both `signup_document` and `bank_account`, so it always appears twice.
const isNonBlockingDocumentFault = (reason = '') => {
  const r = String(reason).toLowerCase();
  return /\bduplicate\b/.test(r)
    || /already\s+(been\s+)?(provided|submitted|uploaded|supplied)/.test(r)
    || /not\s+required|out[-\s]of[-\s]scope|not\s+applicable|not\s+needed|irrelevant/.test(r);
};

// Bank-statement recency is admin-review only (onboarding matrix §7: bank
// statements have no document-level expiry). A statement older than N months
// must never invalidate the document or block onboarding.
const isBankStatementRecencyIssue = (row = {}) => {
  const docText = normalizeDocName(`${row.document || ''} ${row.section || ''} ${row.field || ''}`);
  const isBankDoc = docText.includes('bank statement')
    || docText.includes('bank confirmation')
    || normalizeKey(row.field || '').includes('statementdate');
  if (!isBankDoc) return false;
  const text = normalizeComparable(`${row.reason || ''} ${row.rule || ''}`);
  return /\b(month|months|prior|older|recent|current|recency|stale|outdated|latest|expired)\b/.test(text)
    && /\b(statement|date|dated)\b/.test(text);
};

const documentCheckIssueRow = (check = {}, issue = {}) => ({
  document: check.name || check.document || issue.document || '',
  section: check.name || issue.section || '',
  field: issue.field || check.name || '',
  reason: issue.reason || '',
  rule: issue.reason || '',
});

const hasBlockingDocumentIssues = (check = {}) => {
  if (!check.present) return true;
  if (check.valid !== false) return false;
  const issues = Array.isArray(check.issues) ? check.issues : [];
  if (!issues.length) return true;
  return issues.some((issue) => {
    const row = documentCheckIssueRow(check, issue);
    return !isBankStatementRecencyIssue(row)
      && !isBankCustomerAddressIssue(row)
      && !isAcceptedBankDocumentLabelSwap(row.reason);
  });
};

const isBrcOwnerNicPromptGap = ({ section, field, documentName, reason } = {}) => {
  const sectionNorm = normalizeKey(section || '');
  const fieldNorm = normalizeKey(field || '');
  const docNorm = normalizeDocName(documentName || '');
  const reasonNorm = normalizeComparable(reason || '');
  const isOwnerNicField = fieldNorm === 'ownernic'
    || fieldNorm === 'proprietornic'
    || (fieldNorm.includes('owner') && fieldNorm.includes('nic'));
  const isBrcContext = sectionNorm === 'businessregistration'
    || docNorm.includes('business registration certificate')
    || docNorm === 'brc';
  if (!isOwnerNicField || !isBrcContext) return false;

  // The BRC can verify the owner/proprietor by name; it does not have to carry
  // the owner's NIC number. Do not suppress a real value mismatch if one exists.
  return !/\b(mismatch|does not match|differs|invalid|inconsistent)\b/.test(reasonNorm);
};

const isBrcOwnerNicMissingIssue = (row = {}) => {
  if (!isBrcOwnerNicPromptGap({
    section: row.section,
    field: row.field,
    documentName: row.document || row.documentName,
    reason: `${row.reason || ''} ${row.rule || ''}`,
  })) return false;

  const text = normalizeComparable(`${row.reason || ''} ${row.rule || ''} ${row.documentValue || ''} ${row.value || ''}`);
  return row.category === 'prompt_field_comparison'
    || row.category === 'ai_missing_field'
    || /\b(missing|not found|notfound|absent|unclear|not captured|was not found|provide)\b/.test(text);
};

const isNonBlockingCriticalFieldIssue = (row = {}) => (
  isBankStatementRecencyIssue(row) || isBrcOwnerNicMissingIssue(row)
);

// A label/content "mismatch" where BOTH the expected label and the found
// content are identity documents (e.g. "expected ID Copy, found Passport") is
// NOT a fault: the ID slot accepts NIC, passport, or driving licence
// interchangeably — the prompt tells the AI to determine the exact type from
// the content. Only cross-category swaps (bank statement in the ID slot, a
// letter in the license slot) are real label faults.
const isIdentityLabelContentSwap = (reason = '') => {
  const text = String(reason).toLowerCase();
  if (!/(does not match label|mislabel|expected)/.test(text)) return false;
  // Any non-identity document category named in the reason → genuine fault.
  if (/\b(bank|statement|registration certificate|license|licence|resolution|articles|form \d|agreement|utility|letter)\b/.test(text)) return false;
  const identityWords = ['passport', 'nic', 'driving licen', 'id copy', 'id copies', 'identity'];
  const hits = identityWords.filter((word) => text.includes(word));
  return hits.length >= 2;
};

const isAcceptedBankDocumentLabelSwap = (reason = '') => {
  const text = normalizeComparable(reason || '');
  if (!/(does not match label|mislabel|expected)/.test(text)) return false;
  const expectedBankStatement = /\bexpected\b.*\bbank\b.*\bstatement\b/.test(text)
    || /\bexpected\b.*\bthree\s+month\b.*\bstatement\b/.test(text);
  const foundBankConfirmation = /\bfound\b.*\bbank\b.*\b(confirmation|letter|statement)\b/.test(text)
    || /\bfound\b.*\bconfirmation\s+letter\b/.test(text);
  return expectedBankStatement && foundBankConfirmation;
};

// ── Onboarding severity policy ─────────────────────────────────────────────
// Configured with the business: ONLY these categories block onboarding —
//   1. A MANDATORY document is missing or invalid (this includes required
//      regulatory licenses, which are added as mandatory document requirements).
//   2. A bank-account detail mismatches / is invalid / is missing.
//   3. A core identity field (name, NIC, passport, driving licence) has an issue.
// Everything else (other field mismatches, source-only gaps, non-mandatory
// document/field gaps) is a MINOR issue: the merchant may still be onboarded,
// but is flagged "caution" for a human to glance at.
// Only the fields that actually identify the account block onboarding (account
// number, account holder/customer name, bank name, branch, routing codes).
// Secondary bank-statement fields (currency, statement date, customer address)
// are matched separately below and are non-blocking.
const BANK_FIELD_RE = /\b(bank\s*name|bank\s*branch|branch(\s*name)?|a\/?c|account\s*(no|number|name|holder(\s*name)?)?|customer\s*name|swift|iban|ifsc|sort\s*code|routing)\b/i;
const IDENTITY_FIELD_RE = /\b(nic\b|national\s*id|identity\s*card|passport|driving\s*licen[cs]e|\bdl\b|full\s*name|holder\s*name|name\s*of\s*(the\s*)?(director|stakeholder|signatory|individual|proprietor|partner|owner)|director\s*name|signatory\s*name)\b/i;

const issueHaystack = (row = {}) => `${row.field || ''} ${row.document || ''}`;
// Bank matching is field-name-only: matching the document label too (e.g. any
// field on a "Bank Statement" document) caused unrelated fields like Currency or
// Customer Address to be misclassified as blocking bank-detail issues.
const isBankIssueRow = (row) => BANK_FIELD_RE.test(row.field || '');
const isIdentityIssueRow = (row) => IDENTITY_FIELD_RE.test(issueHaystack(row));
// Whole-document categories are already represented by documentChecks; only
// field-level rows are considered for the bank/identity critical filter so we
// don't double-count a missing mandatory document.
const isFieldLevelRow = (row = {}) =>
  row.category !== 'ai_required_document'
  && row.category !== 'ai_document_presence'
  && row.category !== 'ai_faulty_document';

// Single source of truth for the verdict. Takes the cleaned issue arrays plus
// the per-document validity checks and returns the 3-state status, the blocking
// count, and human-readable blocking reasons for the eligibility rule check.
const classifyOnboardingSeverity = ({
  missingData = [],
  invalidData = [],
  mismatches = [],
  documentOnlyData = [],
  systemOnlyData = [],
  documentChecks = [],
}) => {
  const mandatoryDocGaps = documentChecks.filter(
    (c) => c.isMandatory && !c.waived && (!c.present || hasBlockingDocumentIssues(c))
  );
  const missingMandatory = mandatoryDocGaps.filter((c) => !c.present);
  const invalidMandatory = mandatoryDocGaps.filter((c) => c.present && hasBlockingDocumentIssues(c));

  const criticalFieldIssues = [...missingData, ...invalidData, ...mismatches]
    .filter(isFieldLevelRow)
    .filter((row) => !isNonBlockingCriticalFieldIssue(row))
    .filter((row) => isBankIssueRow(row) || isIdentityIssueRow(row));
  const bankIssues = criticalFieldIssues.filter(isBankIssueRow);
  const identityIssues = criticalFieldIssues.filter((r) => !isBankIssueRow(r) && isIdentityIssueRow(r));

  const blockingCount = mandatoryDocGaps.length + criticalFieldIssues.length;

  // Automatic verdict is binary: eligible merchants (no blocking issue) go straight
  // to "verified", even if minor non-blocking issues exist. "caution" is reserved as
  // a manual label a reviewer can assign — it is never produced automatically.
  const status = blockingCount > 0 ? 'review_required' : 'verified';

  const nameList = (arr) => {
    const names = arr.map((c) => c.name).filter(Boolean);
    return names.length ? ` (${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''})` : '';
  };
  const blockingReasons = [];
  if (missingMandatory.length) blockingReasons.push(`${missingMandatory.length} mandatory document(s) missing${nameList(missingMandatory)}`);
  if (invalidMandatory.length) blockingReasons.push(`${invalidMandatory.length} mandatory document(s) invalid${nameList(invalidMandatory)}`);
  if (bankIssues.length) blockingReasons.push(`${bankIssues.length} bank-detail issue(s)`);
  if (identityIssues.length) blockingReasons.push(`${identityIssues.length} identity issue(s)`);

  return { status, blockingCount, blockingReasons, mandatoryDocGaps, criticalFieldIssues };
};

// Human-readable statements of the three configured blocking policy rules,
// cited on every blocking issue so the justification names the exact rule.
const POLICY_TEXT = {
  mandatory_document: 'Blocking policy 1: every mandatory document configured for this merchant type must be uploaded and pass validation.',
  bank: 'Blocking policy 2: bank account details must be present, valid, and consistent between the bank document and the system record.',
  identity: 'Blocking policy 3: core identity fields (name, NIC, passport, driving licence) must be present, valid, and consistent across all sources.',
};

// Builds the full onboarding decision: the same verdict as
// classifyOnboardingSeverity, plus one justified entry per blocking issue
// (evidence values, the policy rule violated, and the remediation action) and
// a narrative summary an admin can read as-is.
const buildOnboardingDecision = ({
  missingData = [],
  invalidData = [],
  mismatches = [],
  documentOnlyData = [],
  systemOnlyData = [],
  documentChecks = [],
}) => {
  const severity = classifyOnboardingSeverity({
    missingData, invalidData, mismatches, documentOnlyData, systemOnlyData, documentChecks,
  });

  const blockingIssues = [];

  severity.mandatoryDocGaps.forEach((check) => {
    if (!check.present) {
      blockingIssues.push({
        code: 'MANDATORY_DOCUMENT_MISSING',
        category: 'mandatory_document',
        title: `Mandatory document missing: ${check.name}`,
        field: check.name,
        document: check.name,
        documentValue: '(not uploaded)',
        systemValue: '—',
        reason: `The mandatory document "${check.name}" was not found among the uploaded documents or the AI document extraction.${check.description ? ` ${sentence(check.description)}` : ''}`,
        policy: POLICY_TEXT.mandatory_document,
        requiredAction: `Upload a clear, complete and valid copy of "${check.name}".`,
      });
      return;
    }

    const blockingCheckIssues = (check.issues || [])
      .filter((issue) => {
        const row = documentCheckIssueRow(check, issue);
        return !isBankStatementRecencyIssue(row)
          && !isBankCustomerAddressIssue(row)
          && !isAcceptedBankDocumentLabelSwap(row.reason);
      });
    const issueText = blockingCheckIssues
      .map((issue) => (issue.field ? `${issue.field}: ${issue.reason}` : issue.reason))
      .filter(Boolean)
      .join(' | ') || 'The document failed AI validity checks.';
    // "Failed to load" means the download from storage timed out during the AI
    // run — the document itself is fine; asking the merchant to re-upload it
    // would be the wrong remediation.
    const isLoadFailure = /failed to load|load failure|download|timed? ?out/i.test(issueText);
    blockingIssues.push({
      code: isLoadFailure ? 'MANDATORY_DOCUMENT_UNREADABLE' : 'MANDATORY_DOCUMENT_INVALID',
      category: 'mandatory_document',
      title: isLoadFailure
        ? `Mandatory document could not be analyzed: ${check.name}`
        : `Mandatory document invalid: ${check.name}`,
      field: check.name,
      document: check.name,
      documentValue: isLoadFailure ? '(uploaded, download failed during analysis)' : '(uploaded, failed validation)',
      systemValue: '—',
      reason: isLoadFailure
        ? `The mandatory document "${check.name}" is uploaded, but its file could not be downloaded during the last AI extraction run (transient storage error) — it was never analyzed. ${sentence(issueText)}`
        : `The mandatory document "${check.name}" was uploaded but failed validation — ${issueText}`,
      policy: POLICY_TEXT.mandatory_document,
      requiredAction: isLoadFailure
        ? 'Re-run the analysis ("Re-extract Docs") — the document is already uploaded; the previous run hit a temporary download failure.'
        : `Re-upload a corrected "${check.name}" that resolves: ${issueText}`,
    });
  });

  const describeFieldIssue = (row, issueType) => {
    const docVal = displayValue(row.documentValue ?? row.value);
    const sysVal = displayValue(row.systemValue);
    if (issueType === 'mismatch') {
      return `"${row.field}" does not match between sources: the document (${row.document || 'document extraction'}) shows "${docVal}" while the system record shows "${sysVal}".${row.reason ? ` ${sentence(row.reason)}` : ''}`;
    }
    if (issueType === 'invalid') {
      return `"${row.field}" in ${row.document || 'the submitted data'} has an invalid value (${docVal}). ${sentence(row.rule || row.reason || 'It failed a validity rule.')}`;
    }
    return `"${row.field}" is missing from ${row.document || 'the submitted documents'}. ${sentence(row.reason || 'A required value was not found.')}`;
  };

  const actionForFieldIssue = (row, issueType, category) => {
    // A field "missing" because the source document failed to download is an
    // infrastructure error, not a merchant gap — the fix is re-running analysis.
    if (/failed to load|load failure|timed? ?out/i.test(String(row.reason || row.rule || ''))) {
      return 'Re-run the analysis ("Re-extract Docs") — the source document is uploaded but could not be downloaded in the last run.';
    }
    if (issueType === 'mismatch') {
      return `Reconcile "${row.field}": confirm which source is correct and update the ${category === 'bank' ? 'bank record or bank document' : 'identity document or system record'} so both agree.`;
    }
    if (issueType === 'invalid') {
      return `Correct "${row.field}" and re-submit the affected document (${row.document || 'source document'}).`;
    }
    return `Provide "${row.field}"${row.document ? ` via ${row.document}` : ''} so it can be verified.`;
  };

  const pushCriticalRows = (rows, issueType) => {
    rows.filter(isFieldLevelRow).forEach((row) => {
      if (isNonBlockingCriticalFieldIssue(row)) return;
      const isBank = isBankIssueRow(row);
      const isIdentity = !isBank && isIdentityIssueRow(row);
      if (!isBank && !isIdentity) return;
      const category = isBank ? 'bank' : 'identity';
      blockingIssues.push({
        code: `${isBank ? 'BANK_DETAIL' : 'IDENTITY'}_${issueType.toUpperCase()}`,
        category,
        title: `${isBank ? 'Bank detail' : 'Identity'} ${issueType}: ${row.field}`,
        field: row.field,
        document: row.document || '—',
        documentValue: displayValue(row.documentValue ?? row.value),
        systemValue: displayValue(row.systemValue),
        reason: describeFieldIssue(row, issueType),
        policy: POLICY_TEXT[category],
        requiredAction: actionForFieldIssue(row, issueType, category),
      });
    });
  };

  pushCriticalRows(missingData, 'missing');
  pushCriticalRows(invalidData, 'invalid');
  pushCriticalRows(mismatches, 'mismatch');

  const totalFindings = missingData.length + invalidData.length + mismatches.length
    + documentOnlyData.length + systemOnlyData.length;
  const nonBlockingCount = Math.max(0, totalFindings - severity.criticalFieldIssues.length);

  const canOnboard = severity.blockingCount === 0;
  let summary;
  if (canOnboard) {
    summary = nonBlockingCount > 0
      ? `This merchant is eligible for onboarding: all mandatory documents are present and valid, bank account details are consistent, and core identity fields verified successfully. ${nonBlockingCount} minor, non-blocking observation(s) were recorded for reviewer awareness — none fall into a blocking category.`
      : 'This merchant is eligible for onboarding: all mandatory documents are present and valid, bank account details are consistent, core identity fields verified successfully, and no issues were detected.';
  } else {
    const numbered = blockingIssues.map((issue, i) => `(${i + 1}) ${issue.reason}`).join(' ');
    summary = `Onboarding is blocked by ${blockingIssues.length} issue(s): ${numbered} Each issue must be resolved — or explicitly overridden by a reviewer with a documented reason — before this merchant can be approved.`;
  }

  const nextSteps = [...new Set(blockingIssues.map((issue) => issue.requiredAction))];

  return {
    ...severity,
    decision: {
      canOnboard,
      outcome: canOnboard ? 'eligible' : 'blocked',
      headline: canOnboard ? 'Eligible for onboarding' : 'Onboarding blocked',
      summary,
      blockingIssues,
      blockingCount: severity.blockingCount,
      nonBlockingCount,
      nextSteps,
      policyNote: 'Blocking categories per configured policy: (1) missing or invalid mandatory documents, (2) bank account detail issues, (3) core identity issues. All other findings are minor and non-blocking.',
    },
  };
};

const statusLabelFor = (status) => (
  status === 'verified' ? 'Verified'
    : status === 'caution' ? 'Caution — minor issues only'
      : status === 'source_gap_review' ? 'Caution — minor issues only'
        : 'Review required'
);

// Deliberately excludes registered_name_of_business: trade names routinely contain
// generic words that collide with regulated-activity keywords (e.g. "THE CAR CLINIC"
// is an auto shop, not a medical clinic) and would falsely trigger a license
// requirement. Only actual nature-of-business/category fields are scanned.
const systemOperationalBusinessText = (systemData = {}) => [
  systemData?.business_information?.nature_of_business,
  systemData?.business_information?.category_code_id,
  systemData?.business_information?.type_of_business,
].filter(Boolean).join(' ');

const searchableText = (value) => {
  if (Array.isArray(value)) return value.map(searchableText).join(' ');
  if (isPlainObject(value)) return Object.values(value).map(searchableText).join(' ');
  return String(value || '');
};

const documentOperationalBusinessText = (documentData = {}) => {
  const sourcedChunks = [];
  const sourceChunks = [];
  const sourceDocLabels = new Set();

  promptCoverageItems(documentData).forEach((item) => {
    const fieldNorm = normalizeKey(aiField(item, ''));
    if (![
      'natureofbusiness',
      'productcategories',
      'businessactivity',
      'businessnature',
      'categorycode',
    ].includes(fieldNorm)) return;

    const rawDoc = aiDocument(item, '');
    const docNorm = normalizeDocName(stripAiDocumentLabel(rawDoc));
    if (
      docNorm.includes('board resolution')
      || docNorm.includes('articles of association')
      || docNorm.includes('business registration certificate')
      || docNorm.includes('website')
      || docNorm.includes('system')
    ) {
      const val = searchableText(aiExtractedValue(item));
      if (val) {
        sourcedChunks.push(val);
        const docLabel = stripAiDocumentLabel(rawDoc);
        sourceDocLabels.add(docLabel);
        sourceChunks.push({ text: val, source: docLabel });
      }
    }
  });

  const fallbackSources = [
    { value: documentData?.BusinessRegistration?.['Nature of Business'],   doc: 'Business Registration Certificate' },
    { value: documentData?.BusinessRegistration?.NatureOfBusiness,         doc: 'Business Registration Certificate' },
    { value: documentData?.BusinessRegistration?.['Category Code'],        doc: 'Business Registration Certificate' },
    { value: documentData?.ArticlesOfAssociationDetails?.['Nature of Business'], doc: 'Articles of Association' },
    { value: documentData?.ArticlesOfAssociationDetails?.NatureOfBusiness, doc: 'Articles of Association' },
    { value: documentData?.WebsiteInsights?.['Product Categories'],        doc: 'Website / Social Media URL' },
  ];

  if (!sourcedChunks.length) {
    fallbackSources.forEach(({ value, doc }) => {
      const val = searchableText(value);
      if (val) {
        sourcedChunks.push(val);
        sourceDocLabels.add(doc);
        sourceChunks.push({ text: val, source: doc });
      }
    });
  }

  return {
    text: (sourcedChunks.length ? sourcedChunks : []).join(' '),
    sourceDocLabels: [...sourceDocLabels],
    sourceChunks,
  };
};

// Keyword sets aligned with the Laravel onboarding matrix (LicenseSlotDefinitionService).
// `exclude` phrases are stripped from the text before the pattern is applied — e.g.
// "car clinic" must not trigger the medical-clinic PHSRC rule (matrix Slot 5).
// `exception(text)` returning true suppresses the rule after a match.
const LICENSE_RULES = [
  { license: 'Ayurveda / Homeopathy Council Registration', pattern: /\b(ayurved\w*|homeopath\w*)\b/ },
  {
    license: 'PHSRC License',
    pattern: /\b(clinic|hospital|medical centre|medical center|diagnostic|laborator\w*|healthcare)\b/,
    exclude: /\b(car|auto|vehicle|automobile|motor)\s+clinics?\b/g,
  },
  { license: 'NMRA License', pattern: /\b(pharmacy|pharma\w*|pharmaceutical\w*|drug|medicine|medical equipment|medical device|cosmetic\w*|nmra)\b/ },
  { license: 'National Gem & Jewelry Authority License', pattern: /\b(gems?\s+(?:and\s+)?jewel\w*|jewel\w*)\b/ },
  {
    license: 'SLTDA License',
    pattern: /\b(hotel booking|guest house|visa consultation|tour packages?|tour operator|travel agent|travels?|tourism|sightseeing|cruise|lodging|hospitality|resorts?|accommodation|itinerar\w*|hotel|slt?da)\b/,
  },
  { license: 'Central Bank Money Changing License', pattern: /\b(money changer|money changers|money changing|foreign currency exchange)\b/ },
  { license: 'TRCSL License', pattern: /\b(telecom\w*|trcsl)\b/ },
  { license: 'Civil Aviation License', pattern: /\b(airline|air carrier|air ticket\w*|flight ticket\w*|flights?|civil aviation|ticketing agent)\b/ },
  { license: 'IBSL Certificate', pattern: /\b(insurance|ibsl)\b/ },
  { license: 'Excise or Divisional Secretariat License', pattern: /\b(wine|liquor|bar|alcohol|excise)\b/ },
  { license: 'Fuel Distribution Agreement', pattern: /\b(fuel station|fuel distribution|filling station|gas station|petrol\w*|diesel|petroleum|lubricant\w*)\b/ },
  { license: 'SLMC Registration', pattern: /\b(doctor|dentist|dental|slmc)\b/ },
  { license: 'Veterinary Council Registration', pattern: /\b(veterinary|veterinarian|vet\b)\b/ },
  { license: 'Bar Association Registration', pattern: /\b(lawyer|legal service|attorney|bar association)\b/ },
  {
    license: 'Applicable Business License (Export of Goods)',
    pattern: /\b(export\w*|import\s+export)\b/,
    // Sri Lankan AoA objects clauses almost universally include boilerplate
    // "import and export" wording that says nothing about the actual operating
    // activity — the Laravel matrix's activity-text sources exclude AoA entirely.
    // Only operational sources (BRC nature, Board Resolution, system record,
    // website) may trigger this rule.
    sourceExclude: /articles\s*of\s*association/i,
    // Matrix rule: pure software / digital / IT / BPO / professional-services
    // exporters are exempt unless physical-goods evidence is also present.
    exception: (text) => (
      /\b(software|digital|it services?|information technology|bpo|professional services?|saas|web|app development)\b/.test(text)
      && !/\b(goods|products|merchandise|rubber|tea|spices|garments?|apparel|food|coconut|furniture|handicrafts?)\b/.test(text)
    ),
  },
];

const inferRequiredLicenseDetailsFromChunks = (chunks = []) => {
  const byLicense = new Map();
  chunks.forEach((chunk) => {
    const text = normalizeComparable(chunk.text || '');
    if (!text) return;
    LICENSE_RULES.forEach((rule) => {
      if (rule.sourceExclude && rule.sourceExclude.test(String(chunk.source || ''))) return;
      // Strip excluded phrases first so e.g. "car clinic" cannot satisfy "clinic".
      const scanText = rule.exclude ? text.replace(rule.exclude, ' ') : text;
      const match = scanText.match(rule.pattern);
      if (!match) return;
      if (typeof rule.exception === 'function' && rule.exception(scanText)) return;
      const existing = byLicense.get(rule.license);
      const trigger = match[0];
      const source = chunk.source || 'business activity information';
      const detail = {
        license: rule.license,
        trigger,
        source,
        reason: `Mandatory because ${source} lists "${trigger}", which requires ${rule.license}.`,
      };
      if (!existing || normalizeKey(source).includes('articlesofassociation')) {
        byLicense.set(rule.license, detail);
      }
    });
  });
  return [...byLicense.values()];
};

const inferRequiredLicensesFromText = (value = '') => (
  inferRequiredLicenseDetailsFromChunks([{ text: value, source: 'business activity information' }])
    .map((detail) => detail.license)
);

const operationalBusinessText = (documentData = {}, systemData = {}) => [
  documentOperationalBusinessText(documentData).text,
  systemOperationalBusinessText(systemData),
].filter(Boolean).join(' ');

const requiredOperationalLicenses = (documentData = {}, systemData = {}) => (
  inferRequiredLicensesFromText(operationalBusinessText(documentData, systemData))
);

const requiredOperationalLicenseDetails = (documentData = {}, systemData = {}) => {
  const docInfo = documentOperationalBusinessText(documentData);
  const chunks = [
    ...docInfo.sourceChunks,
    { text: systemOperationalBusinessText(systemData), source: 'WebXPay system nature of business' },
  ].filter((chunk) => !isBlank(chunk.text));
  return inferRequiredLicenseDetailsFromChunks(chunks);
};

const hasRegulatedOperationalNature = (systemData = {}, documentData = {}) => {
  const text = operationalBusinessText(documentData, systemData);
  return requiredOperationalLicenses(documentData, systemData).length > 0
    || /\b(phsrc|nmra|regulated license|regulated licence)\b/.test(normalizeComparable(text));
};

const isRegulatoryLicenseRequirement = (documentName, reason = '') => {
  // Identity documents mention "licence" (Driving Licence) and bank documents
  // are never licenses — normalizeDocName maps NIC/passport/DL variants to
  // "identity document", so both are excluded before the keyword test. Without
  // this, an AI-required "Valid NIC, Passport, or Driving Licence" was treated
  // as a regulatory-license requirement and falsely blocked onboarding.
  const nameNorm = normalizeDocName(documentName || '');
  if (nameNorm.includes('identity document') || nameNorm.includes('bank statement')) return false;

  const text = normalizeComparable(`${documentName || ''} ${reason || ''}`);
  return /\b(regulatory license|regulatory licence|license|licence|phsrc|nmra|ayurved\w*|homeopath\w*|medical|pharma\w*|cosmetic\w*|council)\b/.test(text)
    && /\b(license|licence|registration|approval|certificate)\b/.test(text);
};

const isGenericRegulatoryLicenseRequirement = (documentName = '') => {
  const key = normalizeKey(documentName);
  return key === 'regulatorylicense'
    || key === 'licenseifrequired'
    || key === 'regulatoryorbusinessspecificlicenses'
    || key === 'regulatorybusinessspecificlicenses';
};

const isForm20Requirement = (documentName) => normalizeKey(documentName).includes('form20');

const isDirectorIdentityForm20Reason = (reason = '') => {
  const text = normalizeComparable(reason);
  const hasDirectorIdentityReference = /\bdirector(s)?\s+(name|names|detail|details|nic|passport|identity|id|number|numbers)\b/.test(text)
    || /\b(nic|passport|identity|id|number|numbers)\b.*\bdirector(s)?\b/.test(text);
  return hasDirectorIdentityReference
    && /\b(mismatch|inconsistent|inconsistency|not match|different)\b/.test(text)
    && !hasMixedIdentityTypesInText(reason);
};

const shouldKeepAiRequiredDocument = ({ documentName, reason, requirements, systemData, documentData }) => {
  if (isAoAAttestationDateIssue({ document: documentName, field: documentName, reason })) return false;
  if (isBankStatementRecencyIssue({ document: documentName, field: documentName, reason, rule: reason })) return false;
  if (isBankCustomerAddressIssue({ document: documentName, field: documentName, reason, rule: reason })) return false;
  // An identity document "mislabeled" as another identity type (passport in the
  // ID-copy slot) is acceptable — never demand a re-upload for it.
  if (isIdentityLabelContentSwap(reason)) return false;
  if (isAcceptedBankDocumentLabelSwap(reason)) return false;
  const docNameNorm = normalizeKey(normalizeDocName(documentName));
  const reasonNorm = normalizeComparable(reason || '');
  if (
    docNameNorm.includes('articlesofassociation')
    && normalizeComparable(documentName).includes('certified true copy')
    && (!reasonNorm || /\b(attestation|date|dated|older|expired|stale|month|months|within)\b/.test(reasonNorm))
  ) return false;

  const matchedReq = requirements.find((req) => namesMatch(req.required_docs, documentName));
  if (matchedReq?.is_mandatory) return true;

  if (
    isGenericRegulatoryLicenseRequirement(documentName)
    && requiredOperationalLicenseDetails(documentData, systemData).length
  ) return false;

  if (isForm20Requirement(documentName)) {
    return isDirectorIdentityForm20Reason(reason);
  }

  if (isRegulatoryLicenseRequirement(documentName, reason)) {
    return hasRegulatedOperationalNature(systemData, documentData);
  }

  return true;
};

const mergeDynamicLicenseRequirements = (requirements = [], documentData = {}, systemData = {}) => {
  const detectedLicenseDetails = requiredOperationalLicenseDetails(documentData, systemData);
  const detectedLicenseNames = detectedLicenseDetails.map((detail) => detail.license);
  const { sourceDocLabels } = documentOperationalBusinessText(documentData);

  // Also surface licenses the AI explicitly named in its DocumentRequirements output
  const aiRequiredDocs = documentData?.DocumentRequirements?.required_documents;
  const aiLicenseNames = [];
  if (Array.isArray(aiRequiredDocs)) {
    aiRequiredDocs.forEach((doc) => {
      const docName = typeof doc === 'string' ? doc : (doc?.document_name || doc?.required_docs || '');
      if (
        docName
        && isRegulatoryLicenseRequirement(docName)
        && !detectedLicenseNames.some((n) => namesMatch(n, docName))
        && !aiLicenseNames.some((n) => namesMatch(n, docName))
      ) {
        aiLicenseNames.push(docName);
      }
    });
  }

  const licenseNames = [...detectedLicenseNames, ...aiLicenseNames];
  if (!licenseNames.length) return requirements;

  const sourceSummary = sourceDocLabels.length
    ? `Detected in: ${sourceDocLabels.join(', ')}.`
    : 'Detected from business activity information.';

  const merged = requirements.map((req) => {
    if (!isRegulatoryLicenseRequirement(req.required_docs, req.description || '')) return req;
    if (isGenericRegulatoryLicenseRequirement(req.required_docs) && detectedLicenseDetails.length) {
      return req;
    }
    return {
      ...req,
      is_mandatory: true,
      description: detectedLicenseDetails.length
        ? detectedLicenseDetails.map((detail) => detail.reason).join(' ')
        : `Required because the operating activity detected in your documents requires this regulatory license. ${sourceSummary}`,
      licenseSourceDocs: sourceDocLabels,
    };
  });

  licenseNames.forEach((licenseName) => {
    if (merged.some((req) => namesMatch(req.required_docs, licenseName))) return;
    const detail = detectedLicenseDetails.find((item) => namesMatch(item.license, licenseName));
    merged.push({
      id: `dynamic-${normalizeKey(licenseName)}`,
      required_docs: licenseName,
      description: detail?.reason || `Required because the operating activity detected in your documents requires this regulatory license. ${sourceSummary}`,
      is_mandatory: true,
      licenseSourceDocs: detail?.source ? [detail.source] : sourceDocLabels,
      licenseTrigger: detail?.trigger || null,
    });
  });

  return merged;
};

const isMinorRegistrationDateMismatch = (row) => {
  if (normalizeKey(row.field) !== 'registrationdate') return false;
  const documentText = normalizeDocName(`${row.document || ''} ${row.reason || ''}`);
  if (!documentText.includes('business registration certificate') || !documentText.includes('form 1')) return false;

  const leftDate = parseDateValue(row.documentValue);
  const rightDate = parseDateValue(row.systemValue);
  if (!leftDate || !rightDate) return normalizeComparable(row.reason || '').includes('minor discrepancy');

  const days = Math.abs(leftDate.getTime() - rightDate.getTime()) / (24 * 60 * 60 * 1000);
  return days <= 3;
};

const isAoAOperationalNatureMismatch = (row, systemData, documentData) => {
  if (normalizeKey(row.field) !== 'natureofbusiness') return false;
  const documentText = normalizeDocName(`${row.document || ''} ${row.reason || ''}`);
  if (!documentText.includes('articles of association')) return false;
  return !hasRegulatedOperationalNature(systemData, documentData);
};

const isIdentityTypeOnlyMismatch = (row) => {
  const text = normalizeComparable(`${row.field || ''} ${row.reason || ''} ${row.rule || ''}`);
  const hasIdentityReference = /\b(nic|passport|identity|id|director)\b/.test(text);
  const hasMismatchReference = /\b(mismatch|inconsistent|inconsistency|not match|different|conflict)\b/.test(text);
  if (!hasIdentityReference || !hasMismatchReference) return false;

  if (hasCrossTypeIdentityPair(row.documentValue, row.systemValue)) return true;
  if (!isBlank(row.documentValue) || !isBlank(row.systemValue)) return false;
  if (hasCrossTypeIdentityPair(row.value, row.rule || row.reason || '')) return true;
  return !isBlank(row.value) && hasMixedIdentityTypesInText(`${row.value || ''} ${row.reason || ''} ${row.rule || ''}`);
};

const isAoAAttestationDateIssue = (row = {}) => {
  const docText = normalizeKey(normalizeDocName(`${row.document || ''} ${row.section || ''} ${row.field || ''}`));
  // Attestation-recency rules apply to ID copies only. The AoA has no 3-month
  // requirement here, and ROC forms (Form 01/20/40/13) are not time-limited
  // (onboarding matrix §7) — recency complaints against them are noise.
  const isExemptDocument = docText.includes('articlesofassociation')
    || docText.includes('form1')
    || docText.includes('form20')
    || docText.includes('form40')
    || docText.includes('form13');
  if (!isExemptDocument) return false;

  const text = normalizeComparable(`${row.reason || ''} ${row.rule || ''} ${row.value || ''}`);
  return /\b(attestation|certified true copy|certification|true copy)\b/.test(text)
    && /\b(date|dated|older|expired|stale|month|months|within|recency)\b/.test(text);
};

const isSecretaryChangePromptMismatch = (row) => {
  const fieldNorm = normalizeKey(row.field);
  if (!fieldNorm.includes('secretary')) return false;
  const documentText = normalizeDocName(`${row.document || ''} ${row.reason || ''}`);
  return documentText.includes('form 1') && documentText.includes('board resolution');
};

const shouldSuppressAiCrossDocumentMismatch = (row, systemData, documentData) => (
  row.category === 'ai_cross_document_mismatch'
  && (
    isMinorRegistrationDateMismatch(row)
    || isAoAOperationalNatureMismatch(row, systemData, documentData)
    || isIdentityTypeOnlyMismatch(row)
    || isSecretaryChangePromptMismatch(row)
    // The AI reports spacing/prefix-only differences as mismatches (e.g.
    // "WU 10537" vs "WU10537", "8760" vs "PVS8760"). If the engine's own
    // comparator says the two values are EQUAL, the AI's claim is noise.
    || valuesEqual(row.documentValue, row.systemValue, row.field || '')
  )
);

const shouldSuppressDocumentOnlyRow = (row) => {
  const fieldNorm = normalizeKey(row.field || '');
  const documentNorm = normalizeDocName(row.document || '');

  if ([
    'firstname', 'lastname', 'middlename', 'dateofbirth', 'gender',
    'nationality', 'documenttype', 'expirydate', 'certified',
    'registeredauthority', 'typeofcompany', 'legalstatus',
    'sharecapital', 'shareholderrights', 'registeredoffice',
    'listofdirectorssecretaries', 'signaturesfound',
    'currency', 'statementdate', 'customeraddress', 'copyrightsensitiveproductsdetected',
    'termsandcondition', 'refundpolicyfound', 'changes',
  ].includes(fieldNorm)) return true;

  if (fieldNorm.includes('directorinformation') || fieldNorm.includes('secretary')) return true;
  if (documentNorm.includes('articles of association') && fieldNorm === 'natureofbusiness') return true;

  return false;
};

const validateValue = ({ fieldName, fieldLabel, fieldType, value, source, document }) => {
  if (isBlank(value)) return [];

  const issues = [];
  const key = normalizeKey(`${fieldName || ''} ${fieldLabel || ''}`);
  const text = String(value).trim();
  const digits = text.replace(/\D/g, '');

  const add = (rule) => {
    issues.push({
      field: fieldLabel || humanizeKey(fieldName),
      source,
      document,
      value: displayValue(value),
      rule,
    });
  };

  if (fieldType === 'email' || key.includes('email')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) add('Must be a valid email address.');
  }

  if (key.includes('url') || key.includes('website')) {
    try {
      const url = new URL(text);
      if (!['http:', 'https:'].includes(url.protocol)) add('Must be a valid HTTP or HTTPS URL.');
    } catch {
      add('Must be a valid URL.');
    }
  }

  if (fieldType === 'number' && Number.isNaN(Number(String(value).replace(/,/g, '')))) {
    add('Must be numeric.');
  }

  if (key.includes('phone') || key.includes('mobile') || key.includes('contactnumber')) {
    if (digits.length < 7 || digits.length > 15) add('Must contain a valid contact number.');
  }

  if (isIdentityComparisonContext(key)) {
    // Only validate NIC format when the source document is an identity document.
    // Fields like "NIC/Passport/DL Number" can appear in Form 01 as company IDs or
    // other reference numbers — those must not be rejected as malformed NICs.
    const docNorm = normalizeDocName(document || '');
    const isIdentityDoc = docNorm.includes('identity') || docNorm.includes('passport') || docNorm.includes('driving');
    if (isIdentityDoc) {
      // Foreign passports don't follow Sri Lankan formats (a UK passport is 9
      // plain digits) — when the source document is a PASSPORT, accept any
      // 6–10 character alphanumeric number instead of forcing NIC rules.
      const isPassportDocument = String(document || '').toLowerCase().includes('passport');
      const isPlausiblePassportNumber = (token) => /^[a-z0-9]{6,10}$/i.test(String(token).replace(/[^a-z0-9]/gi, ''));

      const tokens = extractIdentityTokens(text);
      const valuesToCheck = tokens.length ? tokens : [text];
      const invalidTokens = valuesToCheck.filter((token) => !isValidIdentityToken(token)
        && !(isPassportDocument && isPlausiblePassportNumber(token)));
      if (invalidTokens.length) {
        add('Sri Lankan NIC must be 9 digits plus V/X or 12 digits (or a valid passport number).');
      }
      return issues;
    }
  }

  if (fieldType === 'date' || key.includes('date') || key.includes('expiry') || key.includes('expire')) {
    const date = parseDateValue(value);
    if (!date) {
      add('Must be a valid date.');
    } else if (key.includes('expiry') || key.includes('expire') || key.includes('validuntil')) {
      // Only check expiry for system API data — AI document extraction dates may be historical
      // or misidentified by the AI, producing false positives for old but re-validated documents.
      if (source !== SOURCE_DOCUMENTS) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (date < today) add('Document or license date is expired.');
      }
    }
  }

  if (key.includes('registrationnumber') || key.includes('brcnumber')) {
    if (text.replace(/[^a-zA-Z0-9]/g, '').length < 3) add('Registration number is too short.');
  }

  if (key.includes('accountnumber') && digits.length < 5) {
    add('Bank account number is too short.');
  }

  return issues;
};

const addUnique = (rows, row, keyParts) => {
  const key = keyParts.map((part) => normalizeComparable(part || '')).join('|');
  if (!rows.some((existing) => existing._key === key)) rows.push({ ...row, _key: key });
};

const stripKeys = (rows) => rows.map(({ _key, ...row }) => row);

const aiExtractedValue = (item) => firstValueByKeys(item, [
  'value',
  'extractedValue',
  'extracted_value',
  'documentValue',
  'document_value',
  'aiValue',
  'ai_value',
]);

const promptCoverageItems = (documentData) => aiArraysFor(documentData, AI_FIELD_COVERAGE_KEYS)
  .filter((item) => isPlainObject(item) && !isIgnoredItemSource(item));

const isStakeholderCoverageItem = (item) => {
  const sectionNorm = normalizeKey(aiSection(item) || '');
  const sourceNorm = normalizeKey(aiSource(item, ''));
  return (
    sectionNorm === 'ownerinformation'
    || sectionNorm === 'owners'
    || sectionNorm === 'directors'
    || sectionNorm === 'stakeholders'
    || sourceNorm.includes('stakeholder')
  );
};

const isBankCustomerAddressField = ({ section, field, documentName } = {}) => {
  const sectionNorm = normalizeKey(section || '');
  const fieldNorm = normalizeKey(field || '');
  const docNorm = normalizeDocName(documentName || '');
  const isCustomerAddress = fieldNorm === 'customeraddress'
    || fieldNorm === 'bankcustomeraddress'
    || (fieldNorm.includes('customer') && fieldNorm.includes('address'));
  const isBankContext = sectionNorm === 'bankdetails'
    || docNorm.includes('bank statement')
    || docNorm.includes('bank confirmation');
  return isCustomerAddress && isBankContext;
};

const isBankCustomerAddressRow = (row = {}) => isBankCustomerAddressField({
  section: row.section,
  field: row.field,
  documentName: row.document || row.documentName,
});

const isBankCustomerAddressIssue = (row = {}) => {
  if (isBankCustomerAddressRow(row)) return true;
  const docNorm = normalizeDocName(`${row.document || row.documentName || ''} ${row.section || ''}`);
  if (!docNorm.includes('bank statement') && !docNorm.includes('bank confirmation')) return false;
  const text = normalizeComparable(`${row.field || ''} ${row.reason || ''} ${row.rule || ''}`);
  return /\bcustomer\s+address\b/.test(text);
};

const shouldSkipPromptSystemComparison = ({ section, field, documentName }) => {
  const sectionNorm = normalizeKey(section || '');
  const fieldNorm = normalizeKey(field || '');
  const docNorm = normalizeDocName(documentName || '');

  if (isBankCustomerAddressField({ section, field, documentName })) return true;

  if (
    ['ownerinformation', 'owners', 'stakeholders'].includes(sectionNorm)
    && ['firstname', 'lastname', 'middlename'].includes(fieldNorm)
  ) return true;

  if (sectionNorm === 'directors' && fieldNorm === 'designation') return true;
  if (fieldNorm === 'natureofbusiness' && (
    sectionNorm === 'articlesofassociationdetails'
    || docNorm.includes('articles of association')
  )) return true;

  return false;
};

const isNonBlockingPromptCoverageMissing = ({ section, field, documentName, reason }) => {
  const sectionNorm = normalizeKey(section || '');
  const fieldNorm = normalizeKey(field || '');
  const docNorm = normalizeDocName(documentName || '');
  const reasonNorm = normalizeComparable(reason || '');

  if (
    fieldNorm === 'sharecapital'
    && (sectionNorm === 'articlesofassociationdetails' || docNorm.includes('articles of association'))
  ) return true;

  if (['firstname', 'lastname', 'middlename'].includes(fieldNorm) && reasonNorm.includes('corporate entity')) {
    return true;
  }

  if (isBankCustomerAddressField({ section, field, documentName })) return true;

  if (isBrcOwnerNicPromptGap({ section, field, documentName, reason })) return true;

  return false;
};

const isBrcOwnerNamePromptField = ({ section, field, documentName } = {}) => {
  const sectionNorm = normalizeKey(section || '');
  const fieldNorm = normalizeKey(field || '');
  const docNorm = normalizeDocName(documentName || '');
  const isOwnerNameField = fieldNorm === 'ownername'
    || fieldNorm === 'proprietorname'
    || (fieldNorm.includes('owner') && fieldNorm.includes('name'));
  const isBrcContext = sectionNorm === 'businessregistration'
    || docNorm.includes('business registration certificate')
    || docNorm === 'brc';
  return isOwnerNameField && isBrcContext;
};

const isCorporateSecretaryCoverageGroup = (item, stakeholderRouting) => {
  const sectionNorm = normalizeKey(aiSection(item) || '');
  if (!['ownerinformation', 'owners', 'stakeholders'].includes(sectionNorm)) return false;

  const group = stakeholderRouting.groupByItem.get(item);
  const text = (group?.items || [item]).map((groupItem) => [
    aiField(groupItem, ''),
    aiExtractedValue(groupItem),
    aiReason(groupItem, ''),
    aiDocument(groupItem, ''),
  ].map(searchableText).join(' ')).join(' ');

  return /\b(pvt|private limited|limited liability|company registration|corporate entity|secretary registration|sec\s*frm)\b/i
    .test(text.replace(/[\/_-]+/g, ' '));
};

const findStakeholderOwnerNameRow = (systemFlatRows, documentValue) => {
  const groups = new Map();
  systemFlatRows.forEach((row) => {
    const parts = String(row.path || '').split('.');
    if (parts.length < 2 || !['stakeholders', 'owners'].includes(parts[0])) return;
    const prefix = parts.slice(0, 2).join('.');
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(row);
  });

  const pick = (rows, keys) => rows.find((row) => (
    keys.includes(normalizeKey(row.field || row.canonical || '')) && !isBlank(row.value)
  ));

  const candidates = [...groups.entries()].map(([prefix, rows]) => {
    const fullName = pick(rows, ['name', 'fullname']);
    const registeredName = pick(rows, ['nameofregistereddirectorpartner', 'registeredname', 'directorpartnername']);
    const firstName = pick(rows, ['firstname', 'first']);
    const middleName = pick(rows, ['middlename', 'middle']);
    const lastName = pick(rows, ['lastnameofrdp', 'lastname', 'last']);
    const sourceRow = fullName || registeredName || firstName || lastName;
    if (!sourceRow) return null;

    const value = fullName?.value
      || [registeredName?.value || firstName?.value, middleName?.value, lastName?.value]
        .filter((part) => !isBlank(part))
        .join(' ');
    if (isBlank(value)) return null;

    return {
      field: 'stakeholder_owner_name',
      label: 'Stakeholder Owner Name',
      path: `${prefix}.__owner_name`,
      canonical: 'stakeholderownername',
      pathCanonical: normalizeKey(`${prefix}.__owner_name`),
      value,
    };
  }).filter(Boolean);

  if (!candidates.length) return null;
  if (!isBlank(documentValue)) {
    return candidates.find((row) => valuesEqual(documentValue, row.value, 'owner name'))
      || candidates.find((row) => valuesNearMatch(documentValue, row.value))
      || null;
  }
  return candidates[0];
};

const findPreferredSystemRowForPromptField = ({ section, field, documentName, documentValue }, systemFlatRows) => {
  const sectionNorm = normalizeKey(section || '');
  const fieldNorm = normalizeKey(field || '');

  if (sectionNorm === 'businessregistration' && fieldNorm === 'companyname') {
    return systemFlatRows.find((row) => row.path === 'business_information.registered_name_of_business')
      || systemFlatRows.find((row) => normalizeKey(row.path || '').endsWith('registerednameofbusiness'));
  }

  if (isBrcOwnerNamePromptField({ section, field, documentName })) {
    return findStakeholderOwnerNameRow(systemFlatRows, documentValue);
  }

  // A document's Business Address corresponds to street_address_business, not
  // street_address (the owner's legal/home address) — comparing against the
  // latter produced false mismatches for merchants whose shop and home differ.
  if (sectionNorm === 'businessregistration' && fieldNorm === 'businessaddress') {
    const businessAddrRow = systemFlatRows.find((row) => row.path === 'business_information.street_address_business')
      || systemFlatRows.find((row) => normalizeKey(row.path || '').endsWith('streetaddressbusiness'));
    if (businessAddrRow && !isBlank(businessAddrRow.value)) return businessAddrRow;
  }

  return null;
};

const flattenNameValues = (value) => {
  if (Array.isArray(value)) return value.flatMap(flattenNameValues);
  if (isPlainObject(value)) {
    const directName = firstNonBlankByKeys(value, [
      'name',
      'fullName',
      'full_name',
      'companyName',
      'company_name',
      'Secretary',
      'secretary',
    ]);
    if (directName) return [directName];
    return Object.values(value).flatMap(flattenNameValues);
  }
  if (isBlank(value)) return [];
  return [String(value)];
};

const cleanPersonOrEntityName = (value = '') => String(value || '')
  .replace(/[()]/g, ' ')
  .replace(/\b(director|company secretary|secretary|designation|name|reg no|registration no)\b/gi, ' ')
  .replace(/[\/]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const isSecretaryOrCorporateEntry = (value = '') => {
  const text = String(value || '').replace(/[\/_-]+/g, ' ');
  return /\b(secretary|sec\s*frm|corporate entity|company registration|pvt|private limited|management solutions)\b/i.test(text);
};

const namesSemanticallyMatch = (left, right) => {
  const leftName = cleanPersonOrEntityName(left);
  const rightName = cleanPersonOrEntityName(right);
  if (!leftName || !rightName) return false;
  return valuesEqual(leftName, rightName, 'name')
    || valuesNearMatch(leftName, rightName)
    || tokenSimilarity(leftName, rightName) >= 0.45;
};

const listDisplay = (values = []) => values.filter(Boolean).join(', ');

const extractAoADirectors = (documentData = {}) => {
  const list = documentData?.ArticlesOfAssociationDetails?.['List of Directors/Secretaries']
    || documentData?.ArticlesOfAssociationDetails?.ListOfDirectorsSecretaries;

  if (isPlainObject(list)) {
    return flattenNameValues(list.Directors || list.directors || [])
      .map(cleanPersonOrEntityName)
      .filter(Boolean);
  }

  return flattenNameValues(list)
    .filter((entry) => !isSecretaryOrCorporateEntry(entry))
    .map(cleanPersonOrEntityName)
    .filter(Boolean);
};

const extractAoASecretaries = (documentData = {}) => {
  const list = documentData?.ArticlesOfAssociationDetails?.['List of Directors/Secretaries']
    || documentData?.ArticlesOfAssociationDetails?.ListOfDirectorsSecretaries;

  if (isPlainObject(list)) {
    return flattenNameValues(list.Secretary || list.secretary || list.Secretaries || list.secretaries || [])
      .map(cleanPersonOrEntityName)
      .filter(Boolean);
  }

  return flattenNameValues(list)
    .filter(isSecretaryOrCorporateEntry)
    .map(cleanPersonOrEntityName)
    .filter(Boolean);
};

const extractBoardDirectors = (documentData = {}) => (
  flattenNameValues(documentData?.DirectorChange?.['Director information from Board Resolution']
    || documentData?.DirectorChange?.directorInformationFromBoardResolution
    || [])
    .map(cleanPersonOrEntityName)
    .filter(Boolean)
);

const extractBoardSecretaries = (documentData = {}) => (
  flattenNameValues(documentData?.SecretaryChange?.['secretary/secretaries information from Board Resolution']
    || documentData?.SecretaryChange?.secretaryInformationFromBoardResolution
    || [])
    .map(cleanPersonOrEntityName)
    .filter(Boolean)
);

const compareDocumentNameLists = (leftValues, rightValues) => {
  const leftMissing = leftValues.filter((left) => !rightValues.some((right) => namesSemanticallyMatch(left, right)));
  const rightMissing = rightValues.filter((right) => !leftValues.some((left) => namesSemanticallyMatch(left, right)));
  return { leftMissing, rightMissing };
};

const coverageValueForDocField = (documentData, docIncludes, fieldNames) => {
  const fieldKeys = fieldNames.map(normalizeKey);
  const item = promptCoverageItems(documentData).find((coverageItem) => {
    const docNorm = normalizeDocName(stripAiDocumentLabel(aiDocument(coverageItem, '')));
    const fieldNorm = normalizeKey(aiField(coverageItem, ''));
    return docIncludes.some((docPart) => docNorm.includes(docPart))
      && fieldKeys.includes(fieldNorm)
      && !isBlank(aiExtractedValue(coverageItem));
  });
  return item ? aiExtractedValue(item) : null;
};

const addAoABoardCrossChecks = (documentData, { addMismatch, addMatched }) => {
  const aoaDirectors = extractAoADirectors(documentData);
  const boardDirectors = extractBoardDirectors(documentData);

  if (aoaDirectors.length && boardDirectors.length) {
    const { leftMissing, rightMissing } = compareDocumentNameLists(aoaDirectors, boardDirectors);
    if (leftMissing.length || rightMissing.length) {
      addMismatch({
        field: 'Director List',
        document: 'Articles of Association vs Board Resolution',
        documentValue: listDisplay(aoaDirectors),
        systemValue: listDisplay(boardDirectors),
        reason: [
          leftMissing.length ? `AoA director(s) not seen in Board Resolution: ${listDisplay(leftMissing)}.` : '',
          rightMissing.length ? `Board Resolution director(s) not seen in AoA: ${listDisplay(rightMissing)}.` : '',
        ].filter(Boolean).join(' '),
        category: 'aoa_board_cross_check',
      });
    } else {
      addMatched({
        field: 'Director List',
        document: 'Articles of Association vs Board Resolution',
        documentValue: listDisplay(aoaDirectors),
        systemValue: listDisplay(boardDirectors),
        nearMatch: true,
      });
    }
  }

  const aoaSecretaries = extractAoASecretaries(documentData);
  const boardSecretaries = extractBoardSecretaries(documentData);
  if (aoaSecretaries.length && boardSecretaries.length) {
    const { leftMissing, rightMissing } = compareDocumentNameLists(aoaSecretaries, boardSecretaries);
    if (leftMissing.length || rightMissing.length) {
      addMismatch({
        field: 'Secretary Information',
        document: 'Articles of Association vs Board Resolution',
        documentValue: listDisplay(aoaSecretaries),
        systemValue: listDisplay(boardSecretaries),
        reason: 'Company secretary information differs between the Articles of Association and Board Resolution. Confirm whether the Board Resolution is only showing a signing designation or whether the company secretary changed; if changed, latest ROC evidence is required.',
        category: 'aoa_board_cross_check',
      });
    } else {
      addMatched({
        field: 'Secretary Information',
        document: 'Articles of Association vs Board Resolution',
        documentValue: listDisplay(aoaSecretaries),
        systemValue: listDisplay(boardSecretaries),
        nearMatch: true,
      });
    }
  }

  [
    { label: 'Company Name', fields: ['Company Name', 'CompanyName', 'Registered Company Name'] },
    { label: 'Registration Number', fields: ['Registration Number', 'RegistrationNumber', 'Company Registration Number'] },
    { label: 'Registered Address', fields: ['Registered Address', 'RegisteredAddress', 'Registered Office', 'RegisteredOffice'] },
  ].forEach(({ label, fields }) => {
    const aoaValue = coverageValueForDocField(documentData, ['articles of association'], fields);
    const boardValue = coverageValueForDocField(documentData, ['board resolution'], fields);
    if (isBlank(aoaValue) || isBlank(boardValue)) return;

    if (valuesEqual(aoaValue, boardValue, label) || valuesNearMatch(aoaValue, boardValue)) {
      addMatched({
        field: label,
        document: 'Articles of Association vs Board Resolution',
        documentValue: displayValue(aoaValue),
        systemValue: displayValue(boardValue),
        nearMatch: !valuesEqual(aoaValue, boardValue, label),
      });
      return;
    }

    addMismatch({
      field: label,
      document: 'Articles of Association vs Board Resolution',
      documentValue: displayValue(aoaValue),
      systemValue: displayValue(boardValue),
      reason: `${label} differs between the Articles of Association and Board Resolution.`,
      category: 'aoa_board_cross_check',
    });
  });
};

const isStakeholderNameField = (fieldNorm) => (
  fieldNorm === 'fullname'
  || fieldNorm === 'name'
  || fieldNorm === 'ownername'
  || fieldNorm === 'stakeholdername'
  || fieldNorm === 'directorname'
  || fieldNorm === 'signatoryname'
);

const isStakeholderDobField = (fieldNorm) => (
  fieldNorm === 'dateofbirth'
  || fieldNorm === 'dob'
  || fieldNorm === 'birthdate'
  || fieldNorm === 'birthdatedate'
);

const normalizePersonName = (value = '') => normalizeComparable(value)
  .replace(/\b(mr|mrs|ms|miss|dr)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const nameTokens = (value = '') => normalizePersonName(value)
  .split(/\s+/)
  .filter((token) => token.length > 1);

const fuzzyTokenMatch = (left, right) => (
  left === right
  || (
    left.length >= 4
    && right.length >= 4
    && (
      left.includes(right)
      || right.includes(left)
      || levenshteinDistance(left, right) <= 1
    )
  )
);

const namesStronglyMatch = (left, right) => {
  const leftName = normalizePersonName(left);
  const rightName = normalizePersonName(right);
  if (!leftName || !rightName) return false;
  if (leftName === rightName || valuesNearMatch(leftName, rightName)) return true;

  const leftTokens = nameTokens(leftName);
  const rightTokens = nameTokens(rightName);
  if (leftTokens.length < 2 || rightTokens.length < 2) return false;

  const matched = leftTokens.filter((leftToken) => (
    rightTokens.some((rightToken) => fuzzyTokenMatch(leftToken, rightToken))
  )).length;
  return matched >= Math.min(2, leftTokens.length, rightTokens.length);
};

const normalizedDobValue = (value) => {
  const parsed = parseDateValue(value);
  if (parsed) return parsed.toISOString().slice(0, 10);
  return normalizeComparable(value);
};

const groupsLikelySameStakeholder = (left, right) => {
  const leftNames = [...(left.names || [])];
  const rightNames = [...(right.names || [])];
  const nameMatch = leftNames.some((leftName) => (
    rightNames.some((rightName) => namesStronglyMatch(leftName, rightName))
  ));
  if (!nameMatch) return false;

  const leftDobs = [...(left.dobValues || [])].filter(Boolean);
  const rightDobs = [...(right.dobValues || [])].filter(Boolean);
  if (leftDobs.length && rightDobs.length) {
    return leftDobs.some((dob) => rightDobs.includes(dob));
  }

  const leftHasFullName = leftNames.some((name) => nameTokens(name).length >= 2);
  const rightHasFullName = rightNames.some((name) => nameTokens(name).length >= 2);
  return leftHasFullName && rightHasFullName;
};

const linkStakeholderGroupsByAcceptedIdentity = (groups) => {
  const identityMatchedGroups = groups.filter((group) => (
    group.systemPrefix && group.systemPrefixMatch === 'identity'
  ));

  groups.forEach((group) => {
    if (group.systemPrefix) return;
    const linkedGroup = identityMatchedGroups.find((candidate) => (
      groupsLikelySameStakeholder(group, candidate)
    ));
    if (!linkedGroup) return;
    group.systemPrefix = linkedGroup.systemPrefix;
    group.systemPrefixMatch = 'linked_identity';
  });
};

const buildStakeholderCoverageRouting = (coverage, systemFlatRows) => {
  const groupByItem = new Map();
  const groups = [];
  const currentGroupByScope = new Map();

  coverage.forEach((item) => {
    if (!isStakeholderCoverageItem(item)) return;

    const sectionNorm = normalizeKey(aiSection(item) || '');
    const sourceNorm = normalizeKey(aiSource(item, ''));
    const scope = sectionNorm || sourceNorm || 'stakeholder';
    const fieldNorm = normalizeKey(aiField(item) || '');
    let group = currentGroupByScope.get(scope);
    const isStarterField = fieldNorm === 'fullname' || fieldNorm === 'name';

    if (!group || (isStarterField && group.fieldNorms.has(fieldNorm))) {
      group = {
        items: [],
        fieldNorms: new Set(),
        identityTokens: new Set(),
        names: new Set(),
        dobValues: new Set(),
        systemPrefix: null,
        systemPrefixMatch: null,
      };
      groups.push(group);
      currentGroupByScope.set(scope, group);
    }

    group.items.push(item);
    group.fieldNorms.add(fieldNorm);
    groupByItem.set(item, group);
    const value = aiExtractedValue(item);
    extractIdentityTokensForContext(
      value,
      aiField(item, ''),
      aiSection(item) || '',
      aiSource(item, ''),
      aiDocument(item, '')
    ).forEach((token) => group.identityTokens.add(token));
    if (isStakeholderNameField(fieldNorm) && !isBlank(value)) {
      group.names.add(displayValue(value));
    }
    if (isStakeholderDobField(fieldNorm) && !isBlank(value)) {
      group.dobValues.add(normalizedDobValue(value));
    }
  });

  const identityToStakeholderPrefix = new Map();
  const identityTokenDisplay = new Map(); // canonical token → raw value as stored in the system
  systemFlatRows.forEach((row) => {
    const pathParts = String(row.path || '').split('.');
    if (pathParts.length < 2 || !['stakeholders', 'owners'].includes(pathParts[0])) return;

    const rowKey = normalizeKey(row.field || row.canonical || '');
    const isIdentityRow = rowKey === 'id'
      || rowKey === 'nic'
      || rowKey.includes('passport')
      || rowKey.includes('nationalidentity')
      || rowKey.includes('idnumber');
    if (!isIdentityRow) return;

    const prefix = pathParts.slice(0, 2).join('.');
    extractIdentityTokensForContext(row.value, row.field, row.label, row.path).forEach((token) => {
      if (!identityToStakeholderPrefix.has(token)) {
        identityToStakeholderPrefix.set(token, prefix);
        identityTokenDisplay.set(token, displayValue(row.value));
      }
    });
  });

  groups.forEach((group) => {
    for (const token of group.identityTokens) {
      const prefix = identityToStakeholderPrefix.get(token);
      if (prefix) {
        group.systemPrefix = prefix;
        group.systemPrefixMatch = 'identity';
        break;
      }
    }
  });

  linkStakeholderGroupsByAcceptedIdentity(groups);

  return {
    groupByItem,
    groups,
    systemIdentityTokens: [...identityToStakeholderPrefix.keys()],
    systemIdentityDisplay: identityTokenDisplay,
  };
};

// Flags identity documents whose ID number matches NO stakeholder registered in
// the system — a person on the documents who isn't on the system record. Only
// same-type comparisons are made (NIC vs NIC, passport vs passport) so a
// document NIC against a system passport never false-positives.
const addUnmatchedStakeholderIdentityChecks = (stakeholderRouting, addMismatch) => {
  const { groups = [], systemIdentityTokens = [], systemIdentityDisplay = new Map() } = stakeholderRouting;
  const seenTokenSets = new Set();
  const showToken = (token) => systemIdentityDisplay.get(token) || token;

  groups.forEach((group) => {
    if (group.systemPrefix || !group.identityTokens.size) return;
    // Corporate company secretaries are entities, not people — their SEC/FRM
    // registration numbers must not be treated as unmatched personal IDs.
    if (group.items.some((item) => isCorporateSecretaryCoverageGroup(item, stakeholderRouting))) return;

    const docTokens = [...group.identityTokens];
    const tokenSetKey = docTokens.slice().sort().join('|');
    if (seenTokenSets.has(tokenSetKey)) return;

    const docTypes = new Set(docTokens.map(identityTokenType).filter(Boolean));
    if (!docTypes.size) return;
    const sameTypeSystemIds = systemIdentityTokens
      .filter((token) => docTypes.has(identityTokenType(token)));
    if (!sameTypeSystemIds.length) return; // only cross-type IDs on record — not comparable

    seenTokenSets.add(tokenSetKey);

    const idItem = group.items.find((item) => extractIdentityTokens(aiExtractedValue(item)).length);
    const nameItem = group.items.find((item) => ['fullname', 'name'].includes(normalizeKey(aiField(item, ''))));
    const personName = nameItem ? displayValue(aiExtractedValue(nameItem)) : '';
    const docIdDisplay = displayValue(idItem ? aiExtractedValue(idItem) : docTokens.join(', '));
    const systemIdList = sameTypeSystemIds.slice(0, 5).map(showToken).join(', ')
      + (sameTypeSystemIds.length > 5 ? ', …' : '');

    addMismatch({
      field: idItem ? aiField(idItem, 'NIC/Passport/DL Number') : 'NIC/Passport/DL Number',
      document: idItem ? aiDocument(idItem, 'Identity document') : 'Identity document',
      documentValue: docIdDisplay,
      systemValue: systemIdList,
      reason: `Identity document${personName && personName !== '-' ? ` for "${personName}"` : ''} carries ID ${docIdDisplay}, which does not match any stakeholder registered in the system (registered stakeholder ID(s): ${systemIdList}). The person on the submitted ID is not on the system record, or the recorded ID is wrong.`,
      category: 'identity_cross_check',
    });
  });
};

const addPromptCoverageComparisons = (documentData, systemFlatRows, {
  addMissing,
  addInvalid,
  addMismatch,
  addMatched,
  addDocumentOnly,
}) => {
  const coverage = promptCoverageItems(documentData);
  const stakeholderRouting = buildStakeholderCoverageRouting(coverage, systemFlatRows);

  addUnmatchedStakeholderIdentityChecks(stakeholderRouting, addMismatch);

  // Build document → NIC map so we can route each owner document to its matching stakeholder.
  // New-format NICs sometimes get a trailing V/X appended by OCR — normalise it away.

  coverage.forEach((item) => {
    const field = aiField(item);
    const documentName = aiDocument(item, aiSection(item) || 'Prompt field coverage');
    const apiSource = aiSource(item, '');
    const section = aiSection(item);
    if (isCorporateSecretaryCoverageGroup(item, stakeholderRouting)) return;
    if (AI_METADATA_SECTION_KEYS.has(normalizeKey(section || ''))) return;
    const status = aiStatus(item);
    const present = aiBool(firstValueByKeys(item, ['present', 'isPresent', 'is_present', 'found', 'exists']));
    const required = aiBool(firstValueByKeys(item, ['required', 'isRequired', 'is_required', 'mandatory']));
    const docValue = aiExtractedValue(item);
    const reason = aiReason(item, 'Prompt-defined field is missing or invalid in the document extraction.');

    const skipSystemComparison = shouldSkipPromptSystemComparison({ section, field, documentName, apiSource });
    const stakeholderGroup = stakeholderRouting.groupByItem.get(item);
    let systemRow;
    if (!skipSystemComparison && stakeholderGroup?.systemPrefix) {
      const stakeholderRows = systemFlatRows.filter((r) => String(r.path || '').startsWith(`${stakeholderGroup.systemPrefix}.`));
      systemRow = findFlatValue(stakeholderRows, promptComparisonAliases({ field, section, documentName, apiSource }));
    }
    if (!skipSystemComparison && !systemRow) {
      systemRow = findPreferredSystemRowForPromptField({
        section,
        field,
        documentName,
        documentValue: docValue,
      }, systemFlatRows);
    }
    if (!skipSystemComparison && !systemRow && !stakeholderGroup
      && !isBrcOwnerNamePromptField({ section, field, documentName })) {
      systemRow = findFlatValue(systemFlatRows, promptComparisonAliases({ field, section, documentName, apiSource }));
    }

    const systemValue = systemRow?.value;
    const docMissing = (
      present === false
      || ['missing', 'notfound', 'absent', 'empty', 'unreadable'].includes(status)
      || (present !== true && status !== 'present' && isBlank(docValue))
    );
    if (docMissing && isNonBlockingPromptCoverageMissing({ section, field, documentName, reason })) return;

    const systemMissing = skipSystemComparison || !systemRow || isBlank(systemValue);

    if (status === 'notapplicable' || status === 'na' || required === false) return;

    if (['invalid', 'expired', 'faulty', 'failed'].includes(status)) {
      addInvalid({
        field,
        source: SOURCE_DOCUMENTS,
        document: documentName,
        value: displayValue(docValue),
        rule: reason,
        category: 'ai_prompt_field',
      });
    }

    if (!docMissing) {
      validateValue({
        fieldName: field,
        fieldLabel: field,
        fieldType: '',
        value: docValue,
        source: SOURCE_DOCUMENTS,
        document: documentName,
      }).forEach(addInvalid);
    }

    if (!systemMissing) {
      validateValue({
        fieldName: systemRow.field,
        fieldLabel: systemRow.label || field,
        fieldType: '',
        value: systemValue,
        source: SOURCE_SYSTEM,
        document: sourceLabelForRow(systemRow),
      }).forEach(addInvalid);
    }

    if (docMissing && systemMissing) {
      addMissing({
        field,
        source: SOURCE_DOCUMENTS,
        document: documentName,
        reason: 'Field was not found in either document extraction or external system API data.',
        category: 'prompt_field_comparison',
        documentValue: '(not found)',
        systemValue: '(not found)',
      });
      return;
    }

    if (docMissing) {
      addMissing({
        field,
        source: SOURCE_DOCUMENTS,
        document: documentName,
        reason,
        category: 'prompt_field_comparison',
        documentValue: '(not found)',
        systemValue: displayValue(systemValue),
      });
      return;
    }

    if (skipSystemComparison) return;

    if (systemMissing) {
      addDocumentOnly({
        field,
        document: documentName,
        value: displayValue(docValue),
        reason: 'Captured from document; no counterpart in external system API.',
      });
      return;
    }

    if (valuesEqual(docValue, systemValue, `${field} ${systemRow.field}`)) {
      addMatched({
        field,
        document: documentName,
        documentValue: displayValue(docValue),
        systemValue: displayValue(systemValue),
        nearMatch: false,
      });
      return;
    }

    if (valuesNearMatch(docValue, systemValue)) {
      addMatched({
        field,
        document: documentName,
        documentValue: displayValue(docValue),
        systemValue: displayValue(systemValue),
        nearMatch: true,
      });
      return;
    }

    // A passport number vs an NIC are different identifier TYPES — both can be
    // valid for the same person (prompt rule: never a mismatch by themselves).
    if (isIdentityComparisonContext(normalizeKey(field)) && hasCrossTypeIdentityPair(docValue, systemValue)) {
      if (stakeholderGroup?.systemPrefix && ['identity', 'linked_identity'].includes(stakeholderGroup.systemPrefixMatch)) {
        addMatched({
          field,
          document: documentName,
          documentValue: displayValue(docValue),
          systemValue: displayValue(systemValue),
          nearMatch: true,
          matchReason: 'Valid: this stakeholder is already matched by another accepted identity document (NIC, passport, or driving licence), so the alternate ID is accepted.',
        });
        return;
      }
      addDocumentOnly({
        field,
        document: documentName,
        value: displayValue(docValue),
        reason: 'Different identifier types (NIC vs passport/DL) - both may be valid for the same person; not treated as a mismatch.',
      });
      return;
    }

    addMismatch({
      field,
      document: documentName,
      documentValue: displayValue(docValue),
      systemValue: displayValue(systemValue),
      reason: 'Google AI document value does not match the external system API value.',
      category: 'prompt_field_cross_check',
    });
  });

  return coverage.length;
};

const addAiPromptFindings = (documentData, { addMissing, addInvalid, addMismatch }, options = {}) => {
  if (options.includeCoverage !== false) aiArraysFor(documentData, AI_FIELD_COVERAGE_KEYS).forEach((item) => {
    if (!isPlainObject(item)) return;
    if (isIgnoredItemSource(item)) return;
    if (AI_METADATA_SECTION_KEYS.has(normalizeKey(aiSection(item) || ''))) return;

    const status = aiStatus(item);
    const present = aiBool(firstValueByKeys(item, ['present', 'isPresent', 'is_present', 'found', 'exists']));
    const required = aiBool(firstValueByKeys(item, ['required', 'isRequired', 'is_required', 'mandatory']));
    const value = aiExtractedValue(item);
    const field = aiField(item);
    const document = aiDocument(item, aiSection(item) || 'Prompt field coverage');
    const reason = aiReason(item, 'Prompt-defined field is missing or invalid in the document extraction.');

    if (status === 'notapplicable' || status === 'na' || required === false) return;
    if (isNonBlockingPromptCoverageMissing({ section: aiSection(item), field, documentName: document, reason })) return;

    if (
      present === false
      || ['missing', 'notfound', 'absent', 'empty', 'unreadable'].includes(status)
      || (present !== true && status !== 'present' && isBlank(value))
    ) {
      addMissing({
        field,
        source: SOURCE_DOCUMENTS,
        document,
        reason,
        category: 'ai_prompt_field',
      });
      return;
    }

    if (['invalid', 'expired', 'faulty', 'failed', 'mismatch', 'inconsistent'].includes(status)) {
      addInvalid({
        field,
        source: SOURCE_DOCUMENTS,
        document,
        value: displayValue(value),
        rule: reason,
        category: 'ai_prompt_field',
      });
    }
  });

  if (options.includeMissingFields !== false) aiArraysFor(documentData, AI_MISSING_FIELD_KEYS).forEach((item) => {
    const field = aiField(item);
    const section = isPlainObject(item) ? aiSection(item) : null;
    if (isPlainObject(item) && isIgnoredItemSource(item)) return;
    if (isPlainObject(item) && AI_METADATA_SECTION_KEYS.has(normalizeKey(section || ''))) return;
    if (isPlainObject(item) && isNonBlockingPromptCoverageMissing({
      section,
      field,
      documentName: aiDocument(item, section || 'Prompt missing field'),
      reason: aiReason(item, ''),
    })) return;
    addMissing({
      field,
      source: SOURCE_DOCUMENTS,
      document: isPlainObject(item) ? aiDocument(item, section || 'Prompt missing field') : 'Prompt missing field',
      reason: aiReason(item, 'Prompt-defined field is missing from the Google AI document extraction.'),
      category: 'ai_missing_field',
    });
  });

  aiArraysFor(documentData, AI_INVALID_DATA_KEYS).forEach((item) => {
    if (!isPlainObject(item)) {
      addInvalid({
        field: String(item || 'Invalid data'),
        source: SOURCE_DOCUMENTS,
        document: 'Prompt invalid data',
        value: displayValue(item),
        rule: 'Google AI marked this prompt-defined data as invalid.',
        category: 'ai_invalid_data',
      });
      return;
    }

    if (isIgnoredItemSource(item)) return;
    const value = aiExtractedValue(item);
    addInvalid({
      field: aiField(item, 'Invalid data'),
      source: SOURCE_DOCUMENTS,
      document: aiDocument(item, aiSection(item) || 'Prompt invalid data'),
      value: displayValue(value),
      rule: aiReason(item, 'Google AI marked this prompt-defined data as invalid.'),
      category: 'ai_invalid_data',
    });
  });

  aiArraysFor(documentData, AI_CROSS_DOCUMENT_MISMATCH_KEYS).forEach((item) => {
    if (!isPlainObject(item)) return;

    const leftDocument = firstNonBlankByKeys(item, ['leftLabel', 'left_label', 'leftDocument', 'left_document', 'documentA', 'document_a', 'sourceDocument']);
    const rightDocument = firstNonBlankByKeys(item, ['rightLabel', 'right_label', 'rightDocument', 'right_document', 'documentB', 'document_b', 'targetDocument']);
    const leftSource = firstNonBlankByKeys(item, ['leftSource', 'left_source', 'leftApiSource', 'left_api_source']);
    const rightSource = firstNonBlankByKeys(item, ['rightSource', 'right_source', 'rightApiSource', 'right_api_source']);
    if (
      isIgnoredSource(leftSource)
      || isIgnoredSource(rightSource)
      || isIgnoredSource(leftDocument)
      || isIgnoredSource(rightDocument)
    ) return;
    const leftValue = firstValueByKeys(item, ['leftValue', 'left_value', 'documentValue', 'document_value', 'valueA', 'value_a']);
    const rightValue = firstValueByKeys(item, ['rightValue', 'right_value', 'otherValue', 'other_value', 'valueB', 'value_b']);

    addMismatch({
      field: aiField(item, 'Document mismatch'),
      document: [leftDocument, rightDocument].filter(Boolean).join(' vs ') || aiDocument(item, 'Document mismatch'),
      documentValue: displayValue(leftValue),
      systemValue: displayValue(rightValue),
      reason: aiReason(item, 'Google AI found inconsistent values across submitted documents.'),
      category: 'ai_cross_document_mismatch',
    });
  });

  aiArraysFor(documentData, AI_DOCUMENT_PRESENCE_KEYS).forEach((item) => {
    if (!isPlainObject(item)) return;
    if (isIgnoredItemSource(item)) return;

    const status = aiStatus(item);
    const present = aiBool(firstValueByKeys(item, ['present', 'isPresent', 'is_present', 'found', 'exists']));
    const required = aiBool(firstValueByKeys(item, ['required', 'isRequired', 'is_required', 'mandatory']));
    if (status === 'notapplicable' || status === 'na' || required === false) return;

    const document = aiDocument(item, 'Required document');
    const reason = aiReason(item, 'Prompt-defined required document is missing or invalid.');

    if (present === false || ['missing', 'notfound', 'absent'].includes(status)) {
      addMissing({
        field: document,
        source: SOURCE_DOCUMENTS,
        document,
        reason,
        category: 'ai_document_presence',
      });
    } else if (['invalid', 'expired', 'faulty', 'failed'].includes(status)) {
      addInvalid({
        field: document,
        source: SOURCE_DOCUMENTS,
        document,
        value: document,
        rule: reason,
        category: 'ai_document_presence',
      });
    }
  });
};

const buildVerificationReport = ({
  mid,
  merchantType,
  merchantChannel,
  requirements = [],
  documentData,
  systemData,
  uploadedDocNames = [],
  apiDocLabels = [],
}) => {
  // Strip AI metadata sections before flattening so they don't appear as doc-only rows.
  // FaultyDocument / DocumentRequirements / Warnings are handled separately below.
  const filteredDocumentData = isPlainObject(documentData)
    ? Object.fromEntries(
        Object.entries(documentData).filter(([key]) => !AI_METADATA_SECTION_KEYS.has(normalizeKey(key)))
      )
    : documentData;

  const documents = normalizeApiDocuments(filteredDocumentData);
  const documentFlatRows = documents.flatMap((document) => (
    flattenObject(document.fields).map((row) => ({ ...row, document: document.documentType }))
  ));
  const effectiveRequirements = mergeDynamicLicenseRequirements(requirements, documentData, systemData);
  // Strip internal/operational WebXPay fields so they don't appear as system-only rows.
  const systemFlatRows = flattenObject(systemData || {}).filter(
    (row) => !SYSTEM_SKIP_CANONICAL.has(row.canonical)
  );

  const missingData = [];
  const invalidData = [];
  const mismatches = [];
  const documentOnlyData = [];
  const systemOnlyData = [];
  const matchedData = [];

  const addMissing = (row) => {
    addUnique(missingData, row, [row.source, row.document, row.field, row.reason]);
  };
  const addInvalid = (row) => {
    addUnique(invalidData, row, [row.source, row.document, row.field, row.value, row.rule]);
  };
  const addMismatch = (row) => {
    addUnique(mismatches, row, [row.field, row.document, row.documentValue, row.systemValue]);
  };
  const addDocumentOnly = (row) => {
    addUnique(documentOnlyData, row, [row.field, row.document, row.value]);
  };
  const addSystemOnly = (row) => {
    addUnique(systemOnlyData, row, [row.field, row.path, row.value]);
  };
  const addMatched = (row) => {
    addUnique(matchedData, row, [row.field, row.document, row.documentValue, row.systemValue]);
  };

  // Licenses are uploaded under the generic "license_if_required" slot(s), so a
  // name match can never connect that label to a specific requirement such as
  // "Applicable Business License (Export of Goods)". Any uploaded license-slot
  // file counts as PRESENT for license-type requirements; whether its CONTENT
  // is the right license is still judged by the AI's FaultyDocument findings.
  const LICENSE_SLOT_RE = /\blicen[cs]e\b/;
  const hasUploadedLicenseSlot = [...apiDocLabels, ...uploadedDocNames]
    .some((label) => LICENSE_SLOT_RE.test(normalizeDocName(stripAiDocumentLabel(String(label || '')))));

  effectiveRequirements.forEach((requirement) => {
    const matchedDocument = findMatchingDocument(requirement, documents, uploadedDocNames);
    const isMandatory = Boolean(requirement.is_mandatory);
    if (hasUploadedLicenseSlot && isRegulatoryLicenseRequirement(requirement.required_docs, requirement.description || '')) return;

    if (isMandatory && !matchedDocument) {
      addMissing({
        field: requirement.required_docs,
        source: SOURCE_DOCUMENTS,
        document: requirement.required_docs,
        reason: `Mandatory document not found in document extraction.${requirement.description ? ` ${sentence(requirement.description)}` : ''}`,
        category: 'required_document',
      });
    }
  });

  const promptCoverageCount = addPromptCoverageComparisons(documentData, systemFlatRows, {
    addMissing,
    addInvalid,
    addMismatch,
    addMatched,
    addDocumentOnly,
  });

  if (!promptCoverageCount) {
    documentFlatRows.forEach((docRow) => {
      if (isBlank(docRow.value)) return;
      // Skip bare generic field names that produce cross-context false matches
      if (COMPARISON_SKIP_FIELDS.has(docRow.field.toLowerCase())) return;

      const systemRow = findFlatValue(systemFlatRows, aliasesForRow(docRow));
      validateValue({
        fieldName: docRow.field,
        fieldLabel: docRow.label,
        fieldType: '',
        value: docRow.value,
        source: SOURCE_DOCUMENTS,
        document: docRow.document,
      }).forEach(addInvalid);

      if (!systemRow) {
        addDocumentOnly({
          field: docRow.label,
          document: docRow.document,
          value: displayValue(docRow.value),
          reason: 'Captured by Google AI from documents but not found in the external system API.',
        });
        return;
      }

      if (valuesEqual(docRow.value, systemRow.value, `${docRow.field} ${systemRow.field}`)) {
        addMatched({
          field: docRow.label,
          document: docRow.document,
          documentValue: displayValue(docRow.value),
          systemValue: displayValue(systemRow.value),
          nearMatch: false,
        });
      } else if (valuesNearMatch(docRow.value, systemRow.value)) {
        addMatched({
          field: docRow.label,
          document: docRow.document,
          documentValue: displayValue(docRow.value),
          systemValue: displayValue(systemRow.value),
          nearMatch: true,
        });
      } else {
        addMismatch({
          field: docRow.label,
          document: docRow.document,
          documentValue: displayValue(docRow.value),
          systemValue: displayValue(systemRow.value),
          reason: 'Google AI document value does not match the external system API value.',
          category: 'cross_check',
        });
      }
    });

    systemFlatRows.forEach((systemRow) => {
      if (isBlank(systemRow.value)) return;
      const documentRow = findFlatValue(documentFlatRows, aliasesForRow(systemRow));
      if (!documentRow) {
        addSystemOnly({
          field: systemRow.label,
          document: sourceLabelForRow(systemRow),
          path: systemRow.path,
          value: displayValue(systemRow.value),
          reason: 'Present in the external system API but not captured from documents.',
        });
      }

      validateValue({
        fieldName: systemRow.field,
        fieldLabel: systemRow.label,
        fieldType: '',
        value: systemRow.value,
        source: SOURCE_SYSTEM,
      document: 'System record',
      }).forEach(addInvalid);
    });
  }

  addAiPromptFindings(documentData, { addMissing, addInvalid, addMismatch }, {
    includeCoverage: !promptCoverageCount,
    includeMissingFields: !promptCoverageCount,
  });

  addAoABoardCrossChecks(documentData, { addMismatch, addMatched });

  if (Array.isArray(documentData?.FaultyDocument)) {
    documentData.FaultyDocument.forEach((fault) => {
      const documentName = fault['Document Name'] || fault.document_name || fault.name || 'Faulty document';
      const reason = fault.Reason || fault.reason || fault.issue || 'Document failed Google AI validation.';
      // Skip "NIC mismatch" faults that are only an old (9-digit + V/X) vs new
      // (12-digit) Sri Lankan NIC format difference — the same person, not a fault.
      if (/\bnic\b/i.test(reason) && isPureIdentityFormatMismatch(reason)) return;
      if (isBankCustomerAddressIssue({ document: documentName, field: documentName, reason, rule: reason })) return;
      if (isAcceptedBankDocumentLabelSwap(reason)) return;
      addInvalid({
        field: documentName,
        source: SOURCE_DOCUMENTS,
        document: documentName,
        value: fault.document_id || fault.id || documentName,
        rule: reason,
        category: 'ai_faulty_document',
      });
    });
  }

  const aiRequiredDocs = documentData?.DocumentRequirements?.required_documents;
  if (Array.isArray(aiRequiredDocs)) {
    // Collect names of documents already present or invalid per DocumentPresence —
    // these have their own row and must not also appear as Missing.
    const presentOrInvalidDocNames = aiArraysFor(documentData, AI_DOCUMENT_PRESENCE_KEYS)
      .filter((dp) => isPlainObject(dp) && !['missing', 'absent', 'notfound'].includes(aiStatus(dp)))
      .map((dp) => aiDocument(dp, ''))
      .filter(Boolean);

    aiRequiredDocs.forEach((requiredDoc) => {
      const documentName = typeof requiredDoc === 'string'
        ? requiredDoc
        : (requiredDoc.document_name || requiredDoc['Document Name'] || requiredDoc.name || 'Required document');
      const remarks = documentData?.DocumentRequirements?.remarks;
      const remark = isPlainObject(remarks)
        ? (remarks[documentName] || remarks[String(requiredDoc.document_id)] || remarks[String(requiredDoc.id)])
        : null;

      if (!shouldKeepAiRequiredDocument({
        documentName,
        reason: remark || '',
        requirements: effectiveRequirements,
        systemData,
        documentData,
      })) return;

      // Skip if a matching document is already present/invalid — it has its own row.
      if (presentOrInvalidDocNames.some((name) => namesMatch(name, documentName))) return;

      addMissing({
        field: documentName,
        source: SOURCE_DOCUMENTS,
        document: documentName,
        reason: remark || 'Google AI identified this document as required or missing.',
        category: 'ai_required_document',
      });
    });
  }

  // AI-flagged missing/invalid items for non-mandatory documents must not produce a fail row.
  // Only keep them if: (a) the DB has no matching requirement (AI may know something we don't),
  // OR (b) the matching DB requirement is mandatory.
  const isNonMandatoryAiDoc = (row) => {
    if (row.category !== 'ai_required_document'
      && row.category !== 'ai_document_presence') return false;
    const docName = String(row.field || row.document || '');
    if (isRegulatoryLicenseRequirement(docName, row.reason || '') && hasRegulatedOperationalNature(systemData, documentData)) {
      return false;
    }
    const matchedReq = effectiveRequirements.find((req) => namesMatch(req.required_docs, docName));
    return Boolean(matchedReq) && !matchedReq.is_mandatory;
  };

  const policyFilteredMismatches = mismatches.filter(
    (row) => !shouldSuppressAiCrossDocumentMismatch(row, systemData, documentData)
      && !isBankCustomerAddressIssue(row)
  );

  // Fields already seen in matched/mismatch/invalid rows don't need a separate Missing entry.
  // This suppresses prompt_field_comparison noise for fields like Country, City, Business Email
  // that are "not found in BRC" but ARE matched from another document (e.g. Duly Filled Agreement).
  const foundFieldKeys = new Set(
    [
      ...matchedData.map((r) => normalizeKey(r.field || '')),
      ...policyFilteredMismatches.map((r) => normalizeKey(r.field || '')),
      ...invalidData.map((r) => normalizeKey(r.field || '')),
    ].filter(Boolean),
  );

  const cleanMissing = stripKeys(missingData).filter((row) => {
    if (isNonMandatoryAiDoc(row)) return false;
    if (isBankCustomerAddressIssue(row)) return false;
    if (isBrcOwnerNicMissingIssue(row)) return false;
    if (
      row.category === 'prompt_field_comparison'
      && String(row.documentValue || '').toLowerCase() === '(not found)'
      && foundFieldKeys.has(normalizeKey(row.field || ''))
    ) return false;
    if (row.category !== 'ai_required_document' && row.category !== 'ai_document_presence') return true;
    return !isNonMandatoryAiDoc(row);
  });
  // Fields already covered by a CrossDocumentMismatch row don't need a separate invalid entry —
  // the mismatch already surfaces the inconsistency and adding an invalid row for the same field
  // creates confusing duplicate rows (e.g. "Nature of Business" appearing as both Mismatch and Invalid).
  const crossDocMismatchFieldKeys = new Set(
    policyFilteredMismatches
      .filter((r) => r.category === 'ai_cross_document_mismatch')
      .map((r) => normalizeKey(r.field || ''))
  );

  const cleanInvalid = stripKeys(invalidData).filter((row) => {
    if (isNonMandatoryAiDoc(row)) return false;
    if (isBankCustomerAddressIssue(row)) return false;
    if (isAoAAttestationDateIssue(row)) return false;
    if (isBankStatementRecencyIssue(row)) return false;
    if (isIdentityTypeOnlyMismatch(row)) return false;
    if (isFalseFutureDateIssue(row)) return false;
    // Document-level AI findings (whole-document flags: label mismatches, duplicates,
    // attestation issues) are too unreliable to be blocking. Field-level invalids
    // (ai_invalid_data, ai_prompt_field) are kept.
    if (row.category === 'ai_faulty_document') return false;
    // Suppress prompt-field invalids when the same field already has a cross-document mismatch row
    if (row.category === 'ai_prompt_field' && crossDocMismatchFieldKeys.has(normalizeKey(row.field || ''))) return false;
    return true;
  });
  const cleanMismatches = stripKeys(policyFilteredMismatches);
  const cleanDocumentOnly = stripKeys(documentOnlyData).filter((row) => !shouldSuppressDocumentOnlyRow(row));
  const cleanSystemOnly = stripKeys(systemOnlyData);
  const cleanMatched = stripKeys(matchedData);

  const isAiPromptIssue = (row) => String(row.category || '').startsWith('ai_');
  const aiPromptIssueCount = [
    ...cleanMissing,
    ...cleanInvalid,
    ...cleanMismatches,
  ].filter(isAiPromptIssue).length;
  // NOTE: status, blockingCount and ruleChecks are computed AFTER documentChecks
  // (further down) because the verdict depends on mandatory-document validity.

  // ── Unified table ─────────────────────────────────────────────────────────
  // Single flat list that merges all categories so the frontend can render
  // one table with Field | Document | AI Value | API Value | Status | Comment.

  const unifiedRows = [];

  const matchedComment = (row) => {
    if (row.matchReason) return row.matchReason;
    if (row.nearMatch) {
      return 'Needs review: values are similar but not identical. Confirm the value is valid before approval.';
    }
    return 'Valid: value is present in both sources, matches the external system API, and no validity rule reported an issue.';
  };

  const mismatchComment = (row) => {
    const reason = row.reason || 'Values differ between document analysis and external system.';
    return `Needs review: ${reason} Validity cannot be confirmed until the mismatch is resolved.`;
  };

  const missingComment = (row) => {
    const reason = row.reason || 'Required value is absent.';
    return `Invalid or incomplete: ${reason}`;
  };

  const invalidComment = (row) => {
    const rule = row.rule || 'Value failed validation.';
    return `Invalid: ${rule}`;
  };

  const documentOnlyComment = () => (
    'Needs review: captured from documents, but no matching external system API value exists to confirm validity.'
  );

  const systemOnlyComment = () => (
    'Needs review: present in the external system API, but not captured from documents, so document validity is not confirmed.'
  );

  cleanMatched.forEach((row) => unifiedRows.push({
    field:     row.field,
    document:  row.document || '—',
    aiValue:   row.documentValue || '—',
    apiValue:  row.systemValue   || '—',
    status:    'matched',
    nearMatch: row.nearMatch || false,
    comment:   matchedComment(row),
  }));

  cleanMismatches.forEach((row) => unifiedRows.push({
    field:    row.field,
    document: row.document || '—',
    aiValue:  row.documentValue || '—',
    apiValue: row.systemValue   || '—',
    status:   'mismatch',
    comment:  mismatchComment(row),
  }));

  cleanMissing
    .filter((row) => !(
      row.category === 'prompt_field_comparison'
      && row.documentValue === '(not found)'
      && row.systemValue === '(not found)'
    ))
    .forEach((row) => unifiedRows.push({
      field:    row.field,
      document: row.document || '—',
      aiValue:  row.documentValue || (row.source === SOURCE_DOCUMENTS ? '(not found)' : '—'),
      apiValue: row.systemValue || (row.source === SOURCE_SYSTEM ? '(not found)' : '—'),
      status:   'missing',
      comment:  missingComment(row),
    }));

  cleanInvalid
    .filter((row) => {
      const val = String(row.value || '').trim();
      // Drop entries where value is a bare small integer — internal system IDs, not document data
      if (/^\d{1,3}$/.test(val)) return false;
      // Drop document-presence invalids (field === document) that duplicate FaultyDocument entries
      if (row.category === 'ai_document_presence' && normalizeKey(row.field) === normalizeKey(row.document)) return false;
      return true;
    })
    .forEach((row) => unifiedRows.push({
      field:    row.field,
      document: row.document || row.source || '—',
      aiValue:  row.source === SOURCE_DOCUMENTS ? (row.value || '—') : '—',
      apiValue: row.source === SOURCE_SYSTEM    ? (row.value || '—') : '—',
      status:   'invalid',
      comment:  invalidComment(row),
    }));

  cleanDocumentOnly
    .filter((row) => {
      const val = String(row.value || '').trim().toLowerCase();
      // Drop AI document-quality boolean flags — not actual field data
      if (val === 'false' || val === 'true') return false;
      return true;
    })
    .forEach((row) => unifiedRows.push({
      field:    row.field,
      document: row.document || '—',
      aiValue:  row.value  || '—',
      apiValue: '—',
      status:   'doc_only',
      comment:  documentOnlyComment(row),
    }));

  cleanSystemOnly.forEach((row) => unifiedRows.push({
    field:    row.field,
    document: row.document || row.path || '—',
    aiValue:  '—',
    apiValue: row.value  || '—',
    status:   'api_only',
    comment:  systemOnlyComment(row),
  }));

  // Deduplicate: same field+document pair kept at highest priority status
  const STATUS_PRIORITY = { invalid: 0, missing: 1, mismatch: 2, matched: 3, doc_only: 4, api_only: 5 };
  const bestRowByKey = new Map();
  unifiedRows.forEach((row) => {
    const key = `${normalizeKey(row.field)}|${normalizeKey(row.document)}`;
    const existing = bestRowByKey.get(key);
    if (!existing || (STATUS_PRIORITY[row.status] ?? 99) < (STATUS_PRIORITY[existing.status] ?? 99)) {
      bestRowByKey.set(key, row);
    }
  });
  const seenDedupKeys = new Set();
  const dedupedRows = unifiedRows.filter((row) => {
    const key = `${normalizeKey(row.field)}|${normalizeKey(row.document)}`;
    if (bestRowByKey.get(key) !== row) return false;
    if (seenDedupKeys.has(key)) return false;
    seenDedupKeys.add(key);
    return true;
  });

  // ── Document validity checks ──────────────────────────────────────────────
  // One row per DB requirement: present? valid? any AI-flagged issues?

  // Strip "LABEL: " prefix and " | API_SOURCE: ..." suffix that the AI adds to document names.
  const stripDocLabel = (name) => String(name || '')
    .replace(/^LABEL:\s*/i, '')
    .replace(/\s*\|\s*API_SOURCE:\s*.*/i, '')
    .replace(/_/g, ' ')
    .trim();

  // FaultyDocument → normalised doc name → [reason strings]
  const faultsByDoc = new Map();
  if (Array.isArray(documentData?.FaultyDocument)) {
    documentData.FaultyDocument.forEach((fault) => {
      const documentName = stripDocLabel(fault['Document Name'] || fault.document_name || fault.name || '');
      const reason = fault.Reason || fault.reason || fault.issue || '';
      if (isAoAAttestationDateIssue({ document: documentName, field: documentName, reason })) return;
      if (isBankStatementRecencyIssue({ document: documentName, field: documentName, reason, rule: reason })) return;
      if (isFalseFutureDateIssue({ document: documentName, field: documentName, reason })) return;
      // Duplicate / out-of-scope uploads are not validity failures — a valid copy
      // already satisfies the requirement, so they must not invalidate or block it.
      if (isNonBlockingDocumentFault(reason)) return;
      // "Expected ID Copy, found Passport" — any identity document satisfies the
      // ID slot; an identity-to-identity label difference is not a fault.
      if (isIdentityLabelContentSwap(reason)) return;
      if (isBankCustomerAddressIssue({ document: documentName, field: documentName, reason, rule: reason })) return;
      if (isAcceptedBankDocumentLabelSwap(reason)) return;

      const key = normalizeDocName(documentName);
      if (!key) return;
      if (!faultsByDoc.has(key)) faultsByDoc.set(key, []);
      if (reason) faultsByDoc.get(key).push(reason);
    });
  }

  // PromptFieldCoverage invalid/expired items → normalised doc name → [{field, reason}]
  const invalidFieldsByDoc = new Map();
  promptCoverageItems(documentData).forEach((item) => {
    const st = aiStatus(item);
    if (!['invalid', 'expired', 'faulty', 'failed'].includes(st)) return;
    const key = normalizeDocName(stripDocLabel(aiDocument(item, '')));
    if (!key) return;
    const invalidField = {
      field: aiField(item) || 'Unknown field',
      reason: aiReason(item, 'Field failed validation.'),
      value: aiExtractedValue(item),
    };
    if (isAoAAttestationDateIssue({ document: key, ...invalidField })) return;
    if (isBankCustomerAddressIssue({
      document: aiDocument(item, key),
      section: aiSection(item),
      ...invalidField,
      rule: invalidField.reason,
    })) return;
    if (isBankStatementRecencyIssue({
      document: aiDocument(item, key),
      section: aiSection(item),
      ...invalidField,
      rule: invalidField.reason,
    })) return;
    if (isFalseFutureDateIssue({ document: key, ...invalidField })) return;
    if (!invalidFieldsByDoc.has(key)) invalidFieldsByDoc.set(key, []);
    invalidFieldsByDoc.get(key).push(invalidField);
  });

  const docIssues = (reqName) => {
    const reqKey = normalizeDocName(stripDocLabel(reqName));
    const faults = [];
    const invalidFields = [];
    faultsByDoc.forEach((reasons, key) => { if (namesMatch(key, reqKey)) faults.push(...reasons); });
    invalidFieldsByDoc.forEach((fields, key) => { if (namesMatch(key, reqKey)) invalidFields.push(...fields); });
    return { faults, invalidFields };
  };

  // Documents the AI itself confirmed present or extracted fields from. Their
  // "source" names (e.g. "Nature of Business Letter") often match a requirement
  // better than the raw upload label (e.g. "upload_nat_business_doc"), so a
  // present document is never falsely reported missing over a label mismatch.
  const aiPresentDocNames = [
    ...aiArraysFor(documentData, AI_DOCUMENT_PRESENCE_KEYS)
      .filter((dp) => isPlainObject(dp)
        && !isIgnoredItemSource(dp)
        && (aiBool(firstValueByKeys(dp, ['present', 'isPresent', 'is_present', 'found', 'exists'])) === true
          || aiStatus(dp) === 'present'))
      .map((dp) => stripDocLabel(aiDocument(dp, ''))),
    ...promptCoverageItems(documentData).flatMap((item) => [
      stripDocLabel(aiSource(item, '')),
      stripDocLabel(aiDocument(item, '')),
    ]),
  ].filter((label) => label && !isIgnoredSource(label));

  // Sole-proprietor rule (onboarding matrix §4.3): a proprietor may operate
  // without a BRC — the owner's NIC then serves as the business registration
  // number. When the system record confirms this (registration number equals a
  // stakeholder NIC), a missing BRC is waived instead of blocking onboarding.
  const isProprietorType = /proprietor/i.test(merchantType?.name || '');
  const systemRegTokens = extractIdentityTokens(systemData?.business_information?.business_registration_number || '');
  const stakeholderIdTokens = (systemData?.stakeholders || []).flatMap((s) => extractIdentityTokens(s?.id));
  const brcWaivedByNicRegistration = isProprietorType
    && systemRegTokens.length > 0
    && systemRegTokens.some((token) => stakeholderIdTokens.includes(token));

  const documentChecks = effectiveRequirements.map((req) => {
    const name = req.required_docs;
    const reqKey = normalizeDocName(stripDocLabel(name));

    const isLicenseRequirement = isRegulatoryLicenseRequirement(name, req.description || '');

    const present = apiDocLabels.some((label) => namesMatch(normalizeDocName(stripDocLabel(label)), reqKey))
      || uploadedDocNames.some((label) => namesMatch(normalizeDocName(label), reqKey))
      || aiPresentDocNames.some((label) => namesMatch(normalizeDocName(label), reqKey))
      // Licenses live in the generic "license_if_required" slot — its label can
      // never name-match a specific license requirement.
      || (isLicenseRequirement && hasUploadedLicenseSlot);

    const waived = !present
      && brcWaivedByNicRegistration
      && reqKey.includes('business registration certificate');

    const { faults, invalidFields } = docIssues(name);
    // A license requirement satisfied via the generic slot inherits any AI
    // faults raised against that slot (e.g. "content does not match label"),
    // so a mislabeled upload shows as uploaded-but-invalid, not missing.
    if (isLicenseRequirement && hasUploadedLicenseSlot) {
      faultsByDoc.forEach((reasons, key) => {
        if (LICENSE_SLOT_RE.test(key)) faults.push(...reasons);
      });
    }

    const linkedInvalids = cleanInvalid
      .filter((r) => r.category === 'ai_prompt_field'
        && namesMatch(normalizeDocName(stripDocLabel(r.document || '')), reqKey))
      .map((r) => ({ field: r.field, reason: r.rule || '' }));

    const allIssues = [
      ...faults.map((r) => ({ type: 'document', field: null, reason: r })),
      ...invalidFields.map((f) => ({ type: 'field', field: f.field, reason: f.reason })),
      ...linkedInvalids.map((f) => ({ type: 'field', field: f.field, reason: f.reason })),
    ];
    const seenIssues = new Set();
    const uniqueIssues = allIssues.filter((issue) => {
      const k = `${issue.type}|${issue.field || ''}|${issue.reason}`;
      if (seenIssues.has(k)) return false;
      seenIssues.add(k);
      if (isBankStatementRecencyIssue({
        document: name,
        section: req.description || '',
        field: issue.field || name,
        reason: issue.reason || '',
        rule: issue.reason || '',
      })) return false;
      if (isBankCustomerAddressIssue({
        document: name,
        section: req.description || '',
        field: issue.field || name,
        reason: issue.reason || '',
        rule: issue.reason || '',
      })) return false;
      // Suppress false future-date flags: if the issue says "future" but the date
      // is actually in the past under any reasonable format interpretation, drop it.
      if (/\bfuture\b/i.test(issue.reason)) {
        const dm = issue.reason.match(/\d{4}-\d{2}-\d{2}|\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{2,4}/);
        if (dm && !isDateActuallyFuture(dm[0])) return false;
      }
      return true;
    });

    return {
      name,
      description: req.description || null,
      isMandatory: Boolean(req.is_mandatory),
      present,
      waived,
      valid: !present ? false : uniqueIssues.length === 0,
      issues: waived
        ? [{ type: 'document', field: null, reason: "Waived: no BRC on file — the owner's NIC serves as the business registration number (sole-proprietor rule)." }, ...uniqueIssues]
        : uniqueIssues,
      licenseSourceDocs: req.licenseSourceDocs || null,
    };
  });

  // ── Verdict ────────────────────────────────────────────────────────────────
  // Severity policy (see classifyOnboardingSeverity): only mandatory-document
  // gaps and bank/identity issues block; everything else is a minor "caution".
  const {
    status, blockingCount, blockingReasons, decision: onboardingDecision,
  } = buildOnboardingDecision({
    missingData: cleanMissing,
    invalidData: cleanInvalid,
    mismatches: cleanMismatches,
    documentOnlyData: cleanDocumentOnly,
    systemOnlyData: cleanSystemOnly,
    documentChecks,
  });
  const minorIssueCount = cleanMissing.length + cleanInvalid.length + cleanMismatches.length
    + cleanDocumentOnly.length + cleanSystemOnly.length;
  const ruleChecks = [
    {
      name: 'Onboarding eligibility',
      status: blockingCount === 0 ? 'pass' : 'fail',
      detail: blockingCount > 0
        ? `Cannot onboard: ${blockingReasons.join('; ')} must be resolved before approval.`
        : (minorIssueCount > 0
            ? `Eligible for onboarding. ${minorIssueCount} minor, non-blocking issue(s) were noted for reference but do not block approval.`
            : 'No issues detected. This merchant is eligible for onboarding.'),
      isVerdict: true,
    },
    {
      name: 'Required data coverage',
      status: cleanMissing.length ? 'fail' : 'pass',
      detail: cleanMissing.length
        ? `${cleanMissing.length} required item(s) are missing from one or more API sources.`
        : 'All prompt-reported required data and configured documents are present.',
    },
    {
      name: 'Google AI document extraction vs external system cross-check',
      status: cleanMismatches.length ? 'fail' : 'pass',
      detail: cleanMismatches.length
        ? `${cleanMismatches.length} field(s) do not match between sources.`
        : 'Compared fields match across both sources.',
    },
    {
      name: 'Format and validity rules',
      status: cleanInvalid.length ? 'fail' : 'pass',
      detail: cleanInvalid.length
        ? `${cleanInvalid.length} field(s) failed format, expiry, or validity checks.`
        : 'No invalid formats or expired values were detected.',
    },
    {
      name: 'Prompt merchant-type rules',
      status: aiPromptIssueCount ? 'fail' : 'pass',
      detail: aiPromptIssueCount
        ? `${aiPromptIssueCount} prompt-driven document or field rule issue(s) were reported by Google AI.`
        : 'No prompt-driven merchant-type rule issues were reported by Google AI.',
    },
    {
      name: 'Source capture coverage',
      status: cleanDocumentOnly.length || cleanSystemOnly.length ? 'warning' : 'pass',
      detail: cleanDocumentOnly.length || cleanSystemOnly.length
        ? `${cleanDocumentOnly.length} document-only and ${cleanSystemOnly.length} system-only field(s) need review.`
        : 'Both API sources expose the same compared fields.',
    },
  ];

  return {
    mid: mid || null,
    merchantChannel: merchantChannel || null,
    merchantType: merchantType || null,
    generatedAt: new Date().toISOString(),
    status,
    statusLabel: statusLabelFor(status),
    blockingCount,
    minorIssueCount,
    onboardingDecision,
    summary: {
      receivedDocuments: apiDocLabels.length || documents.length,
      configuredRequirements: effectiveRequirements.length,
      matchedFields: cleanMatched.length,
      missingData: cleanMissing.length,
      invalidData: cleanInvalid.length,
      mismatches: cleanMismatches.length,
      documentOnlyData: cleanDocumentOnly.length,
      systemOnlyData: cleanSystemOnly.length,
    },
    documents: apiDocLabels.length > 0
      ? apiDocLabels.map((label) => ({ documentType: label }))
      : documents.map((document) => ({
          documentType: document.documentType,
          fieldCount: flattenObject(document.fields).filter((row) => !isBlank(row.value)).length,
        })),
    unifiedRows: dedupedRows,
    missingData: cleanMissing,
    invalidData: cleanInvalid,
    mismatches: cleanMismatches,
    documentOnlyData: cleanDocumentOnly,
    systemOnlyData: cleanSystemOnly,
    matchedData: cleanMatched,
    ruleChecks,
    documentChecks,
  };
};

// Move AI-confirmed compatible mismatches from mismatches → matchedData (nearMatch=true)
// and recalculate status, summary, and rule checks in the report.
const patchReportCompatibleMismatches = (report, compatibleFields) => {
  if (!compatibleFields || !compatibleFields.size) return report;

  const normalizedCompatible = new Set([...compatibleFields].map((f) => normalizeKey(f)));

  const keptMismatches = [];
  const movedToMatched = [];
  (report.mismatches || []).forEach((m) => {
    if (normalizedCompatible.has(normalizeKey(m.field || ''))) {
      movedToMatched.push(m);
    } else {
      keptMismatches.push(m);
    }
  });

  if (!movedToMatched.length) return report;

  const newMatchedData = [
    ...(report.matchedData || []),
    ...movedToMatched.map((m) => ({
      field: m.field,
      document: m.document || '—',
      documentValue: m.documentValue || '—',
      systemValue: m.systemValue || '—',
      nearMatch: true,
    })),
  ];

  const newUnifiedRows = [
    ...(report.unifiedRows || []).filter(
      (r) => !(r.status === 'mismatch' && normalizedCompatible.has(normalizeKey(r.field || '')))
    ),
    ...movedToMatched.map((m) => ({
      field: m.field,
      document: m.document || '—',
      aiValue: m.documentValue || '—',
      apiValue: m.systemValue || '—',
      status: 'matched',
      nearMatch: true,
      comment: 'Needs review: values are semantically compatible but described differently across documents. Confirm before approving.',
    })),
  ];

  // Re-run the severity policy on the patched arrays so the verdict stays
  // consistent with buildVerificationReport (mandatory docs + bank/identity block;
  // everything else is a minor "caution").
  const {
    status: newStatus, blockingCount, blockingReasons, decision: newOnboardingDecision,
  } = buildOnboardingDecision({
    missingData: report.missingData || [],
    invalidData: report.invalidData || [],
    mismatches: keptMismatches,
    documentOnlyData: report.documentOnlyData || [],
    systemOnlyData: report.systemOnlyData || [],
    documentChecks: report.documentChecks || [],
  });

  const aiPromptIssueCount = [
    ...(report.missingData || []),
    ...(report.invalidData || []),
    ...keptMismatches,
  ].filter((r) => String(r.category || '').startsWith('ai_')).length;

  const newRuleChecks = (report.ruleChecks || []).map((check) => {
    if (check.isVerdict) {
      return {
        ...check,
        status: blockingCount === 0 ? 'pass' : 'fail',
        detail: blockingCount > 0
          ? `Cannot onboard: ${blockingReasons.join('; ')} must be resolved before approval.`
          : 'Eligible for onboarding. Any remaining issues are minor and non-blocking.',
      };
    }
    if (check.name === 'Google AI document extraction vs external system cross-check') {
      return {
        ...check,
        status: keptMismatches.length ? 'fail' : 'pass',
        detail: keptMismatches.length
          ? `${keptMismatches.length} field(s) do not match between sources.`
          : 'Compared fields match across both sources.',
      };
    }
    if (check.name === 'Prompt merchant-type rules') {
      return {
        ...check,
        status: aiPromptIssueCount ? 'fail' : 'pass',
        detail: aiPromptIssueCount
          ? `${aiPromptIssueCount} prompt-driven document or field rule issue(s) were reported by Google AI.`
          : 'No prompt-driven merchant-type rule issues were reported by Google AI.',
      };
    }
    return check;
  });

  return {
    ...report,
    status: newStatus,
    statusLabel: statusLabelFor(newStatus),
    blockingCount,
    onboardingDecision: newOnboardingDecision,
    summary: {
      ...(report.summary || {}),
      matchedFields: newMatchedData.length,
      mismatches: keptMismatches.length,
    },
    mismatches: keptMismatches,
    matchedData: newMatchedData,
    unifiedRows: newUnifiedRows,
    ruleChecks: newRuleChecks,
  };
};

module.exports = {
  buildVerificationReport,
  patchReportCompatibleMismatches,
  // exported for license-rule regression testing
  requiredOperationalLicenseDetails,
};
