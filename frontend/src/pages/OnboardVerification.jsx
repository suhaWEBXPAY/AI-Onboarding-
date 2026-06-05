import { useCallback, useEffect, useMemo, useState } from 'react';
import PageLayout from '../components/PageLayout';
import api from '../services/api';

const FORM_INIT = { mid: '', merchant_channel: 'IPG', merchant_type_id: '' };

const WEBXPAY_TYPE_KEYWORDS = { 1: 'private', 2: 'proprietor', 3: 'partnership', 4: 'society', 5: 'individual' };

const asPrettyJson = (value) => JSON.stringify(value, null, 2);

const coerceJsonValue = (value) => {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
};

const parseJson = (value, label) => {
  if (!value.trim()) throw new Error(`${label} is required.`);
  try { return JSON.parse(value); } catch { throw new Error(`${label} must be valid JSON.`); }
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
  ? new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
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

const normalizeLabel = (s) => String(s || '').toLowerCase().replace(/[\s_\-./]+/g, '');

const findDocByLabel = (documentType, allDocuments) => {
  if (!documentType || documentType === '—' || !allDocuments?.length) return null;
  const needle = normalizeLabel(documentType);
  return allDocuments.find((doc) => {
    const hay = normalizeLabel(doc.label || doc.document_type || doc.type || doc.name || '');
    return hay === needle || hay.includes(needle) || needle.includes(hay);
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
          {isPdf
            ? <iframe src={url} className="doc-viewer-iframe" title={doc.label || 'Document'} />
            : <img src={url} alt={doc.label || 'Document'} className="doc-viewer-image" />}
        </div>
      </div>
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

const toDisplayRow = (r) => ({
  field:    r.field,
  document: r.document || r.source || '—',
  aiValue:  r.documentValue ?? r.value ?? '—',
  apiValue: r.systemValue ?? '—',
  comment:  r.reason || r.rule || '—',
});

const getSolution = (item, ruleKey) => {
  const field   = item.field    || 'this field';
  const doc     = (item.document && item.document !== '—') ? item.document : null;
  const comment = String(item.comment || '').toLowerCase();
  const aiVal   = String(item.aiValue  || '');
  const apiVal  = String(item.apiValue || '');

  if (ruleKey === 'missing') {
    if ((aiVal.includes('not found') || aiVal === '—') && doc)
      return `Upload the "${doc}" document. It is mandatory and was not found during extraction.`;
    if (apiVal && apiVal !== '—')
      return `The system shows "${apiVal}" for "${field}" but the document value is absent. Ensure the document clearly states this field.`;
    return `Provide "${field}"${doc ? ` in the ${doc}` : ''}. It is required for onboarding.`;
  }
  if (ruleKey === 'invalid') {
    if (comment.includes('expir'))
      return `Renew the ${doc || 'document'} — "${field}" appears to be expired.`;
    if (comment.includes('format') || comment.includes('invalid format'))
      return `Correct the format of "${field}"${doc ? ` in ${doc}` : ''}.`;
    return `Review "${field}"${doc ? ` in ${doc}` : ''} — it failed a validity check.`;
  }
  if (ruleKey === 'mismatch')
    return `Reconcile "${field}": document says "${aiVal}" but the system has "${apiVal}". Correct whichever source is wrong before approving.`;
  if (ruleKey === 'ai_prompt') {
    if (comment.includes('missing') || comment.includes('not found') || comment.includes('required'))
      return `Obtain and upload the "${field}" document. Google AI flagged it as required but missing.`;
    return `Investigate the Google AI concern for "${field}". Correct the document or system data as appropriate.`;
  }
  if (ruleKey === 'source_gap') {
    if (!apiVal || apiVal === '—')
      return `"${field}" was extracted from documents but has no system counterpart. Verify manually.`;
    return `"${field}" exists in the system (${apiVal}) but was not captured from documents.`;
  }
  return 'Review this issue and correct the document or system data before approving.';
};

const getRuleItems = (check, report) => {
  if (!report) return [];
  const rows = report.unifiedRows || [];
  const key = RULE_STATUS_MAP[check.name];
  if (key === 'missing') {
    const fromUnified = rows.filter((r) => r.status === 'missing');
    return fromUnified.length > 0 ? fromUnified : (report.missingData || []).map(toDisplayRow);
  }
  if (key === 'mismatch') {
    const fromUnified = rows.filter((r) => r.status === 'mismatch');
    return fromUnified.length > 0 ? fromUnified : (report.mismatches || []).map(toDisplayRow);
  }
  if (key === 'invalid') {
    const raw = report.invalidData || [];
    if (raw.length > 0) return raw.map(toDisplayRow);
    return rows.filter((r) => r.status === 'invalid');
  }
  if (key === 'source_gap')
    return rows.filter((r) => r.status === 'doc_only' || r.status === 'api_only');
  if (key === 'ai_prompt') {
    return [
      ...(report.missingData  || []),
      ...(report.invalidData  || []),
      ...(report.mismatches   || []),
    ].filter((r) => String(r.category || '').startsWith('ai_')).map(toDisplayRow);
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

function DataPanel({ title, subtitle, iconBg, icon, value, onChange, loading, emptyHint }) {
  const hasData = !loading && value && value.trim();
  return (
    <div className="vi-data-panel">
      <div className="vi-data-panel-header">
        <div className="vi-data-panel-icon" style={{ background: iconBg }}>
          {icon}
        </div>
        <div>
          <div className="vi-data-panel-title">{title}</div>
          <div className="vi-data-panel-sub">{subtitle}</div>
        </div>
        {loading && <span className="vi-data-panel-loading">fetching…</span>}
      </div>
      <div className="vi-data-panel-body">
        {!hasData ? (
          <div className="vi-data-panel-empty">
            <div className="vi-data-panel-empty-icon" style={{ color: iconBg === '#EDE9FE' ? '#7C3AED' : '#059669' }}>
              {icon}
            </div>
            <p className="vi-data-panel-empty-text">Enter MID and press Enter, or Load Data</p>
            <p className="vi-data-panel-empty-hint">{emptyHint}</p>
          </div>
        ) : (
          <textarea
            className="vi-data-panel-textarea"
            value={loading ? '' : value}
            onChange={onChange}
            spellCheck="false"
            disabled={loading}
          />
        )}
      </div>
    </div>
  );
}

function UnifiedTable({ rows = [], allDocuments = [] }) {
  const [filter, setFilter] = useState('all');
  const [viewerDoc, setViewerDoc] = useState(null);
  const filtered = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  const counts = FILTER_OPTIONS.reduce((acc, opt) => {
    acc[opt.key] = opt.key === 'all' ? rows.length : rows.filter((r) => r.status === opt.key).length;
    return acc;
  }, {});

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title"><span className="card-title-accent" />Verification Results</span>
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
                  <div className="empty-state"><div className="empty-state-text">No rows match this filter.</div></div>
                </td>
              </tr>
            ) : filtered.map((row, i) => {
              const cfg = STATUS_CONFIG[row.status] || { label: row.status, tone: 'neutral', symbol: '' };
              const matchedDoc = findDocByLabel(row.document, allDocuments);
              const ruleKey = { mismatch: 'mismatch', missing: 'missing', invalid: 'invalid', doc_only: 'source_gap', api_only: 'source_gap' }[row.status];
              return (
                <tr key={i} className={`unified-row unified-row--${cfg.tone}`}>
                  <td className="td-name">{formatCell(row.field)}</td>
                  <td className="td-meta">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>{formatDocLabel(row.document)}</span>
                      {matchedDoc && (
                        <button type="button" className="btn-doc-open" onClick={() => setViewerDoc(matchedDoc)}
                          title={`Open ${matchedDoc.label || row.document}`}>View</button>
                      )}
                    </div>
                  </td>
                  <td className="td-value">{formatCell(row.aiValue)}</td>
                  <td className="td-value">{formatCell(row.apiValue)}</td>
                  <td>
                    <span className={`unified-status-badge unified-status-badge--${cfg.tone}`}>
                      <span style={{ opacity: 0.75, fontStyle: 'normal' }}>{cfg.symbol}</span>
                      {cfg.label}
                      {row.nearMatch && <span className="near-match-star" title="Partial match">★</span>}
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

function RuleChecks({ checks = [], report, allDocuments = [], mid, overrides = [], onSaveOverride, onDeleteOverride }) {
  if (!checks.length) return null;
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title"><span className="card-title-accent" />Rule Checks</span>
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

export default function OnboardVerification() {
  const [form, setForm] = useState(FORM_INIT);
  const [autoFilled, setAutoFilled] = useState(false);
  const [merchantTypes, setMerchantTypes] = useState([]);
  const [typesLoading, setTypesLoading] = useState(true);
  const [documentJson, setDocumentJson] = useState('');
  const [systemJson, setSystemJson] = useState('');
  const [fetchingDoc, setFetchingDoc] = useState(false);
  const [fetchingSys, setFetchingSys] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [overrides, setOverrides] = useState([]);

  const loadOverrides = useCallback(async (mid) => {
    if (!mid) { setOverrides([]); return; }
    try {
      const res = await api.get(`/onboard-verification/rule-overrides/${encodeURIComponent(mid)}`);
      setOverrides(res.data || []);
    } catch {
      setOverrides([]);
    }
  }, []);

  const handleSaveOverride = useCallback(async (overrideData) => {
    const mid = form.mid.trim();
    if (!mid) return;
    try {
      const res = await api.post('/onboard-verification/rule-overrides', { mid, ...overrideData });
      setOverrides(res.data || []);
    } catch {
      setMessage({ text: 'Failed to save override.', type: 'error' });
    }
  }, [form.mid]);

  const handleDeleteOverride = useCallback(async (id) => {
    const mid = form.mid.trim();
    try {
      const res = await api.delete(`/onboard-verification/rule-overrides/${id}?mid=${encodeURIComponent(mid)}`);
      setOverrides(res.data || []);
    } catch {
      setMessage({ text: 'Failed to remove override.', type: 'error' });
    }
  }, [form.mid]);

  useEffect(() => {
    api.get('/merchant-types')
      .then((res) => setMerchantTypes(res.data))
      .catch(() => setMessage({ text: 'Failed to load merchant types.', type: 'error' }))
      .finally(() => setTypesLoading(false));
  }, []);

  const selectedMerchantType = useMemo(
    () => merchantTypes.find((type) => String(type.id) === String(form.merchant_type_id)),
    [merchantTypes, form.merchant_type_id]
  );

  const handleRunVerification = async (event) => {
    event.preventDefault();
    setMessage({ text: '', type: '' });
    if (!form.merchant_type_id) {
      setMessage({ text: 'Merchant type is required.', type: 'error' });
      return;
    }
    let documentData, systemData;
    try {
      documentData = parseJson(documentJson, 'Google AI document extraction data');
      systemData = parseJson(systemJson, 'External system API data');
    } catch (err) {
      setMessage({ text: err.message, type: 'error' });
      return;
    }
    setLoading(true);
    try {
      const response = await api.post('/onboard-verification/verify-data', {
        mid: form.mid.trim() || null,
        merchant_type_id: form.merchant_type_id,
        merchant_channel: form.merchant_channel,
        documentData,
        systemData,
      });
      setResult(response.data);
      setMessage({ text: 'Verification completed.', type: 'success' });
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Verification failed.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const clearPayloads = () => {
    setDocumentJson('');
    setSystemJson('');
    setResult(null);
    setMessage({ text: '', type: '' });
    setAutoFilled(false);
    setOverrides([]);
  };

  const fetchAllForMid = async (mid) => {
    if (!mid) { setMessage({ text: 'Enter a MID to load data.', type: 'error' }); return; }
    setMessage({ text: '', type: '' });
    setFetchingDoc(true);
    setFetchingSys(true);

    const [docResult, sysResult] = await Promise.allSettled([
      api.get(`/onboard-verification/latest-analysis/${encodeURIComponent(mid)}`),
      api.get(`/onboard-verification/external-merchant/${encodeURIComponent(mid)}`),
    ]);

    if (docResult.status === 'fulfilled') {
      const extracted = coerceJsonValue(docResult.value.data?.extracted_json);
      const validation = coerceJsonValue(docResult.value.data?.validation_json);
      setDocumentJson(extracted ? asPrettyJson(extracted) : '');
      if (validation && typeof validation === 'object') setResult(validation);
      else setResult(null);
    } else {
      const status = docResult.reason?.response?.status;
      setDocumentJson('');
      setMessage({ text: status === 404 ? 'No Google AI analysis found for this MID. Run document verification first.' : 'Failed to load document data.', type: 'error' });
    }
    setFetchingDoc(false);

    if (sysResult.status === 'fulfilled') {
      const sysData = sysResult.value.data;
      setSystemJson(asPrettyJson(sysData));
      const typeId = sysData?.data?.business_type?.type_of_business_id;
      const keyword = WEBXPAY_TYPE_KEYWORDS[Number(typeId)];
      const matchedType = keyword ? merchantTypes.find((t) => t.name.toLowerCase().includes(keyword)) : null;
      const ipg = Number(sysData?.data?.signup?.ipg_merchant);
      const pos = Number(sysData?.data?.signup?.pos_merchant);
      const channel = (ipg && pos) ? 'IPG & POS' : (pos ? 'POS' : 'IPG');
      setForm((prev) => ({ ...prev, merchant_channel: channel, ...(matchedType ? { merchant_type_id: String(matchedType.id) } : {}) }));
      setAutoFilled(true);
    } else {
      setSystemJson('');
      setMessage((prev) => ({
        text: prev.text ? `${prev.text} Also failed to fetch WebXPay data.` : (sysResult.reason?.response?.data?.message || 'Failed to fetch WebXPay data.'),
        type: 'error',
      }));
    }
    setFetchingSys(false);

    if (docResult.status === 'fulfilled' && sysResult.status === 'fulfilled') {
      setMessage({ text: `Data loaded for MID ${mid}.`, type: 'success' });
    }
    loadOverrides(mid);
  };

  const handleMidKeyDown = (event) => {
    if (event.key === 'Enter') { event.preventDefault(); fetchAllForMid(form.mid.trim()); }
  };

  const handleMidBlur = () => { if (form.mid.trim()) fetchAllForMid(form.mid.trim()); };

  const runAnalysis = async (forceReExtract = false) => {
    const mid = form.mid.trim();
    if (!mid) { setMessage({ text: 'Enter a MID before running analysis.', type: 'error' }); return; }
    setAnalysing(true);
    setMessage({
      text: forceReExtract
        ? 'Re-extracting documents with AI — this may take 30–60 seconds...'
        : 'Running AI document analysis — this may take 30–60 seconds...',
      type: '',
    });
    try {
      const response = await api.post(`/onboard-verification/verify-mid/${encodeURIComponent(mid)}`, {
        merchant_type_id: form.merchant_type_id || undefined,
        merchant_channel: form.merchant_channel,
        forceReExtract: forceReExtract || undefined,
      });
      setDocumentJson(asPrettyJson(response.data.documentData));
      setSystemJson(asPrettyJson(response.data.systemData));
      setResult(response.data.report);
      const sysData = response.data.systemData;
      const typeId = sysData?.data?.business_type?.type_of_business_id;
      const keyword = WEBXPAY_TYPE_KEYWORDS[Number(typeId)];
      const matchedType = keyword ? merchantTypes.find((t) => t.name.toLowerCase().includes(keyword)) : null;
      const ipg = Number(sysData?.data?.signup?.ipg_merchant);
      const pos = Number(sysData?.data?.signup?.pos_merchant);
      const channel = (ipg && pos) ? 'IPG & POS' : (pos ? 'POS' : 'IPG');
      setForm((prev) => ({ ...prev, merchant_channel: channel, ...(matchedType ? { merchant_type_id: String(matchedType.id) } : {}) }));
      setAutoFilled(true);
      setMessage({ text: 'Google AI document analysis and API verification complete.', type: 'success' });
      loadOverrides(mid);
    } catch (err) {
      const serverMsg = err.response?.data?.message;
      const httpStatus = err.response?.status ? ` (HTTP ${err.response.status})` : '';
      setMessage({ text: serverMsg || `Google AI verification failed${httpStatus}. Check server logs for details.`, type: 'error' });
    } finally {
      setAnalysing(false);
    }
  };

  const summary = result?.summary || {};

  // Adjusted counts: overridden failure rows are moved from their failure bucket into matched.
  const adjustedSummary = useMemo(() => {
    const rows = result?.unifiedRows || [];
    const failureStatuses = new Set(['missing', 'mismatch', 'invalid']);
    let matched = summary.matchedFields || 0;
    let missing = summary.missingData || 0;
    let invalid = summary.invalidData || 0;
    let mismatches = summary.mismatches || 0;

    rows.forEach((row) => {
      if (!failureStatuses.has(row.status)) return;
      const isOverridden = overrides.some((ov) =>
        ov.field_name === (row.field || '') &&
        ov.document_source === (row.document || '—')
      );
      if (!isOverridden) return;
      if (row.status === 'missing')  missing   = Math.max(0, missing   - 1);
      if (row.status === 'mismatch') mismatches = Math.max(0, mismatches - 1);
      if (row.status === 'invalid')  invalid   = Math.max(0, invalid   - 1);
      matched += 1;
    });

    return { matched, missing, invalid, mismatches };
  }, [summary, result, overrides]);

  const satisfactionScore = useMemo(() => {
    const { matched, missing, invalid, mismatches } = adjustedSummary;
    const total = matched + missing + invalid + mismatches;
    return total === 0 ? null : Math.round((matched / total) * 100);
  }, [adjustedSummary]);

  const allDocuments = useMemo(() => {
    if (!systemJson) return [];
    try {
      const parsed = typeof systemJson === 'string' ? JSON.parse(systemJson) : systemJson;
      return parsed?.data?.all_documents || [];
    } catch { return []; }
  }, [systemJson]);

  const busy = loading || analysing || fetchingDoc || fetchingSys;

  return (
    <PageLayout>

          {/* ── Page header ── */}
          <div className="vi-page-header">
            <div>
              <h1 className="page-title">Merchant Data Verification</h1>
              <p className="page-subtitle">Use Google AI to extract and validate API documents, then compare them against external system API data.</p>
            </div>
            <StatusPill status={result?.status} label={result?.statusLabel} />
          </div>

          {/* ── Verification Inputs card ── */}
          <div className="card">
            <div className="vi-card-header">
              <div className="vi-card-header-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
              </div>
              <div>
                <div className="vi-card-title">Verification Inputs</div>
                <div className="vi-card-subtitle">Provide the details below to run verification</div>
              </div>
            </div>

            <div className="card-body">
              {message.text && (
                <div className={`alert alert-${message.type}`}>{message.text}</div>
              )}

              <form onSubmit={handleRunVerification}>
                {/* Row 1: MID + Channel */}
                <div className="form-row form-row-2" style={{ alignItems: 'flex-end' }}>
                  <div className="form-group">
                    <label className="form-label">MID</label>
                    <div className="vi-mid-row">
                      <div className="vi-input-group" style={{ flex: 1 }}>
                        <span className="vi-input-icon">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                            <line x1="1" y1="10" x2="23" y2="10"/>
                          </svg>
                        </span>
                        <input
                          className="form-control vi-input-has-icon"
                          value={form.mid}
                          onChange={(e) => { setForm({ ...form, mid: e.target.value }); setAutoFilled(false); }}
                          onBlur={handleMidBlur}
                          onKeyDown={handleMidKeyDown}
                          placeholder="Enter MID and press Enter"
                        />
                      </div>
                      <button
                        className="btn vi-load-btn"
                        type="button"
                        onClick={() => fetchAllForMid(form.mid.trim())}
                        disabled={busy}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="16 16 12 12 8 16"/>
                          <line x1="12" y1="12" x2="12" y2="21"/>
                          <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                        </svg>
                        {(fetchingDoc || fetchingSys) ? 'Loading…' : 'Load Data'}
                      </button>
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Merchant Channel</label>
                    <div className="vi-input-group">
                      <span className="vi-input-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
                          <path d="M1.42 9a16 16 0 0 1 21.16 0"/>
                          <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
                          <circle cx="12" cy="20" r="1"/>
                        </svg>
                      </span>
                      <select
                        className="form-control form-control--select vi-input-has-icon"
                        value={form.merchant_channel}
                        onChange={(e) => setForm({ ...form, merchant_channel: e.target.value })}
                        disabled={autoFilled}
                      >
                        <option value="IPG">IPG</option>
                        <option value="POS">POS</option>
                        <option value="IPG & POS">IPG &amp; POS</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Row 2: Merchant Type */}
                <div className="form-row form-row-1">
                  <div className="form-group">
                    <label className="form-label">Merchant Type</label>
                    <div className="vi-input-group">
                      <span className="vi-input-icon">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                        </svg>
                      </span>
                      <select
                        className="form-control form-control--select vi-input-has-icon"
                        value={form.merchant_type_id}
                        onChange={(e) => setForm({ ...form, merchant_type_id: e.target.value })}
                        disabled={typesLoading || autoFilled}
                      >
                        <option value="">{typesLoading ? 'Loading merchant types…' : 'Select merchant type'}</option>
                        {merchantTypes.map((type) => (
                          <option key={type.id} value={type.id}>{type.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Data panels */}
                <div className="verification-source-grid vi-panels-grid">
                  <DataPanel
                    title="Google AI Document Extraction"
                    subtitle="Extracted data from Google AI"
                    iconBg="#EDE9FE"
                    emptyHint="AI extracted document content will appear here"
                    loading={fetchingDoc}
                    value={documentJson}
                    onChange={(e) => setDocumentJson(e.target.value)}
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <circle cx="10" cy="15" r="2"/>
                        <path d="m21 21-1.5-1.5"/>
                        <path d="m15.5 15.5 3.5 3.5"/>
                      </svg>
                    }
                  />
                  <DataPanel
                    title="WebXPay System Data"
                    subtitle="Data from Webxpay system"
                    iconBg="#D1FAE5"
                    emptyHint="System data will appear here"
                    loading={fetchingSys}
                    value={systemJson}
                    onChange={(e) => setSystemJson(e.target.value)}
                    icon={
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <ellipse cx="12" cy="5" rx="9" ry="3"/>
                        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                      </svg>
                    }
                  />
                </div>

                {/* Actions */}
                <div className="vi-actions">
                  <button
                    className="btn btn-dark vi-action-btn"
                    type="button"
                    onClick={() => runAnalysis(false)}
                    disabled={busy}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                      <polyline points="9 12 11 14 15 10"/>
                    </svg>
                    {analysing ? 'Verifying…' : 'Analyze Documents & Verify'}
                  </button>
                  {result && (
                    <button
                      className="btn btn-ghost vi-action-btn"
                      type="button"
                      onClick={() => runAnalysis(true)}
                      disabled={busy}
                      title="Force fresh AI extraction, ignoring cached results"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="23 4 23 10 17 10"/>
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                      </svg>
                      Re-extract
                    </button>
                  )}
                  <button className="btn btn-primary vi-action-btn" type="submit" disabled={busy}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                    {loading ? 'Checking…' : 'Run Verification'}
                  </button>
                  <button className="btn btn-ghost vi-action-btn" type="button" onClick={clearPayloads} disabled={busy}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                    Clear
                  </button>
                  {selectedMerchantType && (
                    <span className="verification-context">Rules: {selectedMerchantType.name}</span>
                  )}
                </div>
              </form>

              {/* Tip */}
              <div className="vi-tip">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span>
                  <strong>Tip:</strong> Load data using MID to auto-fetch and compare information between Google AI extracted data and Webxpay system data.
                </span>
              </div>
            </div>
          </div>

          {/* ── Results ── */}
          {result && (
            <>
              <div className="card">
                <div className="card-header">
                  <span className="card-title"><span className="card-title-accent" />Verification Summary</span>
                  <span className="card-badge">{fmtDate(result.generatedAt)}</span>
                </div>
                <div className="verification-summary">
                  {satisfactionScore !== null && (
                    <SummaryMetric label="Score" value={`${satisfactionScore}%`}
                      tone={satisfactionScore >= 80 ? 'success' : satisfactionScore >= 50 ? 'warning' : 'danger'} />
                  )}
                  <SummaryMetric label="Documents read" value={summary.receivedDocuments || 0} />
                  <SummaryMetric label="Matched" value={adjustedSummary.matched} tone="success" />
                  <SummaryMetric label="Mismatches" value={adjustedSummary.mismatches} tone="danger" />
                  <SummaryMetric label="Missing" value={adjustedSummary.missing} tone="warning" />
                  <SummaryMetric label="Invalid" value={adjustedSummary.invalid} tone="danger" />
                  <SummaryMetric label="AI-Only" value={summary.documentOnlyData || 0} tone="warning" />
                  <SummaryMetric label="System-Only" value={summary.systemOnlyData || 0} tone="warning" />
                </div>
              </div>
              <RuleChecks
                checks={result.ruleChecks}
                report={result}
                allDocuments={allDocuments}
                mid={form.mid.trim() || null}
                overrides={overrides}
                onSaveOverride={handleSaveOverride}
                onDeleteOverride={handleDeleteOverride}
              />
              <UnifiedTable
                rows={(result.unifiedRows || []).filter((row) => {
                  if (!['missing', 'mismatch', 'invalid'].includes(row.status)) return true;
                  return !overrides.some(
                    (ov) => ov.field_name === (row.field || '') && ov.document_source === (row.document || '—')
                  );
                })}
                allDocuments={allDocuments}
              />
            </>
          )}
    </PageLayout>
  );
}
