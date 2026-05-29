import { useEffect, useMemo, useState } from 'react';
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

const formatCell = (value) => {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
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

const listStatus = (merchant) => {
  if (!merchant?.latest_analysis_at) return { label: 'Not run', className: 'badge-optional' };
  if (Number(merchant.can_onboard) === 1) return { label: 'Verified', className: 'badge-required' };
  return { label: 'Review', className: 'badge-mandatory' };
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
                      <span>{formatCell(row.document)}</span>
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
    if (comment.includes('nic') || comment.includes('national id')) {
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

function RuleCheckItem({ check, report, allDocuments = [] }) {
  const [expanded, setExpanded] = useState(false);
  const [viewerDoc, setViewerDoc] = useState(null);
  const items = getRuleItems(check, report);
  const hasItems = items.length > 0;

  return (
    <div className={`verification-rule-row rule-row--expandable${expanded ? ' rule-row--open' : ''}`}>
      <button
        type="button"
        className="rule-row-header"
        onClick={() => hasItems && setExpanded((v) => !v)}
        style={{ cursor: hasItems ? 'pointer' : 'default' }}
        aria-expanded={expanded}
      >
        <span className={`verification-rule-state verification-rule-state--${check.status}`}>
          {check.status}
        </span>
        <div className="rule-header-text">
          <div className="verification-rule-name">{check.name}</div>
          <div className="verification-rule-detail">{check.detail}</div>
        </div>
        {hasItems && (
          <span className="rule-expand-chevron">{expanded ? '▲' : '▼'}</span>
        )}
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
                </tr>
              </thead>
              <tbody>
                {items.map((row, i) => {
                  const matchedDoc = findDocByLabel(row.document, allDocuments);
                  return (
                    <tr key={`${row.field}-${i}`}>
                      <td className="td-name">{formatCell(row.field)}</td>
                      <td className="td-meta">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span>{formatCell(row.document)}</span>
                          {matchedDoc ? (
                            <button
                              type="button"
                              className="btn-doc-open"
                              onClick={() => setViewerDoc(matchedDoc)}
                              title={`Open ${matchedDoc.label || row.document}`}
                            >
                              View
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td className="td-value">{formatCell(row.aiValue)}</td>
                      <td className="td-value">{formatCell(row.apiValue)}</td>
                      <td><ExpandableComment text={formatCell(row.comment)} /></td>
                      <td className="rule-solution-cell">
                        {getSolution(row, RULE_STATUS_MAP[check.name])}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewerDoc && <DocViewerModal doc={viewerDoc} onClose={() => setViewerDoc(null)} />}
    </div>
  );
}

function RuleChecks({ checks = [], report, allDocuments = [] }) {
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
          <RuleCheckItem key={check.name} check={check} report={report} allDocuments={allDocuments} />
        ))}
      </div>
    </div>
  );
}

function VerificationSummary({ report }) {
  if (!report) return null;
  const summary = report.summary || {};

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
        <SummaryMetric label="Matched fields" value={summary.matchedFields || 0} tone="success" />
        <SummaryMetric label="Missing data" value={summary.missingData || 0} tone="danger" />
        <SummaryMetric label="Invalid data" value={summary.invalidData || 0} tone="danger" />
        <SummaryMetric label="Mismatches" value={summary.mismatches || 0} tone="danger" />
        <SummaryMetric label="AI-Onboarding-V2" value={summary.documentOnlyData || 0} tone="warning" />
        <SummaryMetric label="System Data" value={summary.systemOnlyData || 0} tone="warning" />
      </div>
    </div>
  );
}

function MerchantTable({ merchants, onSelect }) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">
          <span className="card-title-accent" />
          All Merchants
        </span>
        <span className="card-badge">{merchants.length} merchants</span>
      </div>
      <div className="table-wrapper ma-full-table">
        <table className="data-table">
          <thead>
            <tr>
              <th>MID</th>
              <th>Merchant</th>
              <th>Type</th>
              <th>Channel</th>
              <th>Last Analysis</th>
              <th>Status</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {merchants.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <div className="empty-state">
                    <div className="empty-state-text">No merchants found.</div>
                  </div>
                </td>
              </tr>
            ) : merchants.map((merchant) => {
              const status = listStatus(merchant);
              return (
                <tr
                  key={merchant.mid}
                  className="merchant-row"
                  onClick={() => onSelect(merchant)}
                >
                  <td className="td-id">{merchant.mid}</td>
                  <td className="td-name">{merchant.merchant_business_name || '-'}</td>
                  <td><span className="merchant-pill">{merchant.merchant_type_name || '-'}</span></td>
                  <td>{merchant.merchant_channel || '-'}</td>
                  <td className="td-meta">{fmtDate(merchant.latest_analysis_at)}</td>
                  <td><span className={`status-badge ${status.className}`}>{status.label}</span></td>
                  <td className="td-meta">{merchant.satisfaction_score ?? '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MerchantAnalysis() {
  const [merchants, setMerchants] = useState([]);
  const [selectedMerchant, setSelectedMerchant] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [report, setReport] = useState(null);
  const [documentJson, setDocumentJson] = useState('');
  const [systemJson, setSystemJson] = useState('');
  const [loadingMerchants, setLoadingMerchants] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [running, setRunning] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });

  const allDocuments = useMemo(() => {
    if (!systemJson) return [];
    try {
      const parsed = typeof systemJson === 'string' ? JSON.parse(systemJson) : systemJson;
      return parsed?.data?.all_documents || [];
    } catch { return []; }
  }, [systemJson]);

  const filteredMerchants = useMemo(() => {
    const needle = searchInput.trim().toLowerCase();
    if (!needle) return merchants;
    return merchants.filter((merchant) => (
      String(merchant.mid || '').toLowerCase().includes(needle)
      || String(merchant.merchant_business_name || '').toLowerCase().includes(needle)
      || String(merchant.merchant_type_name || '').toLowerCase().includes(needle)
    ));
  }, [merchants, searchInput]);

  const loadMerchants = async () => {
    setLoadingMerchants(true);
    try {
      const response = await api.get('/onboard-verification/merchants');
      setMerchants(response.data || []);
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Failed to load merchants.', type: 'error' });
    } finally {
      setLoadingMerchants(false);
    }
  };

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

    const [analysisResult, systemResult, merchantInfoResult] = await Promise.allSettled([
      api.get(`/onboard-verification/latest-analysis/${encodeURIComponent(merchant.mid)}`),
      api.get(`/onboard-verification/external-merchant/${encodeURIComponent(merchant.mid)}`),
      needsDbInfo
        ? api.get(`/onboard-verification/merchant/${encodeURIComponent(merchant.mid)}`)
        : Promise.resolve(null),
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

    setLoadingDetail(false);
  };

  const handleSearch = () => {
    const needle = searchInput.trim();
    if (!needle) {
      // Empty search: refresh and show all merchants
      loadMerchants();
      return;
    }
    const exact = merchants.find((m) => String(m.mid).toLowerCase() === needle.toLowerCase());
    if (exact) {
      loadMerchantDetail(exact);
    } else {
      // MID not in local list — try loading directly from API
      loadMerchantDetail({ mid: needle });
    }
  };

  const handleBack = () => {
    setSelectedMerchant(null);
    setReport(null);
    setDocumentJson('');
    setSystemJson('');
    setMessage({ text: '', type: '' });
    loadMerchants(); // Refresh list on return
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
        can_onboard: response.data.report?.status === 'verified' ? 1 : 0,
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
      const modeNote = response.data.usedCachedExtraction
        ? 'Cached document extraction used — results are consistent.'
        : 'Fresh AI extraction completed.';
      setMessage({ text: `Verification complete. ${modeNote}`, type: 'success' });
      await loadMerchants();
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Analysis failed.', type: 'error' });
    } finally {
      setRunning(false);
    }
  };

  const triggerAutoRun = async () => {
    setAutoRunning(true);
    setMessage({ text: 'Triggering auto-analysis for newly onboarded merchants...', type: '' });
    try {
      const response = await api.post('/onboard-verification/auto-run');
      const { ran, succeeded, failed, skipped } = response.data;
      if (skipped) {
        setMessage({ text: 'Auto-run is already in progress.', type: '' });
      } else {
        setMessage({
          text: `Auto-run complete: ${ran} merchant(s) processed — ${succeeded} succeeded, ${failed} failed.`,
          type: failed > 0 ? 'error' : 'success',
        });
        await loadMerchants();
      }
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Auto-run failed.', type: 'error' });
    } finally {
      setAutoRunning(false);
    }
  };

  useEffect(() => {
    loadMerchants();
  }, []);

  return (
    <PageLayout>
      <div className="page-header">
        <h1 className="page-title">Merchant Analysis</h1>
        <p className="page-subtitle">Merchant verification history and source comparison</p>
      </div>

      {/* Search bar */}
      <div className="ma-search-bar">
        <input
          className="form-control"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Enter MID to search..."
        />
        <button
          className="btn btn-primary"
          type="button"
          onClick={handleSearch}
          disabled={loadingDetail || loadingMerchants}
        >
          Search
        </button>
        {selectedMerchant && (
          <button className="btn btn-secondary" type="button" onClick={handleBack}>
            Back to List
          </button>
        )}
        <button
          className="btn btn-secondary"
          type="button"
          onClick={loadMerchants}
          disabled={loadingMerchants}
        >
          {loadingMerchants ? 'Loading...' : 'Refresh'}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={triggerAutoRun}
          disabled={autoRunning}
          title="Run analysis for newly onboarded merchants today"
        >
          {autoRunning ? 'Running...' : 'Auto-Run'}
        </button>
      </div>

      {message.text && (
        <div className={`alert alert-${message.type || 'info'}`} style={{ marginBottom: 16 }}>
          {message.text}
        </div>
      )}

      {/* Table view — shown when no merchant is selected */}
      {!selectedMerchant && (
        <MerchantTable
          merchants={filteredMerchants}
          onSelect={loadMerchantDetail}
        />
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
              <StatusPill status={report?.status} label={report?.statusLabel} />
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
              <VerificationSummary report={report} />
              <RuleChecks checks={report.ruleChecks} report={report} allDocuments={allDocuments} />
              <UnifiedTable rows={report.unifiedRows || []} allDocuments={allDocuments} />
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
