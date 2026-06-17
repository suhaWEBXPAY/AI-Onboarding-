import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import PageLayout from '../components/PageLayout';
import api from '../services/api';

const asPrettyJson = (value) => JSON.stringify(value, null, 2);

const coerceJsonValue = (value) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const formatJsonValue = (parsed) => {
  if (Array.isArray(parsed)) {
    return parsed.map((item) => {
      if (item && typeof item === 'object') {
        if (item.name) return item.name;
        return Object.entries(item).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ');
      }
      return String(item);
    }).join(' · ');
  }
  if (parsed && typeof parsed === 'object') {
    if (parsed.name) return parsed.name;
    return Object.entries(parsed).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ');
  }
  return String(parsed);
};

const formatCell = (value) => {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'object') return formatJsonValue(value);
  if (typeof value === 'string') {
    const t = value.trim();
    if ((t.startsWith('[') || t.startsWith('{')) && (t.endsWith(']') || t.endsWith('}'))) {
      try { return formatJsonValue(JSON.parse(t)); } catch { /* fall through */ }
    }
  }
  return String(value);
};

const formatDocLabel = (doc) => {
  if (!doc || doc === '—') return doc;
  return String(doc)
    .split(/\s+vs\s+/i)
    .map((part) => part
      .split(',')
      .map((seg) => seg
        .replace(/LABEL:\s*/gi, '')
        .replace(/\s*\|\s*API_SOURCE:\s*\S+/gi, '')
        .replace(/_/g, ' ')
        .trim()
      )
      .filter(Boolean)
      .join(', ')
    )
    .join(' vs ');
};

const parseBold = (text) => {
  if (!text) return null;
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  );
};

const fmtDate = (value) => value
  ? new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  : '-';


function StatusPill({ status, label }) {
  return (
    <span className={`verification-status verification-status--${status || 'idle'}`}>
      {label || 'Not run'}
    </span>
  );
}

function SummaryMetric({ label, value, tone = 'neutral' }) {
  return (
    <div className={`verification-metric verification-metric--${tone}`}>
      <span className="verification-metric-value">{value}</span>
      <span className="verification-metric-label">{label}</span>
    </div>
  );
}

const STATUS_CONFIG = {
  matched:  { label: 'Matched',          tone: 'success', symbol: '✓' },
  mismatch: { label: 'Mismatch',         tone: 'danger',  symbol: '✕' },
  missing:  { label: 'Missing',          tone: 'warn',    symbol: '!'  },
  invalid:  { label: 'Invalid',          tone: 'invalid', symbol: '⚠' },
  doc_only: { label: 'AI-Onboarding-V2', tone: 'doc',     symbol: '↗' },
  api_only: { label: 'System Data',      tone: 'sys',     symbol: '↘' },
};

// Merchant-level onboarding status (computed verdict or human override).
// review_required (computed) and review (manual) collapse to the same display.
const ONBOARD_STATUS = {
  verified: { label: 'Verified', tone: 'success', symbol: '✓' },
  caution:  { label: 'Caution',  tone: 'warn',    symbol: '⚠' },
  review:   { label: 'Review',   tone: 'danger',  symbol: '✗' },
};
const normalizeOnboardStatus = (s) => {
  const v = String(s || '').toLowerCase();
  if (v === 'verified') return 'verified';
  // Legacy 'source_gap_review' meant only source gaps (no critical issue) → caution.
  if (v === 'caution' || v === 'source_gap_review') return 'caution';
  if (v === 'review' || v === 'review_required') return 'review';
  return null;
};
// Resolve a merchant row's effective status from whatever fields are present.
const effectiveStatusOf = (m) => {
  if (!m) return null;
  const direct = normalizeOnboardStatus(m.effective_status || m.review_status || m.computed_status);
  if (direct) return direct;
  if (m.can_onboard == null) return null;        // not analyzed yet
  return m.can_onboard ? 'verified' : 'review';  // legacy rows without status columns
};

const FILTER_OPTIONS = [
  { key: 'all',      label: 'All'               },
  { key: 'mismatch', label: 'Mismatch'          },
  { key: 'missing',  label: 'Missing'           },
  { key: 'invalid',  label: 'Invalid'           },
  { key: 'matched',  label: 'Matched'           },
  { key: 'doc_only', label: 'AI-Onboarding-V2' },
  { key: 'api_only', label: 'System Data'       },
];

function ExpandableComment({ text }) {
  const [expanded, setExpanded] = useState(false);
  if (!text || text === '-' || text === '—') return <span style={{ color: 'var(--ash)' }}>—</span>;
  const isLong = text.length > 90;
  return (
    <div className="td-comment">
      <span className={`td-comment-text${expanded ? ' td-comment-text--expanded' : ''}`}>{text}</span>
      {isLong && (
        <button type="button" className="td-expand-btn" onClick={() => setExpanded((v) => !v)}>
          {expanded ? 'less' : 'more'}
        </button>
      )}
    </div>
  );
}

