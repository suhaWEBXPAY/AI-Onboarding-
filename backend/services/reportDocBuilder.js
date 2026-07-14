// Builds a Word (.docx) verification report for a single merchant from the stored
// analysis (validation_json). It describes the onboarding decision, the rule checks,
// document validity, the specific issues found (with the plain-language clarity
// comments), and any manual overrides — NOT the merchant's source documents.

const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle,
} = require('docx');

// ── palette ────────────────────────────────────────────────────────────────
const COLOR = {
  ink: '1F2937', grey: '6B7280', line: 'D1D5DB',
  green: '15803D', amber: 'B45309', red: 'B91C1C', blue: '1D4ED8',
  headerBg: '111827', zebra: 'F3F4F6',
};

const STATUS_META = {
  verified: { label: 'VERIFIED', color: COLOR.green, blurb: 'Eligible for onboarding.' },
  caution:  { label: 'CAUTION',  color: COLOR.amber, blurb: 'Eligible for onboarding — minor issues flagged for review.' },
  review:   { label: 'NEEDS REVIEW', color: COLOR.red, blurb: 'Not eligible for onboarding until blocking issues are resolved.' },
};

const normStatus = (s) => {
  const v = String(s || '').toLowerCase();
  if (v === 'verified') return 'verified';
  if (v === 'caution' || v === 'source_gap_review') return 'caution';
  if (v === 'review' || v === 'review_required') return 'review';
  return null;
};

const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? String(d) : dt.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const safe = (v) => (v == null || v === '' ? '—' : String(v));

// ── small builders ───────────────────────────────────────────────────────────
const text = (t, opts = {}) => new TextRun({ text: String(t ?? ''), size: 20, ...opts });

const para = (children, opts = {}) => new Paragraph({
  children: Array.isArray(children) ? children : [children],
  spacing: { after: 80, ...(opts.spacing || {}) },
  ...opts,
});

const heading = (t, color = COLOR.ink) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 260, after: 120 },
  children: [new TextRun({ text: t, bold: true, size: 26, color })],
});

const noBorders = {
  top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
  insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE },
};
const thinBorders = {
  top: { style: BorderStyle.SINGLE, size: 4, color: COLOR.line },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR.line },
  left: { style: BorderStyle.SINGLE, size: 4, color: COLOR.line },
  right: { style: BorderStyle.SINGLE, size: 4, color: COLOR.line },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: COLOR.line },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: COLOR.line },
};

const cell = (content, { bg, bold, color, width, align } = {}) => new TableCell({
  width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
  shading: bg ? { fill: bg } : undefined,
  margins: { top: 60, bottom: 60, left: 100, right: 100 },
  children: [new Paragraph({
    alignment: align,
    children: (Array.isArray(content) ? content : [content]).map((c) =>
      typeof c === 'string' ? new TextRun({ text: c, bold, color, size: 20 }) : c),
  })],
});

// Header row + data rows → striped table.
const buildTable = (headers, rows, widths = []) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: thinBorders,
  rows: [
    new TableRow({
      tableHeader: true,
      children: headers.map((h, i) =>
        cell(h, { bg: COLOR.headerBg, bold: true, color: 'FFFFFF', width: widths[i] })),
    }),
    ...rows.map((cells, r) => new TableRow({
      children: cells.map((c, i) => {
        const opts = (c && typeof c === 'object' && !Array.isArray(c) && 'value' in c) ? c : { value: c };
        return cell(opts.value, {
          bg: r % 2 ? COLOR.zebra : undefined,
          width: widths[i],
          bold: opts.bold,
          color: opts.color,
        });
      }),
    })),
  ],
});

// Two-column "label: value" info block.
const infoTable = (pairs) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: noBorders,
  rows: pairs.map(([label, value]) => new TableRow({
    children: [
      cell(label, { bold: true, color: COLOR.grey, width: 30 }),
      cell(Array.isArray(value) ? value : String(value), { width: 70 }),
    ],
  })),
});

