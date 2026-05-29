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
  'streetaddressbusiness', 'cityidbusiness', 'zipcodebusiness',
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
  .replace(/\bbrc\b/g, 'business registration certificate')
  .replace(/\bnic\b/g, 'national identity card')
  .replace(/\bdl\b/g, 'driving licence')
  .replace(/\bdriver'?s?\s+license\b/g, 'driving licence')
  .replace(/\bdriving\s+license\b/g, 'driving licence')
  .replace(/\bid\s*copy\b/g, 'identity document')
  .replace(/\bid\s*copies\b/g, 'identity document')
  .replace(/\bnational\s+identity\s+card\b/g, 'identity document')
  .replace(/\bpassport\b/g, 'identity document')
  .replace(/\bdriving\s+licence\b/g, 'identity document')
  .replace(/\baoa\b/g, 'articles of association')
  .replace(/\bboa\b/g, 'board resolution')
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

const isBlank = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
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
    'copy',
    'certified',
    'valid',
    'latest',
    'document',
    'documents',
    'proof',
    'letter',
    'form',
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

const stripTrailingIndex = (value = '') => String(value).replace(/\d+$/, '');

const sourceLabelForRow = (row) => {
  const firstPathSegment = String(row?.path || '').split('.')[0];
  return firstPathSegment ? humanizeKey(firstPathSegment) : (row?.document || 'System record');
};

const parseDateValue = (value) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const slash = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slash) {
    const date = new Date(Number(slash[3]), Number(slash[2]) - 1, Number(slash[1]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizeComparable = (value) => {
  const date = parseDateValue(value);
  if (date) return date.toISOString().slice(0, 10);

  return String(value)
    .toLowerCase()
    .trim()
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

  const key = normalizeKey(context);
  if (key.includes('address')) return addressesEqual(left, right);

  return false;
};

const valuesNearMatch = (left, right) => {
  if (isBlank(left) || isBlank(right)) return false;
  const leftNorm = normalizeComparable(left);
  const rightNorm = normalizeComparable(right);
  if (leftNorm.includes(rightNorm) || rightNorm.includes(leftNorm)) return true;
  return tokenSimilarity(left, right) >= 0.70;
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

  if (key.includes('nic') || key.includes('nationalidentity')) {
    if (!/^(\d{9}[vxVX]|\d{12})$/.test(text.replace(/\s/g, ''))) {
      add('Sri Lankan NIC must be 9 digits plus V/X or 12 digits.');
    }
  }

  if (fieldType === 'date' || key.includes('date') || key.includes('expiry') || key.includes('expire')) {
    const date = parseDateValue(value);
    if (!date) {
      add('Must be a valid date.');
    } else if (key.includes('expiry') || key.includes('expire') || key.includes('validuntil')) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (date < today) add('Document or license date is expired.');
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

const addPromptCoverageComparisons = (documentData, systemFlatRows, {
  addMissing,
  addInvalid,
  addMismatch,
  addMatched,
  addDocumentOnly,
}) => {
  const coverage = promptCoverageItems(documentData);

  coverage.forEach((item) => {
    const field = aiField(item);
    const documentName = aiDocument(item, aiSection(item) || 'Prompt field coverage');
    const apiSource = aiSource(item, '');
    const section = aiSection(item);
    if (AI_METADATA_SECTION_KEYS.has(normalizeKey(section || ''))) return;
    const status = aiStatus(item);
    const present = aiBool(firstValueByKeys(item, ['present', 'isPresent', 'is_present', 'found', 'exists']));
    const required = aiBool(firstValueByKeys(item, ['required', 'isRequired', 'is_required', 'mandatory']));
    const docValue = aiExtractedValue(item);
    const reason = aiReason(item, 'Prompt-defined field is missing or invalid in the document extraction.');
    const systemRow = findFlatValue(systemFlatRows, comparisonAliasesFor(field, section, documentName, apiSource));
    const systemValue = systemRow?.value;
    const docMissing = (
      present === false
      || ['missing', 'notfound', 'absent', 'empty', 'unreadable'].includes(status)
      || (present !== true && status !== 'present' && isBlank(docValue))
    );
    const systemMissing = !systemRow || isBlank(systemValue);

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

  requirements.forEach((requirement) => {
    const matchedDocument = findMatchingDocument(requirement, documents, uploadedDocNames);
    const isMandatory = Boolean(requirement.is_mandatory);

    if (isMandatory && !matchedDocument) {
      addMissing({
        field: requirement.required_docs,
        source: SOURCE_DOCUMENTS,
        document: requirement.required_docs,
        reason: `Mandatory document not found in document extraction.${requirement.description ? ` ${requirement.description}.` : ''}`,
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

  if (Array.isArray(documentData?.FaultyDocument)) {
    documentData.FaultyDocument.forEach((fault) => {
      const documentName = fault['Document Name'] || fault.document_name || fault.name || 'Faulty document';
      const reason = fault.Reason || fault.reason || fault.issue || 'Document failed Google AI validation.';
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

  const cleanMissing = stripKeys(missingData);
  const cleanInvalid = stripKeys(invalidData);
  const cleanMismatches = stripKeys(mismatches);
  const cleanDocumentOnly = stripKeys(documentOnlyData);
  const cleanSystemOnly = stripKeys(systemOnlyData);
  const cleanMatched = stripKeys(matchedData);

  const criticalCount = cleanMissing.length + cleanInvalid.length + cleanMismatches.length;
  const status = criticalCount > 0
    ? 'review_required'
    : (cleanDocumentOnly.length + cleanSystemOnly.length > 0 ? 'source_gap_review' : 'verified');
  const isAiPromptIssue = (row) => String(row.category || '').startsWith('ai_');
  const aiPromptIssueCount = [
    ...cleanMissing,
    ...cleanInvalid,
    ...cleanMismatches,
  ].filter(isAiPromptIssue).length;

  const ruleChecks = [
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

  // ── Unified table ─────────────────────────────────────────────────────────
  // Single flat list that merges all categories so the frontend can render
  // one table with Field | Document | AI Value | API Value | Status | Comment.

  const unifiedRows = [];

  const matchedComment = (row) => {
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

  return {
    mid: mid || null,
    merchantChannel: merchantChannel || null,
    merchantType: merchantType || null,
    generatedAt: new Date().toISOString(),
    status,
    statusLabel: status === 'verified'
      ? 'Verified'
      : (status === 'source_gap_review' ? 'Source gap review' : 'Review required'),
    summary: {
      receivedDocuments: apiDocLabels.length || documents.length,
      configuredRequirements: requirements.length,
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
  };
};

module.exports = {
  buildVerificationReport,
};
