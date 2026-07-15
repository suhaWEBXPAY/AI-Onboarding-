import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
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
  const document = issue.document || '';
  return overrides.some((ov) => sameDecisionTarget(field, document, ov.field_name, ov.document_source))
    || corrections.some((corr) => sameDecisionTarget(field, document, corr.field_name, corr.document_source));
};

const buildEffectiveDecision = (report, overrides = [], corrections = []) => {
  const decision = report?.onboardingDecision;
  if (!decision) return null;
  const originalBlocking = decision.blockingIssues || [];
  if (originalBlocking.length === 0) return decision;

  // Keep resolved issues around (flagged) so the UI can show them as solved
  // instead of silently dropping them from the report.
  const annotated = originalBlocking.map((issue) => ({
    ...issue,
    resolved: issueHasManualResolution(issue, overrides, corrections),
  }));
  const remainingBlocking = annotated.filter((issue) => !issue.resolved);
  const resolvedIssues = annotated.filter((issue) => issue.resolved);
  const resolvedCount = resolvedIssues.length;
  if (resolvedCount === 0) return decision;

  if (remainingBlocking.length === 0) {
    return {
      ...decision,
      canOnboard: true,
      outcome: 'eligible',
      headline: 'Eligible for onboarding',
      summary: `${resolvedCount} blocking issue(s) were resolved or ignored with reviewer action. This merchant is now eligible for onboarding based on the effective review state.`,
      blockingIssues: [],
      resolvedIssues,
      nextSteps: [],
      resolvedCount,
      effectiveReviewApplied: true,
    };
  }

  return {
    ...decision,
    canOnboard: false,
    outcome: 'blocked',
    headline: 'Onboarding blocked',
    summary: `Onboarding is still blocked by ${remainingBlocking.length} issue(s). ${resolvedCount} issue(s) were resolved or ignored with reviewer action.`,
    blockingIssues: remainingBlocking,
    resolvedIssues,
    nextSteps: [...new Set(remainingBlocking.map((issue) => issue.requiredAction).filter(Boolean))],
    resolvedCount,
    effectiveReviewApplied: true,
  };
};

const labelForEffectiveStatus = (status) => (
  status === 'verified' ? 'Verified'
    : status === 'caution' ? 'Caution'
      : status === 'review_required' ? 'Review required'
        : status
);

const applyEffectiveDecisionToReport = (report, overrides = [], corrections = []) => {
  if (!report) return report;
  const decision = buildEffectiveDecision(report, overrides, corrections);
  if (!decision) return report;
  const status = decision.canOnboard ? 'verified' : (report.status || 'review_required');
  const blockingCount = decision.blockingIssues?.length || 0;
  return {
    ...report,
    status,
    statusLabel: labelForEffectiveStatus(status),
    blockingCount,
    onboardingDecision: decision,
    ruleChecks: (report.ruleChecks || []).map((check) => (
      check.isVerdict
        ? {
          ...check,
          status: decision.canOnboard ? 'pass' : 'fail',
          detail: decision.canOnboard
            ? 'Eligible for onboarding after reviewer fixes/ignores.'
            : decision.summary,
        }
        : check
    )),
  };
};


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

// Inline editor for the AI value of one row — used when the AI misread a value
// and the reviewer corrects it manually.
function AiValueCell({ row, correction, onSave, onUndo }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const startEdit = () => {
    setDraft(row.aiValue && row.aiValue !== '—' && row.aiValue !== '(not found)' ? String(row.aiValue) : '');
    setEditing(true);
  };

  const save = async () => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    await onSave(row, draft.trim());
    setBusy(false);
    setEditing(false);
  };
  const displayValue = correction ? correction.new_value : row.aiValue;

  if (editing) {
    return (
      <td className="td-value">
        <div className="ai-value-edit-wrap">
          <input
            className="rule-override-comment-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); save(); }
              if (e.key === 'Escape') setEditing(false);
            }}
            placeholder="Correct value…"
            autoFocus
          />
          <div className="rule-override-input-actions">
            <button type="button" className="rule-override-confirm-btn" onClick={save} disabled={!draft.trim() || busy}>
              {busy ? '…' : 'Save'}
            </button>
            <button type="button" className="rule-override-cancel-btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      </td>
    );
  }

  return (
    <td className="td-value">
      <div className="ai-value-cell">
        <span>{formatCell(displayValue)}</span>
        {correction ? (
          <span className="ai-value-corrected" title={`Manually corrected${correction.corrected_by ? ` by ${correction.corrected_by}` : ''}${correction.old_value ? ` (AI read: ${correction.old_value})` : ''}`}>
            ✎ corrected
            <button type="button" className="ai-value-undo" onClick={() => onUndo(correction)} title="Remove this correction and restore the AI value">
              Undo
            </button>
          </span>
        ) : (
          <button type="button" className="ai-value-edit-btn" onClick={startEdit} title="Correct this AI-extracted value manually">
            ✎
          </button>
        )}
      </div>
    </td>
  );
}

