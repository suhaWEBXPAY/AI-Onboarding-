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

module.exports = { buildVerificationReportDoc };