// ── main ──────────────────────────────────────────────────────────────────────
const buildVerificationReportDoc = async ({ merchant = {}, analysis = {}, report = {}, overrides = [] }) => {
  const effective = normStatus(analysis.review_status) || normStatus(analysis.computed_status) || normStatus(report.status) || 'review';
  const meta = STATUS_META[effective];
  const isManual = Boolean(analysis.review_status);

  const summary = report.summary || {};
  const ruleChecks = Array.isArray(report.ruleChecks) ? report.ruleChecks : [];
  const documentChecks = Array.isArray(report.documentChecks) ? report.documentChecks : [];
  const verdict = ruleChecks.find((c) => c.isVerdict);

  // Issues = non-matched unified rows. Tag which were manually ignored.
  const isIgnored = (row) => overrides.some(
    (ov) => (ov.field_name || '') === (row.field || '') && (ov.document_source || '') === (row.document || '—')
  );
  const issueRows = (Array.isArray(report.unifiedRows) ? report.unifiedRows : [])
    .filter((r) => ['missing', 'mismatch', 'invalid'].includes(r.status));

  const blocks = [];

  // Title
  blocks.push(new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text: 'Merchant Onboarding Verification Report', bold: true, size: 36, color: COLOR.ink })],
  }));
  blocks.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({ text: `Generated ${fmtDate(new Date())}`, size: 18, color: COLOR.grey, italics: true })],
  }));

  // Decision banner
  blocks.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: thinBorders,
    rows: [new TableRow({
      children: [new TableCell({
        shading: { fill: COLOR.zebra },
        margins: { top: 140, bottom: 140, left: 160, right: 160 },
        children: [
          new Paragraph({ children: [
            new TextRun({ text: 'Decision:  ', bold: true, size: 24, color: COLOR.ink }),
            new TextRun({ text: meta.label, bold: true, size: 24, color: meta.color }),
            new TextRun({ text: isManual ? '   (manually set by reviewer)' : '   (set automatically by analysis)', size: 18, color: COLOR.grey, italics: true }),
          ] }),
          new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: meta.blurb, size: 20, color: COLOR.ink })] }),
        ],
      })],
    })],
  }));

  // Merchant details
  blocks.push(heading('Merchant Details'));
  blocks.push(infoTable([
    ['MID', safe(merchant.mid)],
    ['Business Name', safe(merchant.merchant_business_name)],
    ['Merchant Type', safe(merchant.merchant_type_name)],
    ['Channel', safe(merchant.merchant_channel)],
    ['Onboarded Date', merchant.onboarded_date ? fmtDate(merchant.onboarded_date) : '—'],
    ['Last Analyzed', fmtDate(analysis.updated_at || analysis.created_at || report.generatedAt)],
  ]));

  // Decision summary
  blocks.push(heading('Onboarding Decision'));
  const decisionPairs = [
    ['Onboarding Status', [new TextRun({ text: meta.label, bold: true, color: meta.color, size: 20 })]],
    ['Can Onboard', analysis.can_onboard ? 'Yes' : 'No'],
    ['Satisfaction Score', analysis.satisfaction_score != null ? `${analysis.satisfaction_score}%` : '—'],
    ['Blocking Issues', String(report.blockingCount ?? (effective === 'review' ? 'see below' : 0))],
  ];
  if (isManual) {
    decisionPairs.push(['Overridden By', safe(analysis.review_status_by)]);
    decisionPairs.push(['Overridden On', fmtDate(analysis.review_status_at)]);
  }
  blocks.push(infoTable(decisionPairs));
  if (verdict?.detail) {
    blocks.push(para([
      new TextRun({ text: 'Rationale: ', bold: true, size: 20, color: COLOR.ink }),
      new TextRun({ text: verdict.detail, size: 20, color: COLOR.ink }),
    ], { spacing: { before: 100, after: 100 } }));
  }

  // Decision justification — per-issue evidence, policy rule, and remediation.
  const decision = report.onboardingDecision;
  if (decision?.summary) {
    blocks.push(heading('Decision Justification'));
    blocks.push(para([new TextRun({ text: decision.summary, size: 20, color: COLOR.ink })]));
    if (Array.isArray(decision.blockingIssues) && decision.blockingIssues.length) {
      blocks.push(buildTable(
        ['#', 'Blocking Issue', 'Evidence / Reason', 'Required Action'],
        decision.blockingIssues.map((issue, i) => [
          { value: String(i + 1), bold: true },
          { value: issue.title || issue.field || '—', bold: true, color: COLOR.red },
          `${issue.reason || '—'}${issue.policy ? `\n${issue.policy}` : ''}`,
          issue.requiredAction || '—',
        ]),
        [5, 25, 42, 28]
      ));
    }
    if (decision.policyNote) {
      blocks.push(para([new TextRun({ text: decision.policyNote, size: 16, color: COLOR.grey, italics: true })], { spacing: { before: 80 } }));
    }
  }

  // Rule checks
  if (ruleChecks.length) {
    blocks.push(heading('Verification Rule Checks'));
    blocks.push(buildTable(
      ['Check', 'Result', 'Detail'],
      ruleChecks.map((c) => {
        const st = String(c.status || '').toLowerCase();
        const color = st === 'pass' ? COLOR.green : st === 'fail' ? COLOR.red : st === 'warning' ? COLOR.amber : COLOR.grey;
        const label = st === 'pass' ? 'PASS' : st === 'fail' ? 'FAIL' : st === 'warning' ? 'REVIEW' : (c.status || '—');
        return [c.name || '—', { value: label, bold: true, color }, c.detail || '—'];
      }),
      [28, 14, 58]
    ));
  }

  // Document validity
  if (documentChecks.length) {
    blocks.push(heading('Document Validity'));
    blocks.push(buildTable(
      ['Document', 'Required', 'Present', 'Valid', 'Issues'],
      documentChecks.map((d) => {
        const issues = (d.issues || []).map((i) => (i.field ? `${i.field}: ${i.reason}` : i.reason)).filter(Boolean);
        const issueText = issues.length ? issues.join('\n') : (d.present ? 'None' : 'Document not found');
        return [
          d.name || '—',
          { value: d.isMandatory ? 'Mandatory' : 'Optional', color: d.isMandatory ? COLOR.red : COLOR.grey, bold: d.isMandatory },
          { value: d.present ? 'Yes' : 'No', color: d.present ? COLOR.green : COLOR.red, bold: true },
          { value: d.valid ? 'Yes' : 'No', color: d.valid ? COLOR.green : COLOR.red, bold: true },
          issueText,
        ];
      }),
      [26, 14, 11, 10, 39]
    ));
  }

  // Issues + clarity comments
  blocks.push(heading(`Issues Found (${issueRows.length})`));
  if (!issueRows.length) {
    blocks.push(para([new TextRun({ text: 'No data issues were detected during verification.', size: 20, color: COLOR.green })]));
  } else {
    blocks.push(buildTable(
      ['Field', 'Document', 'Type', 'Clarity / Reason'],
      issueRows.map((r) => {
        const ignored = isIgnored(r);
        const typeColor = r.status === 'invalid' ? COLOR.red : r.status === 'mismatch' ? COLOR.amber : COLOR.red;
        const comment = (r.comment || '—') + (ignored ? '  [IGNORED by reviewer]' : '');
        return [
          r.field || '—',
          r.document || '—',
          { value: r.status.toUpperCase(), bold: true, color: ignored ? COLOR.grey : typeColor },
          { value: comment, color: ignored ? COLOR.grey : COLOR.ink },
        ];
      }),
      [22, 22, 12, 44]
    ));
  }

  // Ignored failures detail
  if (overrides.length) {
    blocks.push(heading('Manually Ignored Failures'));
    blocks.push(para([new TextRun({
      text: 'A reviewer marked the following checks as acceptable. They were excluded from the blocking decision.',
      size: 18, color: COLOR.grey, italics: true,
    })]));
    blocks.push(buildTable(
      ['Rule / Field', 'Document', 'Reviewer Note'],
      overrides.map((o) => [
        o.field_name || o.rule_check_name || '—',
        o.document_source || '—',
        o.comment || '—',
      ]),
      [30, 24, 46]
    ));
  }

  // Footer
  blocks.push(new Paragraph({
    spacing: { before: 320 },
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: COLOR.line } },
    children: [new TextRun({
      text: 'This report was generated automatically from the stored verification analysis. It summarises the onboarding decision and findings for this merchant only and does not include the merchant’s source documents.',
      size: 16, color: COLOR.grey, italics: true,
    })],
  }));

  const doc = new Document({
    creator: 'AI-Onboarding-V2',
    title: `Verification Report — MID ${safe(merchant.mid)}`,
    styles: { default: { document: { run: { font: 'Calibri', color: COLOR.ink } } } },
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      children: blocks,
    }],
  });

  return Packer.toBuffer(doc);
};

