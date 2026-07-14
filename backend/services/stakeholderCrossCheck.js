// Cross-business stakeholder detection.
//
// Goal: flag when the SAME person (director / owner / partner) is registered
// under more than one business (MID), and report which businesses.
//
// Constraint: NO database changes. We only READ existing tables. The richest,
// most reliable source of a person's identity (NIC / passport number, name,
// date of birth) is the AI extraction already stored in
// `merchant_document_json_data.extracted_json` — specifically the
// `OwnerInformation[]` and `Directors[]` sections. Reading that column is
// read-only, needs no live WebXPay calls, and is fast.
//
// The index is cached in memory with a short TTL so repeat calls are instant.

const db = require('../config/db');

const INDEX_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Module-level cache. Rebuilt on demand (TTL expiry or forceRefresh).
let cache = { builtAt: 0, building: null, index: null, merchantCount: 0 };

// ---------------------------------------------------------------------------
// Identity normalization
// ---------------------------------------------------------------------------

// Sri Lankan NIC: old format is 9 digits + V/X (e.g. 640453060V); new format is
// 12 digits (e.g. 196404503060). They map 1:1 — convert old → new so the same
// person is matched regardless of which format a document used.
//   old YY DDD SSS C  ->  new 19YY DDD 0SSS C
const oldNicToNew = (d9) => `19${d9.slice(0, 5)}0${d9.slice(5)}`;

const normalizeNic = (value) => {
  const s = String(value || '').toUpperCase().replace(/[^0-9VX]/g, '');
  // 12-digit NIC that picked up a trailing V/X from OCR/legacy entry.
  if (s.length === 13 && /^\d{12}[VX]$/.test(s)) return s.slice(0, 12);
  // AI hybrid: century prefix glued onto the OLD format ("19" + 9 digits + V,
  // e.g. 19740240013V) — neither valid format; canonicalise like an old NIC.
  const hybrid = s.match(/^(19|20)(\d{9})[VX]$/);
  if (hybrid) return `${hybrid[1]}${hybrid[2].slice(0, 5)}0${hybrid[2].slice(5)}`;
  // Old 9-digit + V/X format → convert to canonical new 12-digit form.
  const old = s.match(/^(\d{9})[VX]$/);
  if (old) return oldNicToNew(old[1]);
  return s;
};

const normalizePassport = (value) =>
  String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const normalizeName = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Matched after normalization (old NICs are already converted to new form).
const isNic = (s) => /^\d{12}$/.test(s) || /^\d{9}[VX]$/.test(s);
const isPassport = (s) => /^[A-Z]{1,3}\d{6,9}$/.test(s);

// Classify a raw identity value into a stable, format-agnostic match key.
const classifyIdentity = (raw) => {
  const nic = normalizeNic(raw);
  if (isNic(nic)) return { matchType: 'nic', key: `nic:${nic}`, displayId: nic };
  const pp = normalizePassport(raw);
  if (isPassport(pp)) return { matchType: 'passport', key: `passport:${pp}`, displayId: pp };
  return null;
};

// ---------------------------------------------------------------------------
// Extract people from one merchant's stored AI extraction (extracted_json).
// Returns rows: { matchType, key, displayId, name, dob, role }
// ---------------------------------------------------------------------------

const pick = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};

const buildRow = ({ rawId, name, dob, role, source }) => {
  const matched = rawId ? classifyIdentity(rawId) : null;
  if (matched) {
    return { ...matched, name: name || '(unknown)', dob: dob || null, role: role || 'Stakeholder', source: source || null };
  }
  // Weak fallback: name + DOB. Name alone is never used as a key.
  const nName = normalizeName(name);
  if (nName && dob) {
    return {
      matchType: 'name_dob',
      key: `namedob:${nName}|${dob}`,
      displayId: `${name} (DOB ${dob})`,
      name: name || '(unknown)',
      dob,
      role: role || 'Stakeholder',
      source: source || null,
    };
  }
  return null;
};

const extractIdentitiesFromExtraction = (extraction) => {
  if (!extraction || typeof extraction !== 'object') return [];
  const rows = [];
  const seenKeys = new Set();

  const add = (row) => {
    if (row && !seenKeys.has(row.key)) {
      seenKeys.add(row.key);
      rows.push(row);
    }
  };

  // OwnerInformation[] — richest: NIC/Passport number + full name + DOB.
  if (Array.isArray(extraction.OwnerInformation)) {
    extraction.OwnerInformation.forEach((o) => {
      add(buildRow({
        rawId: pick(o, ['NIC/Passport/DL Number', 'NIC', 'Passport', 'id']),
        name: pick(o, ['fullName', 'full_name', 'name']),
        dob: pick(o, ['Date of Birth', 'date_of_birth', 'dob']),
        role: pick(o, ['designation', 'Designation']) || 'Owner/Director',
        source: 'NIC / ID copy',
      }));
    });
  }

  // Directors[] — id holds the NIC.
  if (Array.isArray(extraction.Directors)) {
    extraction.Directors.forEach((d) => {
      add(buildRow({
        rawId: pick(d, ['id', 'nic', 'NIC', 'NIC/Passport/DL Number']),
        name: pick(d, ['name', 'fullName']),
        dob: pick(d, ['Date of Birth', 'date_of_birth', 'dob']),
        role: pick(d, ['designation', 'Designation']) || 'Director',
        source: 'Directors list',
      }));
    });
  }

  // DirectorChange → "Director information from Form 1" (NICs straight from Form 40).
  const form1 = extraction.DirectorChange?.['Director information from Form 1'];
  if (Array.isArray(form1)) {
    form1.forEach((d) => {
      add(buildRow({
        rawId: pick(d, ['nic', 'NIC', 'nicPassport', 'nic_passport', 'NIC/Passport/DL Number', 'id']),
        name: pick(d, ['name', 'fullName']),
        dob: pick(d, ['Date of Birth', 'date_of_birth', 'dob']),
        role: 'Director',
        source: 'Form 01',
      }));
    });
  }

  return rows;
};