function UnifiedTable({ rows = [], allDocuments = [], corrections = [], onSaveCorrection, onDeleteCorrection }) {
  const [filter, setFilter] = useState('all');
  const [viewerDoc, setViewerDoc] = useState(null);

  const correctionFor = (row) => corrections.find(
    (c) => c.field_name === (row.field || '') && (c.document_source || '') === (row.document || '')
  ) || null;
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
                  {onSaveCorrection
                    ? <AiValueCell row={row} correction={correctionFor(row)} onSave={onSaveCorrection} onUndo={onDeleteCorrection} />
                    : <td className="td-value">{formatCell(row.aiValue)}</td>}
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
  // Rows that carry their own remediation action (e.g. verdict blocking issues)
  // display it directly instead of a heuristic suggestion.
  if (item.solution) return item.solution;

  // "Failed to load" = the document download timed out during the AI run — the
  // file is uploaded and fine; re-uploading is the wrong advice.
  if (/failed to load|load failure|timed? ?out/i.test(String(item.comment || ''))) {
    return 'Re-run the analysis ("Re-extract Docs") — the document is already uploaded; the previous run hit a temporary download failure.';
  }

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

  // The verdict row expands into the justified blocking issues: what blocked,
  // the evidence values, the policy rule violated, and the required action.
  // Resolved/ignored issues stay listed (flagged) so the reviewer sees them solved.
  if (check.isVerdict) {
    const decision = report.onboardingDecision || {};
    return [...(decision.blockingIssues || []), ...(decision.resolvedIssues || [])].map((issue) => ({
      field:    issue.field,
      document: issue.document || '—',
      aiValue:  issue.documentValue || '—',
      apiValue: issue.systemValue || '—',
      comment:  `${issue.reason}${issue.policy ? ` ${issue.policy}` : ''}`,
      solution: issue.resolved ? '✓ Resolved — fixed or ignored by reviewer.' : issue.requiredAction,
      resolved: !!issue.resolved,
    }));
  }

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
  const isResolved = !!row.resolved;

  return (
    <tr className={isOverridden || isResolved ? 'rule-row-overridden' : ''}>
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
      <td className="rule-solution-cell" style={isOverridden || isResolved ? { color: 'var(--ash)', fontStyle: 'italic' } : {}}>
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
  // Verdict blocking issues mirror rows from the other rule checks — override
  // them there; the verdict table itself is read-only justification.
  const rowMid = check.isVerdict ? null : mid;

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
                  {rowMid && <th className="rule-action-col">Action</th>}
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
                    mid={rowMid}
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

// Narrative justification for the onboarding verdict: why the merchant was or
// wasn't onboarded, plus the concrete actions needed to unblock a rejection.
function OnboardingDecisionCard({ decision }) {
  if (!decision) return null;
  const blocked = !decision.canOnboard;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">
          <span className="card-title-accent" />
          Onboarding Decision
        </span>
        <span
          className={`unified-status-badge unified-status-badge--${blocked ? 'invalid' : 'success'}`}
          style={{ fontSize: 12 }}
        >
          {blocked ? '✕' : '✓'} {decision.headline}
        </span>
      </div>
      <div className="card-body">
        <p style={{ margin: '4px 0 10px', lineHeight: 1.55 }}>{decision.summary}</p>
        {decision.effectiveReviewApplied && (
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ash-2)' }}>
            Reviewer fixes/ignores are included in this effective decision.
          </p>
        )}
        {decision.resolvedIssues?.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div className="form-label" style={{ marginBottom: 6 }}>
              Resolved blocking issues ({decision.resolvedIssues.length})
            </div>
            <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
              {decision.resolvedIssues.map((issue, i) => (
                <li key={i} style={{ color: 'var(--ash)' }}>
                  <span className="unified-status-badge unified-status-badge--success" style={{ fontSize: 11, marginRight: 6 }}>✓ Solved</span>
                  <span style={{ textDecoration: 'line-through' }}>
                    {issue.field || issue.title}{issue.document ? ` — ${formatDocLabel(issue.document)}` : ''}
                  </span>
                  <span style={{ fontStyle: 'italic' }}> (fixed or ignored by reviewer)</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {blocked && decision.nextSteps?.length > 0 && (
          <>
            <div className="form-label" style={{ marginBottom: 6 }}>Required actions to unblock onboarding</div>
            <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
              {decision.nextSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </>
        )}
        {decision.policyNote && (
          <p style={{ marginTop: 10, fontSize: 12, color: 'var(--ash)' }}>{decision.policyNote}</p>
        )}
      </div>
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

const MATCH_TYPE_LABEL = {
  nic:      { label: 'NIC',            tone: 'danger' },
  passport: { label: 'Passport',      tone: 'danger' },
  name_dob: { label: 'Name + DOB',    tone: 'warn'   },
};

// Flags stakeholders (director/owner/partner) on this merchant who are ALSO
// registered under other businesses. Strong matches = NIC/passport; weak = name+DOB.
function StakeholderCrossCheckCard({ data, loading }) {
  if (loading) {
    return (
      <div className="card">
        <div className="card-header">
          <span className="card-title">
            <span className="card-title-accent" />
            Stakeholder Cross-Check
          </span>
        </div>
        <div className="empty-state"><div className="empty-state-text">Checking other businesses…</div></div>
      </div>
    );
  }

  if (!data) return null;
  const matches = data.matches || [];

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">
          <span className="card-title-accent" />
          Stakeholder Cross-Check
        </span>
        <span className={`unified-status-badge unified-status-badge--${matches.length ? 'danger' : 'success'}`} style={{ fontSize: 12 }}>
          {matches.length
            ? `⚠ ${matches.length} also in other businesses`
            : '✓ No overlap found'}
        </span>
      </div>

      {matches.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-text">
            None of this merchant's stakeholders are registered under another business.
          </div>
        </div>
      ) : (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Stakeholder</th>
                <th style={{ width: 130 }}>Matched On</th>
                <th>Also Registered In</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m, i) => {
                const cfg = MATCH_TYPE_LABEL[m.match_type] || { label: m.match_type, tone: 'sys' };
                return (
                  <tr key={`${m.identifier}-${i}`} className="unified-row unified-row--danger">
                    <td className="td-name">
                      {m.person?.name || '(unknown)'}
                      {m.person?.role && (
                        <div className="td-meta" style={{ fontSize: 11 }}>{m.person.role}</div>
                      )}
                      <div className="td-meta" style={{ fontSize: 11, color: 'var(--ash)' }}>{m.identifier}</div>
                    </td>
                    <td>
                      <span className={`unified-status-badge unified-status-badge--${cfg.tone}`} style={{ fontSize: 11 }}>
                        {cfg.label}
                      </span>
                    </td>
                    <td className="td-value">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {m.also_registered_in.map((b, j) => (
                          <span key={j}>
                            <strong>{b.business}</strong>
                            <span style={{ color: 'var(--ash)' }}> · MID {b.mid}{b.role ? ` · ${b.role}` : ''}{b.source ? ` (${b.source})` : ''}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Live progress indicator while an analysis runs. The backend is a single HTTP
// call (no streaming), so stages advance on realistic time heuristics with an
// honest elapsed clock — the last stage simply stays active until completion.
const ANALYSIS_STAGES = {
  extract: [
    { at: 0,  label: 'Fetching latest merchant data from WebXPay…' },
    { at: 6,  label: 'Downloading uploaded documents from storage…' },
    { at: 40, label: 'Google AI is reading the documents (OCR & extraction)…' },
    { at: 95, label: 'Cross-checking extracted data against the system record…' },
  ],
  verify: [
    { at: 0, label: 'Fetching latest merchant data from WebXPay…' },
    { at: 4, label: 'Cross-checking cached extraction against the system record…' },
  ],
};

function AnalysisProgress({ mode }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const stages = ANALYSIS_STAGES[mode] || ANALYSIS_STAGES.verify;
  const currentIdx = stages.reduce((acc, stage, i) => (elapsed >= stage.at ? i : acc), 0);
  const minutes = Math.floor(elapsed / 60);
  const seconds = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="analysis-progress">
      <div className="analysis-progress-top">
        <span className="analysis-spinner" />
        <span className="analysis-progress-title">
          {mode === 'extract' ? 'Re-extracting documents with Google AI' : 'Sync & Verify in progress'}
        </span>
        <span className="analysis-progress-elapsed">{minutes}:{seconds}</span>
      </div>
      <ul className="analysis-progress-steps">
        {stages.map((stage, i) => (
          <li
            key={stage.label}
            className={`analysis-step ${i < currentIdx ? 'analysis-step--done' : i === currentIdx ? 'analysis-step--active' : 'analysis-step--pending'}`}
          >
            <span className="analysis-step-mark">{i < currentIdx ? '✓' : i === currentIdx ? '●' : '○'}</span>
            {stage.label}
          </li>
        ))}
      </ul>
      <div className="analysis-progress-note">
        {mode === 'extract'
          ? 'A fresh AI extraction typically takes 1–3 minutes; large documents on slow connections can take longer. You can stay on this page — results appear automatically.'
          : 'This usually finishes in under 30 seconds.'}
      </div>
    </div>
  );
}

// Browse & open every document the merchant uploaded, directly in the UI.
function UploadedDocumentsCard({ documents = [], onView }) {
  if (!documents.length) return null;

  // The same physical file is listed under multiple sources (e.g. bank statement
  // under signup_document AND bank_account) — show each file once.
  const seen = new Set();
  const uniqueDocs = documents.filter((doc) => {
    const key = String(doc.url || doc.path || doc.label || '').split('?')[0];
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">
          <span className="card-title-accent" />
          Uploaded Documents
        </span>
        <span className="card-badge">{uniqueDocs.length} file{uniqueDocs.length === 1 ? '' : 's'}</span>
      </div>
      <div className="uploaded-docs-grid">
        {uniqueDocs.map((doc, i) => {
          const label = String(doc.label || doc.document_name || 'Document').replace(/_/g, ' ');
          const isPdf = String(doc.url || doc.path || '').split('?')[0].toLowerCase().endsWith('.pdf');
          return (
            <button
              key={`${label}-${i}`}
              type="button"
              className="uploaded-doc-tile"
              onClick={() => onView(doc)}
              title={`View ${label}`}
            >
              <span className="uploaded-doc-icon">
                {isPdf ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                  </svg>
                )}
              </span>
              <span className="uploaded-doc-label">{label}</span>
              {doc.source && <span className="uploaded-doc-source">{String(doc.source).replace(/_/g, ' ')}</span>}
              <span className="uploaded-doc-open">View →</span>
            </button>
          );
        })}
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

// webxpayTotal comes from the last UNFILTERED list load — using the current list
// meta would corrupt the Total/Remaining cards as soon as a filter is active.
function DashboardStats({ stats, webxpayTotal, activeFilter, onFilter }) {
  const getValue = (key) => {
    if (key === null) return webxpayTotal ?? stats?.total ?? null;
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
function ReviewStatusControl({ status, isOverridden, onSet, busy, verifyBlocked }) {
  const OPTIONS = ['verified', 'caution', 'review'];
  return (
    <div className="ma-status-control">
      <span className="form-label" style={{ marginBottom: 0 }}>Onboarding status</span>
      <div className="ma-status-seg">
        {OPTIONS.map((key) => {
          const cfg = ONBOARD_STATUS[key];
          const active = status === key;
          const blockedVerify = key === 'verified' && verifyBlocked;
          return (
            <button
              key={key}
              type="button"
              className={`ma-status-seg-btn ma-status-seg-btn--${cfg.tone}${active ? ' is-active' : ''}`}
              onClick={() => onSet(key)}
              disabled={busy || active || blockedVerify}
              title={blockedVerify
                ? 'Cannot mark as Verified while blocking issues are unresolved — fix or ignore each one first.'
                : `Mark this merchant as ${cfg.label}`}
            >
              {cfg.symbol} {cfg.label}
            </button>
          );
        })}
      </div>
      {verifyBlocked && (
        <span className="ma-status-origin" style={{ color: 'var(--ash)' }}>
          Verified is locked until every blocking issue is fixed or ignored.
        </span>
      )}
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

function MerchantTable({ merchants, loading, meta, page, onPageChange, onSelect, processingMids }) {
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
              const isProcessing = processingMids?.has(Number(merchant.mid));
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
                    {isProcessing
                      ? <span
                          className="unified-status-badge unified-status-badge--sys"
                          style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                          title="Auto-run is analyzing this merchant right now"
                        >
                          <span className="docs-spinner" style={{ width: 10, height: 10 }} /> Processing…
                        </span>
                      : !statusCfg
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
  const [corrections, setCorrections] = useState([]);
  const [stakeholderDupes, setStakeholderDupes] = useState(null);
  const [loadingDupes, setLoadingDupes] = useState(false);
  const [dashStats, setDashStats] = useState(null);
  const [webxpayTotal, setWebxpayTotal] = useState(null);
  const [activeFilter, setActiveFilter] = useState(null);
  const [loadingMerchants, setLoadingMerchants] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [running, setRunning] = useState(false);
  const [runningMode, setRunningMode] = useState('verify');
  const [viewerDoc, setViewerDoc] = useState(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoRunStatus, setAutoRunStatus] = useState(null);
  const autoRunResultsCount = useRef(0);
  const autoRunStopRequested = useRef(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const searchTimer = useRef(null);
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const allDocuments = useMemo(() => {
    if (!systemJson) return [];
    try {
      const parsed = typeof systemJson === 'string' ? JSON.parse(systemJson) : systemJson;
      return parsed?.data?.all_documents || [];
    } catch { return []; }
  }, [systemJson]);

  const effectiveReport = useMemo(
    () => applyEffectiveDecisionToReport(report, overrides, corrections),
    [report, overrides, corrections]
  );

  // MIDs the background auto-run is analyzing right now — rows show a spinner.
  const processingMids = useMemo(
    () => new Set((autoRunning ? autoRunStatus?.currentMids || [] : []).map(Number)),
    [autoRunning, autoRunStatus]
  );

  const loadDashStats = useCallback(async () => {
    try {
      const { data } = await api.get('/onboard-verification/dashboard-stats');
      setDashStats(data);
    } catch { /* silent — dashboard is non-critical */ }
  }, []);

  const listParams = useRef({ query: '', pg: 1, filter: '' });

  const loadMerchants = useCallback(async (query, pg, filter = '') => {
    listParams.current = { query, pg, filter };
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
      // Only the unfiltered list reflects the full WebXPay merchant count.
      if (!filter && data.meta?.total != null) setWebxpayTotal(data.meta.total);
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Failed to load merchants.', type: 'error' });
    } finally {
      setLoadingMerchants(false);
    }
  }, []);

  // Re-fetch the list exactly as the user currently sees it (same search/page/filter).
  const reloadList = useCallback(() => {
    const { query, pg, filter } = listParams.current;
    loadMerchants(query, pg, filter);
  }, [loadMerchants]);

  // After any reviewer action (ignore/undo/correction), the backend recomputes
  // the persisted verdict — pull it back so the header badge, the list row's
  // Status column, and the dashboard cards all reflect the new effective state.
  const refreshMerchantStatus = useCallback(async (mid) => {
    try {
      const latest = await api.get(`/onboard-verification/latest-analysis/${encodeURIComponent(mid)}`);
      const latestData = latest.data || {};
      setSelectedMerchant((prev) => (prev && Number(prev.mid) === Number(mid)
        ? {
          ...prev,
          satisfaction_score: latestData.satisfaction_score ?? prev.satisfaction_score,
          can_onboard: latestData.can_onboard ?? prev.can_onboard,
          computed_status: latestData.computed_status ?? prev.computed_status,
          review_status: latestData.review_status ?? null,
          effective_status: latestData.effective_status ?? latestData.review_status ?? latestData.computed_status ?? prev.effective_status,
        }
        : prev));
      setMerchants((prev) => prev.map((m) => (
        Number(m.mid) === Number(mid)
          ? {
            ...m,
            satisfaction_score: latestData.satisfaction_score ?? m.satisfaction_score,
            can_onboard: latestData.can_onboard ?? m.can_onboard,
            computed_status: latestData.computed_status ?? m.computed_status,
            review_status: latestData.review_status ?? null,
            effective_status: latestData.effective_status ?? latestData.review_status ?? latestData.computed_status ?? m.effective_status,
          }
          : m
      )));
    } catch { /* best-effort — the detail view still shows the client-side effective state */ }
    loadDashStats();
  }, [loadDashStats]);

  const loadMerchantDetail = async (merchant) => {
    if (!merchant?.mid) return;
    setSelectedMerchant(merchant);
    setReport(null);
    setDocumentJson('');
    setSystemJson('');
    setCorrections([]);
    setStakeholderDupes(null);
    setMessage({ text: '', type: '' });
    setLoadingDetail(true);

    // Cross-business stakeholder check — runs independently; the first call may
    // build the server-side index, so it can take a moment.
    setLoadingDupes(true);
    api.get(`/onboard-verification/duplicate-stakeholders/${encodeURIComponent(merchant.mid)}`)
      .then(({ data }) => setStakeholderDupes(data))
      .catch(() => setStakeholderDupes({ matches: [] }))
      .finally(() => setLoadingDupes(false));

    // Always fetch DB merchant info so type/channel/name are populated even on direct MID search
    const needsDbInfo = !merchant.merchant_type_name || !merchant.merchant_channel;

    const [analysisResult, systemResult, merchantInfoResult, overridesResult, correctionsResult] = await Promise.allSettled([
      api.get(`/onboard-verification/latest-analysis/${encodeURIComponent(merchant.mid)}`),
      api.get(`/onboard-verification/external-merchant/${encodeURIComponent(merchant.mid)}`),
      needsDbInfo
        ? api.get(`/onboard-verification/merchant/${encodeURIComponent(merchant.mid)}`)
        : Promise.resolve(null),
      api.get(`/onboard-verification/rule-overrides/${encodeURIComponent(merchant.mid)}`),
      api.get(`/onboard-verification/extraction-corrections/${encodeURIComponent(merchant.mid)}`),
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
    setCorrections(
      correctionsResult.status === 'fulfilled' && Array.isArray(correctionsResult.value.data)
        ? correctionsResult.value.data
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
    setCorrections([]);
    setStakeholderDupes(null);
    setMessage({ text: '', type: '' });
  };

  const runAnalysis = async (forceReExtract = false) => {
    if (!selectedMerchant?.mid) return;

    setRunning(true);
    setRunningMode(forceReExtract ? 'extract' : 'verify');
    setMessage({ text: '', type: '' });
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
      try {
        const { data: corr } = await api.get(`/onboard-verification/extraction-corrections/${encodeURIComponent(selectedMerchant.mid)}`);
        setCorrections(Array.isArray(corr) ? corr : []);
      } catch { setCorrections([]); }
      // The persisted verdict may differ from report.status once reviewer
      // ignores/corrections are applied server-side — sync from the DB.
      await refreshMerchantStatus(selectedMerchant.mid);
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

  const patchReportRow = useCallback((row, newAiValue) => {
    setReport((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        unifiedRows: (prev.unifiedRows || []).map((r) => (
          r.field === (row.field || '') && (r.document || '') === (row.document || '')
            ? { ...r, aiValue: newAiValue }
            : r
        )),
      };
    });
  }, []);

  const handleSaveCorrection = useCallback(async (row, newValue) => {
    if (!selectedMerchant?.mid) return;
    try {
      const { data } = await api.post('/onboard-verification/extraction-corrections', {
        mid: selectedMerchant.mid,
        field_name: row.field || '',
        document_source: row.document || '',
        old_value: row.aiValue === '—' ? null : row.aiValue,
        new_value: newValue,
      });
      setCorrections(Array.isArray(data) ? data : []);
      patchReportRow(row, newValue);
      await refreshMerchantStatus(selectedMerchant.mid);
      setMessage({ text: `"${row.field}" corrected. Click Sync & Verify to refresh the full report.`, type: 'success' });
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Failed to save correction.', type: 'error' });
    }
  }, [selectedMerchant, patchReportRow, refreshMerchantStatus]);

  const handleDeleteCorrection = useCallback(async (correction) => {
    if (!selectedMerchant?.mid || !correction?.id) return;
    try {
      const { data } = await api.delete(`/onboard-verification/extraction-corrections/${correction.id}?mid=${encodeURIComponent(selectedMerchant.mid)}`);
      setCorrections(Array.isArray(data) ? data : []);
      if (correction.old_value != null) {
        patchReportRow({ field: correction.field_name, document: correction.document_source }, correction.old_value);
      }
      await refreshMerchantStatus(selectedMerchant.mid);
      setMessage({ text: 'Correction removed. Click Sync & Verify to refresh the full report.', type: 'success' });
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Failed to remove correction.', type: 'error' });
    }
  }, [selectedMerchant, patchReportRow, refreshMerchantStatus]);

  const triggerAutoRun = async () => {
    // Analyzing a merchant costs AI budget — confirm before launching a big batch.
    const remainingCount = webxpayTotal != null && dashStats?.analyzed != null
      ? Math.max(0, webxpayTotal - dashStats.analyzed)
      : dashStats?.remaining;
    if (remainingCount > 0 && !window.confirm(
      `Auto-run will analyze ${remainingCount.toLocaleString()} pending merchant(s) with AI. This may take a long time and consume AI budget. Continue?`
    )) return;

    setAutoRunning(true);
    setMessage({ text: 'Triggering auto-analysis for pending merchants...', type: '' });
    try {
      const response = await api.post('/onboard-verification/auto-run');
      const { message: serverMsg, running } = response.data;
      setMessage({
        text: serverMsg || (running ? 'Auto-run started in background.' : 'Done.'),
        type: 'success',
      });
      loadDashStats();
      // Leave autoRunning true — the polling effect below tracks the background
      // run and flips it off (with a final refresh) when the run completes.
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Auto-run failed.', type: 'error' });
      setAutoRunning(false);
    }
  };

  const stopAutoRun = async () => {
    try {
      const { data } = await api.post('/onboard-verification/auto-run/stop');
      autoRunStopRequested.current = true;
      setAutoRunStatus(data);
      setMessage({ text: data.message, type: 'success' });
      // Polling keeps going until the in-flight analyses drain and running=false.
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Failed to stop the auto-run.', type: 'error' });
    }
  };

  // While an auto-run is active, poll its status so the UI can show which
  // merchants are being processed and refresh rows/stats as verdicts land.
  useEffect(() => {
    if (!autoRunning) return undefined;
    let cancelled = false;
    let timer = null;

    const tick = async () => {
      try {
        const { data } = await api.get('/onboard-verification/auto-run-status');
        if (cancelled) return;
        setAutoRunStatus(data);

        const completed = (data.results || []).length;
        if (completed !== autoRunResultsCount.current) {
          autoRunResultsCount.current = completed;
          loadDashStats();
          reloadList();
        }

        if (!data.running) {
          setAutoRunning(false);
          const ok = (data.results || []).filter((r) => r.status === 'success').length;
          const bad = (data.results || []).filter((r) => r.status === 'error').length;
          const stopped = autoRunStopRequested.current;
          autoRunStopRequested.current = false;
          setMessage({
            text: `Auto-run ${stopped ? 'stopped' : 'complete'}: ${ok} analyzed${bad ? `, ${bad} failed` : ''}${stopped ? ', remaining merchants skipped' : ''}.`,
            type: bad ? 'error' : 'success',
          });
          loadDashStats();
          reloadList();
          return;
        }
      } catch { /* transient — keep polling */ }
      timer = setTimeout(tick, 4000);
    };

    tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [autoRunning, loadDashStats, reloadList]);

  // If an auto-run is already in progress when the page opens (started earlier or
  // by the daily cron), resume showing its progress instead of appearing idle.
  useEffect(() => {
    api.get('/onboard-verification/auto-run-status')
      .then(({ data }) => {
        setAutoRunStatus(data);
        if (data.running) {
          autoRunResultsCount.current = (data.results || []).length;
          setAutoRunning(true);
        }
      })
      .catch(() => { /* status is cosmetic */ });
  }, []);

  const handleSaveOverride = useCallback(async (overrideData) => {
    if (!selectedMerchant?.mid) return;
    try {
      const { data } = await api.post('/onboard-verification/rule-overrides', {
        mid: selectedMerchant.mid,
        ...overrideData,
      });
      setOverrides(Array.isArray(data) ? data : []);
      await refreshMerchantStatus(selectedMerchant.mid);
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Failed to save override.', type: 'error' });
    }
  }, [selectedMerchant, refreshMerchantStatus]);

  const handleDeleteOverride = useCallback(async (id) => {
    if (!selectedMerchant?.mid) return;
    try {
      const { data } = await api.delete(`/onboard-verification/rule-overrides/${id}?mid=${encodeURIComponent(selectedMerchant.mid)}`);
      setOverrides(Array.isArray(data) ? data : []);
      await refreshMerchantStatus(selectedMerchant.mid);
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Failed to remove override.', type: 'error' });
    }
  }, [selectedMerchant, refreshMerchantStatus]);

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

  // Deep link from the navbar's stakeholder cross-business alert bell: ?mid=XXXX
  // opens that merchant's detail view directly, without requiring a manual search.
  useEffect(() => {
    const midParam = searchParams.get('mid');
    if (!midParam) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('mid');
      return next;
    }, { replace: true });
    loadMerchantDetail({ mid: midParam });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
          title="Analyze every merchant that has no completed verdict yet (Pending status)"
        >
          {autoRunning
            ? (autoRunStatus?.progress?.total
              ? `Running… ${autoRunStatus.progress.done}/${autoRunStatus.progress.total}`
              : 'Running…')
            : 'Auto-Run'}
        </button>
        {autoRunning && (
          <button
            className="btn btn-secondary"
            type="button"
            onClick={stopAutoRun}
            disabled={autoRunStatus?.stopping}
            title="Stop the auto-run — analyses already in progress finish, queued merchants are skipped"
            style={{ color: 'var(--danger, #b91c1c)' }}
          >
            {autoRunStatus?.stopping ? 'Stopping…' : '■ Stop'}
          </button>
        )}
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
            webxpayTotal={webxpayTotal}
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
            processingMids={processingMids}
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
                const eff = selectedMerchant.review_status
                  ? effectiveStatusOf(selectedMerchant)
                  : (normalizeOnboardStatus(effectiveReport?.status) || effectiveStatusOf(selectedMerchant));
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

              {effectiveReport && (
                <ReviewStatusControl
                  status={selectedMerchant.review_status
                    ? effectiveStatusOf(selectedMerchant)
                    : (normalizeOnboardStatus(effectiveReport?.status) || effectiveStatusOf(selectedMerchant))}
                  isOverridden={Boolean(selectedMerchant.review_status)}
                  onSet={handleSetReviewStatus}
                  busy={statusBusy}
                  verifyBlocked={Boolean(effectiveReport?.onboardingDecision && !effectiveReport.onboardingDecision.canOnboard)}
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

              {running && <AnalysisProgress mode={runningMode} />}
            </div>
          </div>

          {viewerDoc && <DocViewerModal doc={viewerDoc} onClose={() => setViewerDoc(null)} />}

          <StakeholderCrossCheckCard data={stakeholderDupes} loading={loadingDupes} />

          {effectiveReport && (
            <>
              <VerificationSummary report={effectiveReport} overrides={overrides} />
              <OnboardingDecisionCard decision={effectiveReport.onboardingDecision} />
              <RuleChecks
                checks={effectiveReport.ruleChecks}
                report={effectiveReport}
                allDocuments={allDocuments}
                mid={selectedMerchant.mid}
                overrides={overrides}
                onSaveOverride={handleSaveOverride}
                onDeleteOverride={handleDeleteOverride}
              />
              <UnifiedTable
                rows={(effectiveReport.unifiedRows || []).filter((row) => {
                  if (!['missing', 'mismatch', 'invalid'].includes(row.status)) return true;
                  return !overrides.some(
                    (ov) => ov.field_name === (row.field || '') && ov.document_source === (row.document || '—')
                  );
                })}
                allDocuments={allDocuments}
                corrections={corrections}
                onSaveCorrection={handleSaveCorrection}
                onDeleteCorrection={handleDeleteCorrection}
              />
              <DocumentChecksTable checks={effectiveReport.documentChecks || []} overrides={overrides} allDocuments={allDocuments} />
              <UploadedDocumentsCard documents={allDocuments} onView={setViewerDoc} />
            </>
          )}

          {!report && !loadingDetail && (
            <div className="card">
              <div className="empty-state">
                <div className="empty-state-text">No comparison report loaded. Click Run Analysis to generate one.</div>
              </div>
            </div>
          )}

          {/* Without a report there is no Document Validity section — still let
              the reviewer browse the uploads. */}
          {!report && <UploadedDocumentsCard documents={allDocuments} onView={setViewerDoc} />}

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