// ── consolidated issues report ────────────────────────────────────────────────

// Strip internal/technical phrasing from stored analysis text so the report
// reads in plain language (no "LABEL:", "Google AI", "external system API").
const cleanDocName = (s) => String(s || '').replace(/^\s*label\s*:\s*/i, '').trim();

const humanize = (raw) => {
  if (!raw) return '';
  let t = String(raw);
  // "the document (LABEL: Bank Confirmation Letter)" → "the Bank Confirmation Letter"
  t = t.replace(/the document \(label:\s*([^)]+)\)/gi, 'the $1');
  t = t.replace(/\(label:\s*([^)]+)\)/gi, '($1)');
  // Internal source names → plain words.
  t = t.replace(/google ai document value does not match the external system api value\.?/gi, '');
  t = t.replace(/google ai document value/gi, 'the value in the uploaded document');
  t = t.replace(/the external system api value/gi, 'the system record');
  t = t.replace(/external system api/gi, 'system record');
  t = t.replace(/^needs review:\s*/i, '');
  // 'Bank Branch — "Bank Branch" does not match…' → 'Bank Branch does not match…'
  t = t.replace(/([A-Za-z][\w\s/&-]{1,50}?)\s*[—-]\s*[""']\1[""']\s*/gi, '$1 ');
  // Tidy leftover spacing/punctuation from the removals above.
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').replace(/[—-]\s*$/, '').trim();
  if (t && !/[.!?]$/.test(t)) t += '.';
  return t;
};