// ---------------------------------------------------------------------------
// Index building (read-only DB). index = Map<key, { matchType, displayId,
// occurrences: [{ mid, business, name, role }] }>
// ---------------------------------------------------------------------------

const buildIndex = async () => {
  // Latest analysis row per MID that has an extraction.
  const [rows] = await db.query(
    `SELECT mi.mid,
            mi.merchant_business_name,
            mdjd.extracted_json
     FROM merchant_information mi
     JOIN merchant_document_json_data mdjd ON mdjd.mid = mi.mid
     WHERE mdjd.extracted_json IS NOT NULL
       AND mdjd.created_at = (
         SELECT MAX(x.created_at)
         FROM merchant_document_json_data x
         WHERE x.mid = mi.mid AND x.extracted_json IS NOT NULL
       )`
  );

  const index = new Map();

  rows.forEach((r) => {
    let extraction;
    try {
      extraction = typeof r.extracted_json === 'string' ? JSON.parse(r.extracted_json) : r.extracted_json;
    } catch {
      return; // skip unparseable rows
    }

    const business = r.merchant_business_name || `Merchant ${r.mid}`;

    extractIdentitiesFromExtraction(extraction).forEach((row) => {
      if (!index.has(row.key)) {
        index.set(row.key, { matchType: row.matchType, displayId: row.displayId, occurrences: [] });
      }
      const entry = index.get(row.key);
      // De-dupe the same person appearing twice within the same MID.
      if (!entry.occurrences.some((o) => String(o.mid) === String(r.mid))) {
        entry.occurrences.push({ mid: r.mid, business, name: row.name, role: row.role, source: row.source });
      }
    });
  });

  return { builtAt: Date.now(), index, merchantCount: rows.length };
};

const getIndex = async ({ forceRefresh = false } = {}) => {
  const fresh = cache.index && (Date.now() - cache.builtAt) < INDEX_TTL_MS;
  if (!forceRefresh && fresh) return cache;
  if (cache.building) return cache.building; // coalesce concurrent rebuilds

  cache.building = buildIndex()
    .then((built) => {
      cache = { ...built, building: null };
      return cache;
    })
    .catch((err) => {
      cache.building = null;
      throw err;
    });
  return cache.building;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const toGroup = (entry) => ({
  match_type: entry.matchType,        // 'nic' | 'passport' | 'name_dob'
  identifier: entry.displayId,
  business_count: entry.occurrences.length,
  businesses: entry.occurrences.map((o) => ({
    mid: o.mid, business: o.business, name: o.name, role: o.role, source: o.source,
  })),
});

const rank = { nic: 0, passport: 1, name_dob: 2 };

// Every person who appears in more than one business.
const getAllDuplicates = async (opts) => {
  const { index, builtAt, merchantCount } = await getIndex(opts);
  const groups = [];
  for (const entry of index.values()) {
    if (entry.occurrences.length > 1) groups.push(toGroup(entry));
  }
  groups.sort((a, b) =>
    (rank[a.match_type] - rank[b.match_type]) || (b.business_count - a.business_count));
  return {
    generated_at: new Date(builtAt).toISOString(),
    merchant_count: merchantCount,
    duplicate_count: groups.length,
    duplicates: groups,
  };
};

// For one merchant: which of its people also appear in other businesses.
const getDuplicatesForMid = async (mid, opts) => {
  const { index, builtAt } = await getIndex(opts);
  const matches = [];
  for (const entry of index.values()) {
    const here = entry.occurrences.find((o) => String(o.mid) === String(mid));
    if (!here) continue;
    const others = entry.occurrences.filter((o) => String(o.mid) !== String(mid));
    if (others.length === 0) continue;
    matches.push({
      match_type: entry.matchType,
      identifier: entry.displayId,
      person: { name: here.name, role: here.role, source: here.source },
      also_registered_in: others.map((o) => ({
        mid: o.mid, business: o.business, name: o.name, role: o.role, source: o.source,
      })),
    });
  }
  matches.sort((a, b) => rank[a.match_type] - rank[b.match_type]);
  return { mid, generated_at: new Date(builtAt).toISOString(), match_count: matches.length, matches };
};

module.exports = { getAllDuplicates, getDuplicatesForMid };