function UnifiedTable({ rows = [], allDocuments = [] }) {
  const [filter, setFilter] = useState('all');
  const [viewerDoc, setViewerDoc] = useState(null);
  const filtered = filter === 'all' ? rows : rows.filter((row) => row.status === filter);
  const counts = FILTER_OPTIONS.reduce((acc, opt) => {
    acc[opt.key] = opt.key === 'all' ? rows.length : rows.filter((row) => row.status === opt.key).length;
    return acc;
  }, {});

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">
          <span className="card-title-accent" />
          Verification Results
        </span>
        <span className="card-badge">{rows.length} rows</span>
      </div>

      <div className="unified-filter-bar">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            className={`unified-filter-btn unified-filter-btn--${opt.key === 'all' ? 'neutral' : STATUS_CONFIG[opt.key]?.tone || 'neutral'}${filter === opt.key ? ' unified-filter-btn--active' : ''}`}
            onClick={() => setFilter(opt.key)}
          >
            {opt.key !== 'all' && STATUS_CONFIG[opt.key]?.symbol && (
              <span style={{ opacity: 0.7 }}>{STATUS_CONFIG[opt.key].symbol}</span>
            )}
            {opt.label}
            <span className="unified-filter-count">{counts[opt.key]}</span>
          </button>
        ))}
      </div>

      <div className="table-wrapper verification-table-wrapper">
        <table className="data-table unified-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Document Type</th>
              <th>AI Value</th>
              <th>API Value</th>
              <th>Status</th>
              <th>Comment</th>
              <th className="rule-solution-col">Solution</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="empty-state">
                    <div className="empty-state-text">No rows match this filter.</div>
                  </div>
                </td>
              </tr>
            ) : filtered.map((row, index) => {
              const cfg = STATUS_CONFIG[row.status] || { label: row.status, tone: 'neutral', symbol: '' };
              const matchedDoc = findDocByLabel(row.document, allDocuments);
              const ruleKey = { mismatch: 'mismatch', missing: 'missing', invalid: 'invalid', doc_only: 'source_gap', api_only: 'source_gap' }[row.status];
              return (
                <tr key={`${row.status}-${row.field}-${index}`} className={`unified-row unified-row--${cfg.tone}`}>
                  <td className="td-name">{formatCell(row.field)}</td>
                  <td className="td-meta">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>{formatDocLabel(row.document)}</span>
                      {matchedDoc && (
                        <button
                          type="button"
                          className="btn-doc-open"
                          onClick={() => setViewerDoc(matchedDoc)}
                          title={`Open ${matchedDoc.label || row.document}`}
                        >
                          View
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="td-value">{formatCell(row.aiValue)}</td>
                  <td className="td-value">{formatCell(row.apiValue)}</td>
                  <td>
                    <span className={`unified-status-badge unified-status-badge--${cfg.tone}`}>
                      <span style={{ opacity: 0.75, fontStyle: 'normal' }}>{cfg.symbol}</span>
                      {cfg.label}
                      {row.nearMatch && <span className="near-match-star" title="Partial match — values are similar but not identical">★</span>}
                    </span>
                  </td>
                  <td><ExpandableComment text={formatCell(row.comment)} /></td>
                  <td className="rule-solution-cell">{ruleKey ? getSolution(row, ruleKey) : <span style={{ color: 'var(--ash)' }}>—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {viewerDoc && <DocViewerModal doc={viewerDoc} onClose={() => setViewerDoc(null)} />}
    </div>
  );
}

const RULE_STATUS_MAP = {
  'Required data coverage':                                         'missing',
  'Google AI document extraction vs external system cross-check':   'mismatch',
  'Format and validity rules':                                      'invalid',
  'Source capture coverage':                                        'source_gap',
  'Prompt merchant-type rules':                                     'ai_prompt',
};

// Map a raw data row (from report.invalidData / missingData etc.) to unified display shape
const toDisplayRow = (r) => ({
  field:    r.field,
  document: r.document || r.source || '—',
  aiValue:  r.documentValue ?? r.value ?? '—',
  apiValue: r.systemValue ?? '—',
  comment:  r.reason || r.rule || '—',
});

const normalizeLabel = (s) => String(s || '').toLowerCase().replace(/[\s_\-./]+/g, '');

const findDocByLabel = (documentType, allDocuments) => {
  if (!documentType || documentType === '—' || !allDocuments?.length) return null;
  const needle = normalizeLabel(documentType);
  return allDocuments.find((doc) => {
    const haystack = normalizeLabel(doc.label || doc.document_type || doc.type || doc.name || '');
    return haystack === needle || haystack.includes(needle) || needle.includes(haystack);
  }) || null;
};

function DocViewerModal({ doc, onClose }) {
  if (!doc) return null;
  const url = doc.url || doc.document_url || doc.path || doc.file_url || '';
  const typeStr = String(doc.document_type || doc.mime_type || doc.content_type || url).toLowerCase();
  const isPdf = typeStr.includes('pdf');
  return (
    <div className="doc-viewer-overlay" onClick={onClose}>
      <div className="doc-viewer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="doc-viewer-header">
          <span className="doc-viewer-title">{doc.label || doc.document_type || 'Document'}</span>
          <div className="doc-viewer-actions">
            <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }}>
              Open in new tab ↗
            </a>
            <button type="button" className="doc-viewer-close" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="doc-viewer-body">
          {isPdf ? (
            <iframe src={url} className="doc-viewer-iframe" title={doc.label || 'Document'} />
          ) : (
            <img src={url} alt={doc.label || 'Document'} className="doc-viewer-image" />
          )}
        </div>
      </div>
    </div>
  );
}

const getSolution = (item, ruleKey) => {
  const field   = item.field    || 'this field';
  const doc     = (item.document && item.document !== '—') ? item.document : null;
  const comment = String(item.comment || '').toLowerCase();
  const aiVal   = String(item.aiValue  || '');
  const apiVal  = String(item.apiValue || '');

  if (ruleKey === 'missing') {
    const isDocMissing = aiVal.includes('not found') || aiVal === '—';
    if (isDocMissing && doc) {
      return `Upload the "${doc}" document. It is mandatory and was not found during extraction.`;
    }
    if (apiVal && apiVal !== '—') {
      return `The system shows "${apiVal}" for "${field}" but the document value is absent. Ensure the document clearly states this field.`;
    }
    return `Provide "${field}"${doc ? ` in the ${doc}` : ''}. It is required for onboarding.`;
  }

  if (ruleKey === 'invalid') {
    if (comment.includes('expir')) {
      return `Renew the ${doc || 'document'} — "${field}" appears to be expired. Request an updated document from the merchant.`;
    }
    if (comment.includes('format') || comment.includes('invalid format')) {
      return `Correct the format of "${field}"${doc ? ` in ${doc}` : ''}. Ensure it follows the required format (e.g. date as YYYY-MM-DD, valid NIC pattern).`;
    }
    const fieldLower = String(field).toLowerCase();
    const isNicField = fieldLower.includes('nic') || fieldLower.includes('national id') || fieldLower.includes('passport') || fieldLower.includes('id number');
    if (isNicField && (comment.includes('nic') || comment.includes('national id') || comment.includes('format') || comment.includes('invalid'))) {
      return `Verify the NIC number in "${doc || 'the document'}" — it may be incorrectly formatted or invalid.`;
    }
    return `Review "${field}"${doc ? ` in ${doc}` : ''} — it failed a validity check. Correct the value and re-upload the document if needed.`;
  }

  if (ruleKey === 'mismatch') {
    return `Reconcile "${field}": document says "${aiVal}" but the system has "${apiVal}". Correct whichever source is wrong before approving.`;
  }

  if (ruleKey === 'ai_prompt') {
    if (comment.includes('irrelevant') || comment.includes('extra document')) {
      return `Confirm whether "${field}" is required for this merchant type. If not required, it can be disregarded; if required, replace it with the correct document.`;
    }
    if (comment.includes('missing') || comment.includes('not found') || comment.includes('required')) {
      return `Obtain and upload the "${field}" document. Google AI flagged it as required but missing.`;
    }
    return `Investigate the Google AI concern for "${field}". Correct the document or system data as appropriate before proceeding.`;
  }

  if (ruleKey === 'source_gap') {
    if (!apiVal || apiVal === '—') {
      return `"${field}" was extracted from ${doc || 'documents'} but has no system counterpart. Verify manually that the value is accurate.`;
    }
    return `"${field}" exists in the system (${apiVal}) but was not captured from documents. Ensure the document clearly shows this field.`;
  }

  return 'Review this issue and correct the document or system data before approving the merchant.';
};

const getRuleItems = (check, report) => {
  if (!report) return [];
  const rows = report.unifiedRows || [];
  const key = RULE_STATUS_MAP[check.name];

  if (key === 'missing') {
    const fromUnified = rows.filter((r) => r.status === 'missing');
    // Fall back to raw array — unifiedRows filters out some edge-case missing rows
    return fromUnified.length > 0 ? fromUnified : (report.missingData || []).map(toDisplayRow);
  }

  if (key === 'mismatch') {
    const fromUnified = rows.filter((r) => r.status === 'mismatch');
    return fromUnified.length > 0 ? fromUnified : (report.mismatches || []).map(toDisplayRow);
  }

  if (key === 'invalid') {
    // unifiedRows drops some invalid rows (bare integers, AI doc-presence dupes)
    // so always use the raw invalidData array to guarantee all failures are shown
    const raw = report.invalidData || [];
    if (raw.length > 0) return raw.map(toDisplayRow);
    return rows.filter((r) => r.status === 'invalid');
  }

  if (key === 'source_gap') {
    return rows.filter((r) => r.status === 'doc_only' || r.status === 'api_only');
  }

  if (key === 'ai_prompt') {
    const raw = [
      ...(report.missingData  || []),
      ...(report.invalidData  || []),
      ...(report.mismatches   || []),
    ].filter((r) => String(r.category || '').startsWith('ai_'));
    return raw.map(toDisplayRow);
  }

  return [];
};

function RuleCheckRow({ row, checkName, ruleKey, override, mid, allDocuments, onViewDoc, onSave, onRemove }) {
  const [showInput, setShowInput] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const matchedDoc = findDocByLabel(row.document, allDocuments);

  const handleSave = async () => {
    if (!draft.trim() || saving) return;
    setSaving(true);
    await onSave({ rule_check_name: checkName, field_name: row.field || '', document_source: row.document || '—', comment: draft.trim() });
    setSaving(false);
    setShowInput(false);
    setDraft('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave(); }
    if (e.key === 'Escape') { setShowInput(false); setDraft(''); }
  };

  const isOverridden = !!override;

  return (
    <tr className={isOverridden ? 'rule-row-overridden' : ''}>
      <td className="td-name">{formatCell(row.field)}</td>
      <td className="td-meta">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{formatDocLabel(row.document)}</span>
          {matchedDoc && (
            <button type="button" className="btn-doc-open" onClick={() => onViewDoc(matchedDoc)}
              title={`Open ${matchedDoc.label || row.document}`}>View</button>
          )}
        </div>
      </td>
      <td className="td-value">{formatCell(row.aiValue)}</td>
      <td className="td-value">{formatCell(row.apiValue)}</td>
      <td><ExpandableComment text={formatCell(row.comment)} /></td>
      <td className="rule-solution-cell" style={isOverridden ? { color: 'var(--ash)', fontStyle: 'italic' } : {}}>
        {getSolution(row, ruleKey)}
      </td>
      {mid && (
        <td className="rule-action-cell">
          {isOverridden ? (
            <div className="rule-override-confirmed">
              <span className="rule-override-badge">✓ Ignored</span>
              {override.comment && <span className="rule-override-note">{override.comment}</span>}
              <button type="button" className="rule-override-remove-btn" onClick={() => onRemove(override.id)}>Undo</button>
            </div>
          ) : showInput ? (
            <div className="rule-override-input-wrap">
              <input
                className="rule-override-comment-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Reason for ignoring… (Enter to save)"
                autoFocus
              />
              <div className="rule-override-input-actions">
                <button type="button" className="rule-override-confirm-btn" onClick={handleSave} disabled={!draft.trim() || saving}>
                  {saving ? '…' : 'Save'}
                </button>
                <button type="button" className="rule-override-cancel-btn" onClick={() => { setShowInput(false); setDraft(''); }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="rule-override-btn" onClick={() => setShowInput(true)}>
              Ignore
            </button>
          )}
        </td>
      )}
    </tr>
  );
}

function RuleCheckItem({ check, report, allDocuments = [], mid, overrides = [], onSaveOverride, onDeleteOverride }) {
  const [expanded, setExpanded] = useState(false);
  const [viewerDoc, setViewerDoc] = useState(null);
  const items = getRuleItems(check, report);
  const hasItems = items.length > 0;
  const ruleKey = RULE_STATUS_MAP[check.name];

  const findOverride = (item) => overrides.find((ov) =>
    ov.rule_check_name === check.name &&
    ov.field_name === (item.field || '') &&
    ov.document_source === (item.document || '—')
  ) || null;

  const allOverridden = hasItems && !check.isVerdict && items.every((item) => !!findOverride(item));
  const effectiveStatus = allOverridden ? 'pass' : check.status;

  return (
    <div className={`verification-rule-row rule-row--expandable${expanded ? ' rule-row--open' : ''}${check.isVerdict ? ' rule-row--verdict' : ''}`}>
      <button
        type="button"
        className="rule-row-header"
        onClick={() => hasItems && setExpanded((v) => !v)}
        style={{ cursor: hasItems ? 'pointer' : 'default' }}
        aria-expanded={expanded}
      >
        <span className={`verification-rule-state verification-rule-state--${effectiveStatus}${check.isVerdict ? ' verification-rule-state--verdict' : ''}`}>
          {effectiveStatus === 'pass'
            ? (check.isVerdict ? 'ELIGIBLE' : allOverridden ? 'overridden' : 'pass')
            : (check.isVerdict ? 'BLOCKED' : check.status)}
        </span>
        <div className="rule-header-text">
          <div className={`verification-rule-name${check.isVerdict ? ' verification-rule-name--verdict' : ''}`}>{check.name}</div>
          <div className="verification-rule-detail">{check.detail}</div>
        </div>
        {hasItems && <span className="rule-expand-chevron">{expanded ? '▲' : '▼'}</span>}
      </button>

      {expanded && hasItems && (
        <div className="rule-items-wrapper">
          <div className="table-wrapper">
            <table className="data-table rule-items-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Document</th>
                  <th>AI Value</th>
                  <th>System Value</th>
                  <th>Detail / Reason</th>
                  <th className="rule-solution-col">Solution</th>
                  {mid && <th className="rule-action-col">Action</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((row, i) => (
                  <RuleCheckRow
                    key={`${row.field}-${i}`}
                    row={row}
                    checkName={check.name}
                    ruleKey={ruleKey}
                    override={findOverride(row)}
                    mid={mid}
                    allDocuments={allDocuments}
                    onViewDoc={(doc) => setViewerDoc(doc)}
                    onSave={onSaveOverride}
                    onRemove={onDeleteOverride}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewerDoc && <DocViewerModal doc={viewerDoc} onClose={() => setViewerDoc(null)} />}
    </div>
  );
}

function DocumentChecksTable({ checks = [], overrides = [], allDocuments = [] }) {
  const [viewerDoc, setViewerDoc] = useState(null);

  if (!checks.length) return null;

  const getEffectiveIssues = (check) =>
    check.issues.filter(
      (issue) => !overrides.some(
        (ov) => ov.field_name === (issue.field || '') && ov.document_source === check.name
      )
    );

  const validCount   = checks.filter((c) => c.present && getEffectiveIssues(c).length === 0).length;
  const issueCount   = checks.filter((c) => c.present && getEffectiveIssues(c).length > 0).length;
  const missingCount = checks.filter((c) => !c.present).length;

  const hasSourceDocs = checks.some((c) => c.licenseSourceDocs?.length);

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">
          <span className="card-title-accent" />
          Document Validity
        </span>
        <span className="card-badge">{checks.length} required</span>
      </div>

      <div className="unified-filter-bar" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="unified-status-badge unified-status-badge--success" style={{ fontSize: 12 }}>
          ✓ {validCount} valid
        </span>
        {issueCount > 0 && (
          <span className="unified-status-badge unified-status-badge--invalid" style={{ fontSize: 12 }}>
            ⚠ {issueCount} has issues
          </span>
        )}
        {missingCount > 0 && (
          <span className="unified-status-badge unified-status-badge--danger" style={{ fontSize: 12 }}>
            ✗ {missingCount} missing
          </span>
        )}
      </div>

      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Document</th>
              <th style={{ width: 100 }}>Required</th>
              <th style={{ width: 90 }}>Present</th>
              <th style={{ width: 90 }}>Valid</th>
              <th>Issues / Reason</th>
              {hasSourceDocs && <th style={{ width: 160 }}>Source Documents</th>}
            </tr>
          </thead>
          <tbody>
            {checks.map((check) => {
              const effectiveIssues = getEffectiveIssues(check);
              const effectiveValid = check.present && effectiveIssues.length === 0;
              const rowClass = !check.present
                ? 'unified-row--danger'
                : !effectiveValid
                  ? 'unified-row--warn'
                  : 'unified-row--success';

              const sourceDocs = (check.licenseSourceDocs || [])
                .map((label) => findDocByLabel(label, allDocuments))
                .filter(Boolean);

              return (
                <tr key={check.name} className={`unified-row ${rowClass}`}>
                  <td className="td-name">{check.name}</td>
                  <td>
                    <span className={`unified-status-badge ${check.isMandatory ? 'unified-status-badge--danger' : 'unified-status-badge--sys'}`}>
                      {check.isMandatory ? 'Mandatory' : 'Optional'}
                    </span>
                  </td>
                  <td>
                    {check.present
                      ? <span className="unified-status-badge unified-status-badge--success">✓ Present</span>
                      : <span className="unified-status-badge unified-status-badge--danger">✗ Missing</span>
                    }
                  </td>
                  <td>
                    {!check.present
                      ? <span style={{ color: 'var(--ash)' }}>—</span>
                      : effectiveValid
                        ? <span className="unified-status-badge unified-status-badge--success">✓ Valid</span>
                        : <span className="unified-status-badge unified-status-badge--invalid">✗ Invalid</span>
                    }
                  </td>
                  <td className="td-value">
                    {effectiveIssues.length === 0 && !check.description
                      ? <span style={{ color: 'var(--ash)' }}>—</span>
                      : (
                        <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                          {check.description && (
                            <div style={{ marginBottom: effectiveIssues.length ? 6 : 0, color: 'var(--text-muted)' }}>
                              {check.description}
                            </div>
                          )}
                          {effectiveIssues.length > 0 && (
                            <ul style={{ margin: 0, paddingLeft: 16 }}>
                              {effectiveIssues.map((issue, i) => (
                                <li key={i}>
                                  {issue.field && <strong>{issue.field}: </strong>}
                                  {issue.reason}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    }
                  </td>
                  {hasSourceDocs && (
                    <td className="td-value">
                      {sourceDocs.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {sourceDocs.map((doc, i) => (
                            <button
                              key={i}
                              type="button"
                              className="btn-doc-open"
                              onClick={() => setViewerDoc(doc)}
                              title={`View ${doc.label || check.licenseSourceDocs[i]}`}
                            >
                              {doc.label || check.licenseSourceDocs[i]}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--ash)', fontSize: 12 }}>—</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {viewerDoc && <DocViewerModal doc={viewerDoc} onClose={() => setViewerDoc(null)} />}
    </div>
  );
}

function RuleChecks({ checks = [], report, allDocuments = [], mid, overrides = [], onSaveOverride, onDeleteOverride }) {
  if (!checks.length) return null;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">
          <span className="card-title-accent" />
          Rule Checks
        </span>
        <span className="card-badge">{checks.length} rules</span>
      </div>
      <div className="verification-rule-list">
        {checks.map((check) => (
          <RuleCheckItem
            key={check.name}
            check={check}
            report={report}
            allDocuments={allDocuments}
            mid={mid}
            overrides={overrides}
            onSaveOverride={onSaveOverride}
            onDeleteOverride={onDeleteOverride}
          />
        ))}
      </div>
    </div>
  );
}

function AiInsightCard({ insight }) {
  return (
    <div className="ai-insight-card">
      <div className="ai-insight-header">
        <span className="ai-insight-icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </span>
        <span className="ai-insight-title">AI Analysis</span>
        <span className="ai-insight-badge">Google AI</span>
      </div>
      <p className="ai-insight-body">{parseBold(insight)}</p>
    </div>
  );
}

function VerificationSummary({ report, overrides = [] }) {
  if (!report) return null;
  const summary = report.summary || {};
  const rows = report.unifiedRows || [];

  const failureStatuses = new Set(['missing', 'mismatch', 'invalid']);
  let matched = summary.matchedFields || 0;
  let missing = summary.missingData || 0;
  let invalid = summary.invalidData || 0;
  let mismatches = summary.mismatches || 0;
  rows.forEach((row) => {
    if (!failureStatuses.has(row.status)) return;
    const isOverridden = overrides.some(
      (ov) => ov.field_name === (row.field || '') && ov.document_source === (row.document || '—')
    );
    if (!isOverridden) return;
    if (row.status === 'missing')  missing   = Math.max(0, missing   - 1);
    if (row.status === 'mismatch') mismatches = Math.max(0, mismatches - 1);
    if (row.status === 'invalid')  invalid   = Math.max(0, invalid   - 1);
    matched += 1;
  });

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">
          <span className="card-title-accent" />
          Verification Summary
        </span>
        <span className="card-badge">{fmtDate(report.generatedAt)}</span>
      </div>
      <div className="verification-summary">
        <SummaryMetric label="Documents read" value={summary.receivedDocuments || 0} />
        <SummaryMetric label="Matched fields" value={matched} tone="success" />
        <SummaryMetric label="Missing data" value={missing} tone="danger" />
        <SummaryMetric label="Invalid data" value={invalid} tone="danger" />
        <SummaryMetric label="Mismatches" value={mismatches} tone="danger" />
        <SummaryMetric label="AI-Onboarding-V2" value={summary.documentOnlyData || 0} tone="warning" />
        <SummaryMetric label="System Data" value={summary.systemOnlyData || 0} tone="warning" />
      </div>
    </div>
  );
}

const DASH_CARDS = [
  { key: null,        label: 'Total Merchants',  tone: 'neutral',  icon: '▤' },
  { key: 'analyzed',  label: 'Analyzed',         tone: 'success',  icon: '✓' },
  { key: 'remaining', label: 'Remaining',        tone: 'warn',     icon: '⏳' },
  { key: 'verified',  label: 'Verified',         tone: 'success',  icon: '✓' },
  { key: 'caution',   label: 'Caution',          tone: 'warn',     icon: '⚠' },
  { key: 'review',    label: 'Needs Review',     tone: 'danger',   icon: '✗' },
  { key: 'above50',   label: 'Score ≥ 50%',      tone: 'success',  icon: '↑' },
  { key: 'below50',   label: 'Score < 50%',      tone: 'danger',   icon: '↓' },
];

function DashboardStats({ stats, meta, activeFilter, onFilter }) {
  const webxpayTotal = meta?.total ?? null;

  const getValue = (key) => {
    if (key === null) return webxpayTotal;
    if (key === 'remaining') {
      // Remaining = WebXPay total − analyzed (more accurate than local-DB remaining)
      return webxpayTotal != null && stats?.analyzed != null
        ? Math.max(0, webxpayTotal - stats.analyzed)
        : stats?.remaining ?? null;
    }
    return stats?.[key] ?? null;
  };

  return (
    <div className="ma-dashboard">
      {DASH_CARDS.map((card) => {
        const val = getValue(card.key);
        const isActive = activeFilter === card.key;
        return (
          <button
            key={card.key ?? 'all'}
            type="button"
            className={`ma-stat-card ma-stat-card--${card.tone}${isActive ? ' ma-stat-card--active' : ''}`}
            onClick={() => onFilter(card.key)}
          >
            <span className="ma-stat-icon">{card.icon}</span>
            <span className="ma-stat-value">{val != null ? val.toLocaleString() : '—'}</span>
            <span className="ma-stat-label">{card.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Human-settable onboarding status. Lets a reviewer override the computed verdict
// (e.g. confirm a flagged merchant as Verified, or downgrade one to Caution).
function ReviewStatusControl({ status, isOverridden, onSet, busy }) {
  const OPTIONS = ['verified', 'caution', 'review'];
  return (
    <div className="ma-status-control">
      <span className="form-label" style={{ marginBottom: 0 }}>Onboarding status</span>
      <div className="ma-status-seg">
        {OPTIONS.map((key) => {
          const cfg = ONBOARD_STATUS[key];
          const active = status === key;
          return (
            <button
              key={key}
              type="button"
              className={`ma-status-seg-btn ma-status-seg-btn--${cfg.tone}${active ? ' is-active' : ''}`}
              onClick={() => onSet(key)}
              disabled={busy || active}
              title={`Mark this merchant as ${cfg.label}`}
            >
              {cfg.symbol} {cfg.label}
            </button>
          );
        })}
      </div>
      {isOverridden
        ? (
          <button type="button" className="ma-status-revert" onClick={() => onSet('auto')} disabled={busy} title="Discard the manual override and use the system-computed verdict">
            ↺ Use auto
          </button>
        )
        : <span className="ma-status-origin">Set automatically by analysis</span>
      }
      {isOverridden && <span className="ma-status-origin ma-status-origin--manual">● Manually set by reviewer</span>}
    </div>
  );
}

function MerchantTable({ merchants, loading, meta, page, onPageChange, onSelect }) {
  const totalPages = meta ? meta.last_page : 1;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">
          <span className="card-title-accent" />
          All Merchants
        </span>
        {meta && (
          <span className="card-badge">{meta.total.toLocaleString()} merchants</span>
        )}
      </div>
      <div className="table-wrapper ma-full-table">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Business Name</th>
              <th>Type</th>
              <th>Channel</th>
              <th style={{ width: 80, textAlign: 'center' }}>Score</th>
              <th style={{ width: 100, textAlign: 'center' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state">
                    <div className="empty-state-text">Loading merchants…</div>
                  </div>
                </td>
              </tr>
            ) : merchants.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state">
                    <div className="empty-state-text">No merchants found.</div>
                  </div>
                </td>
              </tr>
            ) : merchants.map((merchant) => {
              const score = merchant.satisfaction_score;
              const scoreTone = score == null ? 'sys'
                : score >= 70 ? 'success'
                : score >= 40 ? 'warn'
                : 'danger';
              const effStatus = effectiveStatusOf(merchant);
              const statusCfg = effStatus ? ONBOARD_STATUS[effStatus] : null;
              const isOverridden = Boolean(merchant.review_status);
              return (
                <tr
                  key={merchant.mid}
                  className="merchant-row"
                  onClick={() => onSelect(merchant)}
                >
                  <td className="td-id">{merchant.mid}</td>
                  <td className="td-name">{merchant.merchant_business_name || '-'}</td>
                  <td className="td-meta" style={{ fontSize: 12 }}>{merchant.merchant_type_name || <span style={{ color: 'var(--ash)' }}>—</span>}</td>
                  <td className="td-meta" style={{ fontSize: 12 }}>{merchant.merchant_channel || <span style={{ color: 'var(--ash)' }}>—</span>}</td>
                  <td style={{ textAlign: 'center' }}>
                    {score != null
                      ? <span className={`unified-status-badge unified-status-badge--${scoreTone}`}>{score}%</span>
                      : <span style={{ color: 'var(--ash)', fontSize: 12 }}>—</span>
                    }
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {!statusCfg
                      ? <span className="unified-status-badge unified-status-badge--sys" style={{ fontSize: 11 }}>Pending</span>
                      : <span
                          className={`unified-status-badge unified-status-badge--${statusCfg.tone}`}
                          style={{ fontSize: 11 }}
                          title={isOverridden ? 'Manually set by a reviewer' : 'Set automatically by analysis'}
                        >
                          {statusCfg.symbol} {statusCfg.label}{isOverridden ? ' •' : ''}
                        </span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="docs-pagination" style={{ borderTop: '1px solid var(--border)' }}>
          <button
            className="docs-page-btn"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
          >‹</button>
          <span className="docs-page-info">Page {page} of {totalPages}</span>
          <button
            className="docs-page-btn"
            disabled={page >= totalPages || loading}
            onClick={() => onPageChange(page + 1)}
          >›</button>
        </div>
      )}
    </div>
  );
}

export default function MerchantAnalysis() {
  const [merchants, setMerchants] = useState([]);
  const [merchantMeta, setMerchantMeta] = useState(null);
  const [merchantPage, setMerchantPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [selectedMerchant, setSelectedMerchant] = useState(null);
  const [report, setReport] = useState(null);
  const [documentJson, setDocumentJson] = useState('');
  const [systemJson, setSystemJson] = useState('');
  const [overrides, setOverrides] = useState([]);
  const [dashStats, setDashStats] = useState(null);
  const [activeFilter, setActiveFilter] = useState(null);
  const [loadingMerchants, setLoadingMerchants] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [running, setRunning] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const searchTimer = useRef(null);
  const location = useLocation();

  const allDocuments = useMemo(() => {
    if (!systemJson) return [];
    try {
      const parsed = typeof systemJson === 'string' ? JSON.parse(systemJson) : systemJson;
      return parsed?.data?.all_documents || [];
    } catch { return []; }
  }, [systemJson]);

  const loadDashStats = useCallback(async () => {
    try {
      const { data } = await api.get('/onboard-verification/dashboard-stats');
      setDashStats(data);
    } catch { /* silent — dashboard is non-critical */ }
  }, []);

  const loadMerchants = useCallback(async (query, pg, filter = '') => {
    setLoadingMerchants(true);
    try {
      const params = { page: pg };
      if (query)  params.search = query;
      if (filter) params.filter = filter;
      const { data } = await api.get('/onboard-verification/merchant-list', { params });
      // Map WebXPay fields → internal shape expected by rest of the page
      const mapped = (data.data || []).map((m) => ({
        mid: m.id,
        merchant_number: m.merchant_number,
        merchant_business_name: m.doing_business_name,
        registered_business_name: m.registered_business_name,
        merchant_channel:   m.merchant_channel   || null,
        merchant_type_name: m.merchant_type_name || null,
        can_onboard:        m.can_onboard        != null ? m.can_onboard : null,
        satisfaction_score: m.satisfaction_score != null ? m.satisfaction_score : null,
        computed_status:    m.computed_status    || null,
        review_status:      m.review_status      || null,
        effective_status:   m.effective_status   || null,
        last_analysis_at:   m.last_analysis_at   || null,
      }));
      setMerchants(mapped);
      setMerchantMeta(data.meta || null);
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Failed to load merchants.', type: 'error' });
    } finally {
      setLoadingMerchants(false);
    }
  }, []);

  const loadMerchantDetail = async (merchant) => {
    if (!merchant?.mid) return;
    setSelectedMerchant(merchant);
    setReport(null);
    setDocumentJson('');
    setSystemJson('');
    setMessage({ text: '', type: '' });
    setLoadingDetail(true);

    // Always fetch DB merchant info so type/channel/name are populated even on direct MID search
    const needsDbInfo = !merchant.merchant_type_name || !merchant.merchant_channel;

    const [analysisResult, systemResult, merchantInfoResult, overridesResult] = await Promise.allSettled([
      api.get(`/onboard-verification/latest-analysis/${encodeURIComponent(merchant.mid)}`),
      api.get(`/onboard-verification/external-merchant/${encodeURIComponent(merchant.mid)}`),
      needsDbInfo
        ? api.get(`/onboard-verification/merchant/${encodeURIComponent(merchant.mid)}`)
        : Promise.resolve(null),
      api.get(`/onboard-verification/rule-overrides/${encodeURIComponent(merchant.mid)}`),
    ]);

    // Populate type/channel from DB
    if (merchantInfoResult.status === 'fulfilled' && merchantInfoResult.value?.data) {
      setSelectedMerchant((prev) => ({ ...prev, ...merchantInfoResult.value.data }));
    }

    if (analysisResult.status === 'fulfilled') {
      const analysisData = analysisResult.value.data;
      const extracted = coerceJsonValue(analysisData?.extracted_json);
      const validation = coerceJsonValue(analysisData?.validation_json);
      setDocumentJson(extracted ? asPrettyJson(extracted) : '');
      setReport(validation && typeof validation === 'object' ? validation : null);
      // Enrich header with score/status/date from latest analysis
      setSelectedMerchant((prev) => ({
        ...prev,
        latest_analysis_at: analysisData?.created_at ?? prev.latest_analysis_at,
        can_onboard: analysisData?.can_onboard ?? prev.can_onboard,
        satisfaction_score: analysisData?.satisfaction_score ?? prev.satisfaction_score,
        computed_status: analysisData?.computed_status ?? prev.computed_status,
        review_status: analysisData?.review_status ?? null,
        effective_status: analysisData?.effective_status
          ?? analysisData?.review_status
          ?? analysisData?.computed_status
          ?? prev.effective_status,
      }));
    } else if (analysisResult.reason?.response?.status === 404) {
      setMessage({ text: 'No saved analysis for this merchant.', type: 'error' });
    } else {
      setMessage({ text: analysisResult.reason?.response?.data?.message || 'Failed to load saved analysis.', type: 'error' });
    }

    if (systemResult.status === 'fulfilled') {
      const sysData = systemResult.value.data;
      setSystemJson(asPrettyJson(sysData));
      // Fallback: populate business name from WebXPay if still missing
      if (sysData?.data?.business_information) {
        const biz = sysData.data.business_information;
        setSelectedMerchant((prev) => ({
          ...prev,
          merchant_business_name: prev.merchant_business_name
            || biz.name_of_company_business
            || biz.registered_name_of_business
            || prev.merchant_business_name,
        }));
      }
    } else {
      setMessage((prev) => ({
        text: prev.text
          ? `${prev.text} System API data could not be loaded.`
          : (systemResult.reason?.response?.data?.message || 'System API data could not be loaded.'),
        type: 'error',
      }));
    }

    setOverrides(
      overridesResult.status === 'fulfilled' && Array.isArray(overridesResult.value.data)
        ? overridesResult.value.data
        : []
    );

    setLoadingDetail(false);
  };

  const handleFilterClick = (filterKey) => {
    const next = activeFilter === filterKey ? null : filterKey;
    setActiveFilter(next);
    setMerchantPage(1);
    setSearchInput('');
    loadMerchants('', 1, next || '');
  };

  const handleSearchChange = (e) => {
    const q = e.target.value;
    setSearchInput(q);
    setMerchantPage(1);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadMerchants(q, 1, activeFilter || ''), 400);
  };

  const handlePageChange = (pg) => {
    setMerchantPage(pg);
    loadMerchants(searchInput, pg, activeFilter || '');
  };

  const handleBack = () => {
    setSelectedMerchant(null);
    setReport(null);
    setDocumentJson('');
    setSystemJson('');
    setOverrides([]);
    setMessage({ text: '', type: '' });
  };

  const runAnalysis = async (forceReExtract = false) => {
    if (!selectedMerchant?.mid) return;

    setRunning(true);
    setMessage({
      text: forceReExtract
        ? 'Re-running Google AI document extraction (this may take a moment)...'
        : 'Re-verifying with latest system data (using cached document extraction)...',
      type: '',
    });
    try {
      const response = await api.post(`/onboard-verification/verify-mid/${encodeURIComponent(selectedMerchant.mid)}`, {
        merchant_type_id: selectedMerchant.merchant_type_id,
        merchant_channel: selectedMerchant.merchant_channel,
        forceReExtract,
      });
      setDocumentJson(asPrettyJson(response.data.documentData));
      setSystemJson(asPrettyJson(response.data.systemData));
      setReport(response.data.report);
      setSelectedMerchant((prev) => ({
        ...prev,
        latest_analysis_at: response.data.report?.generatedAt || new Date().toISOString(),
        // Caution counts as onboardable; only a hard review_required blocks.
        can_onboard: ['verified', 'caution'].includes(response.data.report?.status) ? 1 : 0,
        // Re-analysis refreshes the computed verdict but keeps any manual override (review_status).
        computed_status: response.data.report?.status || prev.computed_status,
        effective_status: prev.review_status || response.data.report?.status || prev.effective_status,
        satisfaction_score: response.data.report?.summary
          ? Math.round(
            ((response.data.report.summary.matchedFields || 0)
              / Math.max(
                1,
                (response.data.report.summary.matchedFields || 0)
                + (response.data.report.summary.missingData || 0)
                + (response.data.report.summary.invalidData || 0)
                + (response.data.report.summary.mismatches || 0)
              )) * 100
          )
          : prev?.satisfaction_score,
      }));
      try {
        const { data: ov } = await api.get(`/onboard-verification/rule-overrides/${encodeURIComponent(selectedMerchant.mid)}`);
        setOverrides(Array.isArray(ov) ? ov : []);
      } catch { setOverrides([]); }
      loadDashStats();
      const modeNote = response.data.usedCachedExtraction
        ? 'Cached document extraction used — results are consistent.'
        : 'Fresh AI extraction completed.';
      setMessage({ text: `Verification complete. ${modeNote}`, type: 'success' });
      // no need to reload the list after analysis
    } catch (err) {
      const serverMsg = err.response?.data?.message;
      const httpStatus = err.response?.status ? ` (HTTP ${err.response.status})` : '';
      setMessage({ text: serverMsg || `Analysis failed${httpStatus}. Check server logs for details.`, type: 'error' });
    } finally {
      setRunning(false);
    }
  };

  const triggerAutoRun = async () => {
    setAutoRunning(true);
    setMessage({ text: 'Triggering auto-analysis for unanalyzed merchants...', type: '' });
    try {
      const response = await api.post('/onboard-verification/auto-run');
      const { message: serverMsg, running } = response.data;
      setMessage({
        text: serverMsg || (running ? 'Auto-run started in background.' : 'Done.'),
        type: 'success',
      });
      loadDashStats();
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Auto-run failed.', type: 'error' });
    } finally {
      setAutoRunning(false);
    }
  };

  const handleSaveOverride = useCallback(async (overrideData) => {
    if (!selectedMerchant?.mid) return;
    try {
      const { data } = await api.post('/onboard-verification/rule-overrides', {
        mid: selectedMerchant.mid,
        ...overrideData,
      });
      setOverrides(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Failed to save override.', type: 'error' });
    }
  }, [selectedMerchant]);

  const handleDeleteOverride = useCallback(async (id) => {
    if (!selectedMerchant?.mid) return;
    try {
      const { data } = await api.delete(`/onboard-verification/rule-overrides/${id}?mid=${encodeURIComponent(selectedMerchant.mid)}`);
      setOverrides(Array.isArray(data) ? data : []);
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Failed to remove override.', type: 'error' });
    }
  }, [selectedMerchant]);

  // Manually set the merchant's onboarding status (verified / caution / review),
  // or pass 'auto' to clear the override and fall back to the computed verdict.
  const handleSetReviewStatus = useCallback(async (newStatus) => {
    if (!selectedMerchant?.mid) return;
    setStatusBusy(true);
    try {
      const { data } = await api.patch(
        `/onboard-verification/review-status/${encodeURIComponent(selectedMerchant.mid)}`,
        { review_status: newStatus }
      );
      // Update the detail header…
      setSelectedMerchant((prev) => ({
        ...prev,
        review_status: data.review_status,
        computed_status: data.computed_status ?? prev.computed_status,
        effective_status: data.effective_status,
        can_onboard: data.can_onboard,
      }));
      // …and the matching row in the list so the badge reflects it on back-navigation.
      setMerchants((prev) => prev.map((m) => (
        Number(m.mid) === Number(selectedMerchant.mid)
          ? { ...m, review_status: data.review_status, computed_status: data.computed_status ?? m.computed_status, effective_status: data.effective_status, can_onboard: data.can_onboard }
          : m
      )));
      setMessage({
        text: data.review_status
          ? `Status set to "${data.review_status}".`
          : 'Status reverted to the system-computed verdict.',
        type: 'success',
      });
      loadDashStats();
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Failed to update status.', type: 'error' });
    } finally {
      setStatusBusy(false);
    }
  }, [selectedMerchant, loadDashStats]);

  useEffect(() => {
    loadMerchants('', 1);
    loadDashStats();
  }, [loadMerchants, loadDashStats, location]);

  return (
    <PageLayout>
      <div className="page-header">
        <h1 className="page-title">Merchant Analysis</h1>
        <p className="page-subtitle">Merchant verification history and source comparison</p>
      </div>

      {/* Search bar */}
      <div className="ma-search-bar">
        {!selectedMerchant && (
          <div className="vi-input-group" style={{ flex: 1 }}>
            <span className="vi-input-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </span>
            <input
              className="form-control vi-input-has-icon"
              value={searchInput}
              onChange={handleSearchChange}
              placeholder="Search merchants by name…"
            />
          </div>
        )}
        {selectedMerchant && (
          <button className="btn btn-secondary" type="button" onClick={handleBack}>
            ← Back to List
          </button>
        )}
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => { loadMerchants(searchInput, merchantPage, activeFilter || ''); loadDashStats(); }}
          disabled={loadingMerchants}
        >
          {loadingMerchants ? 'Loading…' : 'Refresh'}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={triggerAutoRun}
          disabled={autoRunning}
          title="Run analysis for newly onboarded merchants today"
        >
          {autoRunning ? 'Running…' : 'Auto-Run'}
        </button>
      </div>

      {message.text && (
        <div className={`alert alert-${message.type || 'info'}`} style={{ marginBottom: 16 }}>
          {message.text}
        </div>
      )}

      {/* Dashboard + table view — shown when no merchant is selected */}
      {!selectedMerchant && (
        <>
          <DashboardStats
            stats={dashStats}
            meta={merchantMeta}
            activeFilter={activeFilter}
            onFilter={handleFilterClick}
          />
          <MerchantTable
            merchants={merchants}
            loading={loadingMerchants}
            meta={merchantMeta}
            page={merchantPage}
            onPageChange={handlePageChange}
            onSelect={loadMerchantDetail}
          />
        </>
      )}

      {/* Detail view — shown when a merchant is selected */}
      {selectedMerchant && (
        <div className="ma-detail">
          {/* Merchant header card */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">
                <span className="card-title-accent" />
                {selectedMerchant.merchant_business_name || selectedMerchant.mid}
              </span>
              {(() => {
                const eff = effectiveStatusOf(selectedMerchant) || normalizeOnboardStatus(report?.status);
                if (!eff) return <StatusPill status={report?.status} label={report?.statusLabel} />;
                const cfg = ONBOARD_STATUS[eff];
                return (
                  <span className={`unified-status-badge unified-status-badge--${cfg.tone}`} style={{ fontSize: 12 }}>
                    {cfg.symbol} {cfg.label}{selectedMerchant.review_status ? ' • manual' : ''}
                  </span>
                );
              })()}
            </div>
            <div className="card-body">
              <div className="merchant-analysis-meta">
                <div>
                  <span className="form-label">MID</span>
                  <div className="td-name">{selectedMerchant.mid}</div>
                </div>
                <div>
                  <span className="form-label">Merchant Type</span>
                  <div className="td-name">{selectedMerchant.merchant_type_name || '-'}</div>
                </div>
                <div>
                  <span className="form-label">Channel</span>
                  <div className="td-name">{selectedMerchant.merchant_channel || '-'}</div>
                </div>
                <div>
                  <span className="form-label">Last Analysis</span>
                  <div className="td-name">{fmtDate(selectedMerchant.latest_analysis_at)}</div>
                </div>
              </div>

              {report && (
                <ReviewStatusControl
                  status={effectiveStatusOf(selectedMerchant) || normalizeOnboardStatus(report?.status)}
                  isOverridden={Boolean(selectedMerchant.review_status)}
                  onSet={handleSetReviewStatus}
                  busy={statusBusy}
                />
              )}

              <div className="form-actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => runAnalysis(false)}
                  disabled={running || loadingDetail}
                  title="Re-verify using the last saved AI extraction + fresh system data. Fast and consistent."
                >
                  {running ? 'Running...' : 'Sync & Verify'}
                </button>
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => runAnalysis(true)}
                  disabled={running || loadingDetail}
                  title="Re-run Google AI document extraction from scratch. Use only when documents have changed."
                >
                  Re-extract Docs
                </button>
                <button className="btn btn-secondary" type="button" onClick={() => loadMerchantDetail(selectedMerchant)} disabled={loadingDetail || running}>
                  {loadingDetail ? 'Loading...' : 'Reload'}
                </button>
              </div>
            </div>
          </div>

          {report && (
            <>
              <VerificationSummary report={report} overrides={overrides} />
              <RuleChecks
                checks={report.ruleChecks}
                report={report}
                allDocuments={allDocuments}
                mid={selectedMerchant.mid}
                overrides={overrides}
                onSaveOverride={handleSaveOverride}
                onDeleteOverride={handleDeleteOverride}
              />
              <UnifiedTable
                rows={(report.unifiedRows || []).filter((row) => {
                  if (!['missing', 'mismatch', 'invalid'].includes(row.status)) return true;
                  return !overrides.some(
                    (ov) => ov.field_name === (row.field || '') && ov.document_source === (row.document || '—')
                  );
                })}
                allDocuments={allDocuments}
              />
              <DocumentChecksTable checks={report.documentChecks || []} overrides={overrides} allDocuments={allDocuments} />
            </>
          )}

          {!report && !loadingDetail && (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-text">No comparison report loaded. Click Run Analysis to generate one.</div>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <span className="card-title">
                <span className="card-title-accent" />
                Source Payloads
              </span>
            </div>
            <div className="card-body">
              <div className="verification-source-grid">
                <div className="form-group">
                  <label className="form-label">Google AI Document Extraction</label>
                  <textarea
                    className="form-control form-control--textarea verification-json-input"
                    value={documentJson}
                    readOnly
                    spellCheck="false"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">WebXPay System Data</label>
                  <textarea
                    className="form-control form-control--textarea verification-json-input"
                    value={systemJson}
                    readOnly
                    spellCheck="false"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