// Collect every open, actionable issue for one merchant from its stored report,
// worded for a non-technical reader. Missing OPTIONAL documents are returned
// separately (they are informational, not problems to fix). Manually ignored
// failures are excluded.
const collectMerchantIssues = (report = {}, overrides = []) => {
  const issues = [];
  const optionalMissing = [];
  const isIgnored = (field, docName) => overrides.some(
    (ov) => (ov.field_name || '') === (field || '') && (ov.document_source || '') === (docName || '—')
  );

  // 1. Missing / invalid documents.
  const documentChecks = Array.isArray(report.documentChecks) ? report.documentChecks : [];
  for (const d of documentChecks) {
    const name = cleanDocName(d.name) || 'Document';
    if (!d.present) {
      if (!d.isMandatory) { optionalMissing.push(name); continue; }
      issues.push({
        type: 'Missing document',
        blocking: true,
        detail: `The ${name} has not been uploaded. It is required for onboarding.`,
        action: `Upload the ${name}.`,
      });
    } else if (d.valid === false) {
      const reasons = (d.issues || [])
        .map((i) => humanize(i.field ? `${i.field}: ${i.reason}` : i.reason)).filter(Boolean).join(' ');
      issues.push({
        type: 'Document problem',
        blocking: Boolean(d.isMandatory),
        detail: `There is a problem with the ${name}.${reasons ? ` ${reasons}` : ''}`,
        action: `Fix the problem and upload the corrected ${name}.`,
      });
    }
  }

  // 2. Blocking issues from the onboarding decision (already carry an action).
  const blockingIssues = Array.isArray(report.onboardingDecision?.blockingIssues)
    ? report.onboardingDecision.blockingIssues : [];
  const coveredFields = new Set();
  for (const b of blockingIssues) {
    const key = String(b.field || b.title || '').trim().toLowerCase();
    if (key) coveredFields.add(key);
    issues.push({
      type: 'Must fix',
      blocking: true,
      detail: humanize(`${b.title || b.field || 'Issue'}${b.reason ? ` — ${b.reason}` : ''}`),
      action: humanize(b.requiredAction) || '—',
    });
  }

  // 3. Field-level data issues (skip ones already covered by a blocking issue).
  const rows = (Array.isArray(report.unifiedRows) ? report.unifiedRows : [])
    .filter((r) => ['missing', 'mismatch', 'invalid'].includes(r.status));
  for (const r of rows) {
    if (isIgnored(r.field, r.document)) continue;
    if (coveredFields.has(String(r.field || '').trim().toLowerCase())) continue;
    const docName = cleanDocName(r.document);
    const where = docName && docName !== '—' ? ` in the ${docName}` : '';
    const comment = humanize(r.comment);
    const byStatus = {
      missing: {
        type: 'Missing information',
        detail: `"${r.field}" could not be found${where || ' in the submitted documents'}.`,
        action: `Provide the ${r.field} — upload a document that shows it.`,
      },
      mismatch: {
        type: 'Information mismatch',
        detail: `"${r.field}"${where ? ` (${docName})` : ''} does not match across sources.`,
        action: `Check which ${r.field} is correct, then update the document or the system record so they match.`,
      },
      invalid: {
        type: 'Incorrect information',
        detail: `"${r.field}"${where} appears to be incorrect.`,
        action: `Correct the ${r.field}${where} and re-upload the document.`,
      },
    };
    const base = byStatus[r.status];
    issues.push({
      type: base.type,
      blocking: r.status !== 'mismatch',
      detail: comment ? `${base.detail} ${comment}` : base.detail,
      action: base.action,
    });
  }

  return { issues, optionalMissing };
};

// One combined Word report covering every analyzed merchant: a summary table,
// then a section per merchant listing each open issue and the action needed to
// resolve it. `entries` = [{ merchant, analysis, report, overrides }].
const buildAllIssuesReportDoc = async (entries = []) => {
  const prepared = entries.map((e) => {
    const effective = normStatus(e.analysis?.review_status)
      || normStatus(e.analysis?.computed_status)
      || normStatus(e.report?.status) || 'review';
    const { issues, optionalMissing } = collectMerchantIssues(e.report, e.overrides || []);
    return {
      merchant: e.merchant || {},
      analysis: e.analysis || {},
      status: effective,
      issues,
      optionalMissing,
    };
  });

  const withIssues = prepared.filter((p) => p.issues.length);
  const clean = prepared.filter((p) => !p.issues.length);
  const totalIssues = withIssues.reduce((n, p) => n + p.issues.length, 0);

  const blocks = [];

  // Title
  blocks.push(new Paragraph({
    spacing: { after: 40 },
    children: [new TextRun({ text: 'Consolidated Merchant Issues Report', bold: true, size: 36, color: COLOR.ink })],
  }));
  blocks.push(new Paragraph({
    spacing: { after: 200 },
    children: [new TextRun({
      text: `Generated ${fmtDate(new Date())} — covers ${prepared.length} analyzed merchant(s), ${withIssues.length} with open issues (${totalIssues} issue(s) total).`,
      size: 18, color: COLOR.grey, italics: true,
    })],
  }));

  // Summary table across all analyzed merchants
  blocks.push(heading('Summary — All Analyzed Merchants'));
  blocks.push(buildTable(
    ['Merchant', 'MID', 'Status', 'Open Issues', 'Last Analyzed'],
    prepared.map((p) => {
      const meta = STATUS_META[p.status];
      return [
        p.merchant.merchant_business_name || '—',
        safe(p.merchant.mid || p.analysis.mid),
        { value: meta.label, bold: true, color: meta.color },
        { value: String(p.issues.length), bold: p.issues.length > 0, color: p.issues.length ? COLOR.red : COLOR.green },
        fmtDate(p.analysis.updated_at || p.analysis.created_at),
      ];
    }),
    [32, 14, 16, 12, 26]
  ));

  // Per-merchant issue sections
  for (const p of withIssues) {
    const meta = STATUS_META[p.status];
    const name = p.merchant.merchant_business_name || `Merchant ${safe(p.merchant.mid || p.analysis.mid)}`;
    blocks.push(heading(`${name} (MID ${safe(p.merchant.mid || p.analysis.mid)})`));
    blocks.push(para([
      new TextRun({ text: 'Status: ', bold: true, size: 20, color: COLOR.ink }),
      new TextRun({ text: meta.label, bold: true, size: 20, color: meta.color }),
      new TextRun({ text: `   ${meta.blurb}`, size: 18, color: COLOR.grey, italics: true }),
    ]));
    blocks.push(buildTable(
      ['#', 'What is wrong', 'How to fix it'],
      p.issues.map((iss, i) => [
        { value: String(i + 1), bold: true },
        [
          new TextRun({ text: `${iss.type}: `, bold: true, size: 20, color: iss.blocking ? COLOR.red : COLOR.amber }),
          new TextRun({ text: iss.detail, size: 20, color: COLOR.ink }),
        ],
        { value: iss.action, color: COLOR.blue },
      ]),
      [5, 55, 40]
    ));
    if (p.optionalMissing.length) {
      blocks.push(para([new TextRun({
        text: `Optional documents not provided (do not block onboarding): ${p.optionalMissing.join(', ')}.`,
        size: 18, color: COLOR.grey, italics: true,
      })], { spacing: { before: 80 } }));
    }
  }

  // Merchants with no open issues
  if (clean.length) {
    blocks.push(heading('Merchants With No Open Issues'));
    blocks.push(para([new TextRun({
      text: clean.map((p) => `${p.merchant.merchant_business_name || 'Merchant'} (${safe(p.merchant.mid || p.analysis.mid)})`).join('  •  '),
      size: 20, color: COLOR.green,
    })]));
  }

  // Footer
  blocks.push(new Paragraph({
    spacing: { before: 320 },
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: COLOR.line } },
    children: [new TextRun({
      text: 'This report was generated automatically from the latest stored verification analysis of each merchant. Manually ignored failures are excluded from the issue lists.',
      size: 16, color: COLOR.grey, italics: true,
    })],
  }));

  const doc = new Document({
    creator: 'AI-Onboarding-V2',
    title: 'Consolidated Merchant Issues Report',
    styles: { default: { document: { run: { font: 'Calibri', color: COLOR.ink } } } },
    sections: [{
      properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      children: blocks,
    }],
  });

  return Packer.toBuffer(doc);
};

module.exports = { buildVerificationReportDoc, buildAllIssuesReportDoc };
