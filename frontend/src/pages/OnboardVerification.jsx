import { useState, useEffect, useRef, useCallback } from 'react';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import api from '../services/api';

const FORM_INIT = { mid: '', merchant_business_name: '', merchant_channel: '', merchant_type_id: '' };

const isEffectivelyMandatory = (req, channel) => {
  if (req.is_mandatory) return true;
  if (channel === 'IPG') {
    const n = req.required_docs.toLowerCase();
    if (n.includes('website') || n.includes('social')) return true;
  }
  return false;
};

const isUrlDoc = (req) => {
  const n = req.required_docs.toLowerCase();
  return n.includes('website') || n.includes('social media') || n.includes('social') || n.includes('url');
};

/* ── small progress ring ─────────────────────────────────── */
function ProgressRing({ done, total }) {
  const r = 14, circ = 2 * Math.PI * r;
  const pct = total > 0 ? done / total : 0;
  const dash = pct * circ;
  return (
    <svg width="36" height="36" viewBox="0 0 36 36">
      <circle cx="18" cy="18" r={r} fill="none" stroke="#E4EAF0" strokeWidth="3.5" />
      <circle cx="18" cy="18" r={r} fill="none"
        stroke={done === total && total > 0 ? '#4ADE80' : '#22272D'}
        strokeWidth="3.5"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 18 18)"
        style={{ transition: 'stroke-dasharray 0.4s ease' }}
      />
    </svg>
  );
}

export default function OnboardVerification() {
  const [merchants, setMerchants]           = useState([]);
  const [merchantsLoading, setMerchantsLoading] = useState(true);
  const [form, setForm]                     = useState(FORM_INIT);
  const [merchantTypes, setMerchantTypes]   = useState([]);
  const [isEditing, setIsEditing]           = useState(false);
  const [formVisible, setFormVisible]       = useState(false);
  const [setupMsg, setSetupMsg]             = useState({ text: '', type: '' });
  const [setupLoading, setSetupLoading]     = useState(false);
  const [deleteLoading, setDeleteLoading]   = useState(false);
  const [requirements, setRequirements]     = useState([]);
  const [uploadedMap, setUploadedMap]       = useState({});
  const [fileMap, setFileMap]               = useState({});
  const [urlMap, setUrlMap]                 = useState({});
  const [dragOver, setDragOver]             = useState({});
  const [uploadStatus, setUploadStatus]     = useState({});
  const [uploadLoading, setUploadLoading]   = useState({});
  const [uploadAllLoading, setUploadAllLoading] = useState(false);
  const [deleteDocLoading, setDeleteDocLoading] = useState({});
  const [docsVisible, setDocsVisible]       = useState(false);

  const fileInputRefs = useRef({});

  useEffect(() => {
    Promise.all([api.get('/merchant-types'), api.get('/onboard-verification/merchants')])
      .then(([mt, ml]) => { setMerchantTypes(mt.data); setMerchants(ml.data); })
      .catch(() => {})
      .finally(() => setMerchantsLoading(false));
  }, []);

  const refreshMerchants = useCallback(async () => {
    try { const r = await api.get('/onboard-verification/merchants'); setMerchants(r.data); } catch { }
  }, []);

  const fetchUploadedDocs = useCallback(async (mid) => {
    try {
      const r = await api.get(`/onboard-verification/documents/${mid}`);
      const map = {};
      r.data.forEach(d => { map[d.merchant_requirement_id] = d; });
      setUploadedMap(map);
    } catch { }
  }, []);

  const handleSelectMerchant = (m) => {
    setForm({ mid: String(m.mid), merchant_business_name: m.merchant_business_name, merchant_channel: m.merchant_channel || '', merchant_type_id: String(m.merchant_type_id) });
    setIsEditing(true); setFormVisible(true); setDocsVisible(false);
    setRequirements([]); setUploadedMap({}); setFileMap({}); setUrlMap({});
    setUploadStatus({}); setSetupMsg({ text: '', type: '' });
  };

  const handleNewMerchant = () => {
    setForm(FORM_INIT); setIsEditing(false); setFormVisible(true); setDocsVisible(false);
    setRequirements([]); setUploadedMap({}); setFileMap({}); setUrlMap({});
    setUploadStatus({}); setSetupMsg({ text: '', type: '' });
  };

  const handleCancel = () => {
    setFormVisible(false); setDocsVisible(false); setForm(FORM_INIT); setSetupMsg({ text: '', type: '' });
  };

  const handleLoad = async (e) => {
    e.preventDefault();
    if (!form.mid || !form.merchant_business_name.trim() || !form.merchant_channel || !form.merchant_type_id)
      return setSetupMsg({ text: 'All fields are required.', type: 'error' });
    setSetupLoading(true); setSetupMsg({ text: '', type: '' });
    try {
      await api.post('/onboard-verification/merchant', { mid: Number(form.mid), merchant_business_name: form.merchant_business_name.trim(), merchant_type_id: form.merchant_type_id, merchant_channel: form.merchant_channel });
      const r = await api.get(`/onboard-verification/requirements/${form.merchant_type_id}`);
      setRequirements(r.data);
      await fetchUploadedDocs(form.mid);
      await refreshMerchants();
      setIsEditing(true); setDocsVisible(true); setFileMap({}); setUrlMap({}); setUploadStatus({});
    } catch (err) {
      setSetupMsg({ text: err.response?.data?.message || 'Failed.', type: 'error' });
    } finally { setSetupLoading(false); }
  };

  const handleDeleteMerchant = async () => {
    if (!window.confirm(`Delete MID ${form.mid} and all documents?`)) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/onboard-verification/merchant/${form.mid}`);
      await refreshMerchants();
      setForm(FORM_INIT); setFormVisible(false); setDocsVisible(false);
      setRequirements([]); setUploadedMap({}); setIsEditing(false);
    } catch (err) {
      setSetupMsg({ text: err.response?.data?.message || 'Delete failed.', type: 'error' });
    } finally { setDeleteLoading(false); }
  };

  const clearFile = (reqId) => {
    setFileMap(prev => { const n = { ...prev }; delete n[reqId]; return n; });
    setUploadStatus(prev => ({ ...prev, [reqId]: { text: '', type: '' } }));
    if (fileInputRefs.current[reqId]) fileInputRefs.current[reqId].value = '';
  };

  const uploadOne = async (req) => {
    setUploadLoading(prev => ({ ...prev, [req.id]: true }));
    setUploadStatus(prev => ({ ...prev, [req.id]: { text: '', type: '' } }));
    try {
      if (isUrlDoc(req)) {
        const url = urlMap[req.id]?.trim();
        if (!url) return;
        await api.post('/onboard-verification/upload-url', { mid: form.mid, merchant_requirement_id: req.id, document_type: req.required_docs, is_mandatory: isEffectivelyMandatory(req, form.merchant_channel), url });
        setUrlMap(prev => ({ ...prev, [req.id]: '' }));
      } else {
        const file = fileMap[req.id];
        if (!file) return;
        const fd = new FormData();
        fd.append('mid', form.mid); fd.append('merchant_requirement_id', req.id);
        fd.append('document_type', req.required_docs); fd.append('is_mandatory', isEffectivelyMandatory(req, form.merchant_channel));
        fd.append('file', file);
        await api.post('/onboard-verification/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        clearFile(req.id);
      }
      setUploadStatus(prev => ({ ...prev, [req.id]: { text: 'Saved successfully.', type: 'success' } }));
      await fetchUploadedDocs(form.mid);
    } catch (err) {
      setUploadStatus(prev => ({ ...prev, [req.id]: { text: err.response?.data?.message || 'Failed.', type: 'error' } }));
    } finally {
      setUploadLoading(prev => ({ ...prev, [req.id]: false }));
    }
  };

  const handleUploadAll = async () => {
    const toUpload = requirements.filter(r => isUrlDoc(r) ? urlMap[r.id]?.trim() : fileMap[r.id]);
    if (!toUpload.length) return;
    setUploadAllLoading(true);
    for (const req of toUpload) await uploadOne(req);
    setUploadAllLoading(false);
  };

  const handleDeleteDoc = async (docId, reqId) => {
    if (!window.confirm('Remove this uploaded document?')) return;
    setDeleteDocLoading(prev => ({ ...prev, [reqId]: true }));
    try {
      await api.delete(`/onboard-verification/document/${docId}`);
      setUploadedMap(prev => { const n = { ...prev }; delete n[reqId]; return n; });
    } catch (err) {
      setUploadStatus(prev => ({ ...prev, [reqId]: { text: 'Remove failed.', type: 'error' } }));
    } finally { setDeleteDocLoading(prev => ({ ...prev, [reqId]: false })); }
  };

  const handleDrop = (e, reqId) => {
    e.preventDefault();
    setDragOver(prev => ({ ...prev, [reqId]: false }));
    const file = e.dataTransfer.files[0];
    if (!file) return;
    setFileMap(prev => ({ ...prev, [reqId]: file }));
    setUploadStatus(prev => ({ ...prev, [reqId]: { text: '', type: '' } }));
  };

  const mandatoryReqs = requirements.filter(r => isEffectivelyMandatory(r, form.merchant_channel));
  const optionalReqs  = requirements.filter(r => !isEffectivelyMandatory(r, form.merchant_channel));
  const mandatoryUploaded = mandatoryReqs.filter(r => uploadedMap[r.id]).length;
  const selectedCount = requirements.filter(r => isUrlDoc(r) ? urlMap[r.id]?.trim() : fileMap[r.id]).length;
  const allDone = requirements.length > 0 && Object.keys(uploadedMap).length >= requirements.length;

  const DocCard = ({ req, idx, isMandatory }) => {
    const uploaded   = uploadedMap[req.id];
    const status     = uploadStatus[req.id];
    const loading    = uploadLoading[req.id];
    const delLoad    = deleteDocLoading[req.id];
    const selected   = fileMap[req.id];
    const isUrl      = isUrlDoc(req);
    const isDragOn   = dragOver[req.id];

    return (
      <div className={['duc', isMandatory ? 'duc--mandatory' : 'duc--optional', uploaded ? 'duc--done' : ''].filter(Boolean).join(' ')}>

        {/* Header */}
        <div className="duc-header">
          <div className="duc-title-row">
            <span className={`duc-index ${!isMandatory ? 'duc-index--optional' : ''}`}>{String(idx + 1).padStart(2, '0')}</span>
            <span className="duc-name">{req.required_docs}</span>
            {isMandatory ? <span className="req-star">*</span> : <span className="duc-optional-badge">Optional</span>}
          </div>
        </div>

        {req.description && <div className="duc-desc">{req.description}</div>}

        {/* Already uploaded */}
        {uploaded && (
          <div className="duc-uploaded">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span className="duc-uploaded-path" title={uploaded.upload_path}>{uploaded.upload_path.split('/').pop()}</span>
            <button className="doc-delete-btn" onClick={() => handleDeleteDoc(uploaded.id, req.id)} disabled={delLoad} title="Remove">
              {delLoad ? '…' : <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>}
            </button>
          </div>
        )}

        {/* Status */}
        {status?.text && <div className={`duc-status duc-status--${status.type}`}>{status.text}</div>}

        {/* Input area */}
        {isUrl ? (
          <div className="duc-url-wrap">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--ash)', flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            <input
              className="duc-url-input"
              type="url"
              value={urlMap[req.id] || ''}
              onChange={e => setUrlMap(prev => ({ ...prev, [req.id]: e.target.value }))}
              placeholder="https://yourbusiness.com"
            />
          </div>
        ) : selected ? (
          <div className="duc-file-selected">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#15803D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>
            </svg>
            <span className="duc-file-name">{selected.name}</span>
            <button className="file-clear-btn" onClick={() => clearFile(req.id)}>×</button>
          </div>
        ) : (
          <>
            <input ref={el => { fileInputRefs.current[req.id] = el; }} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files[0]; if (f) { setFileMap(p => ({ ...p, [req.id]: f })); setUploadStatus(p => ({ ...p, [req.id]: { text: '', type: '' } })); } }}
            />
            <div
              className={`duc-dropzone${isDragOn ? ' duc-dropzone--over' : ''}`}
              onClick={() => fileInputRefs.current[req.id]?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(p => ({ ...p, [req.id]: true })); }}
              onDragLeave={() => setDragOver(p => ({ ...p, [req.id]: false }))}
              onDrop={e => handleDrop(e, req.id)}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="duc-dropzone-icon">
                <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
                <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
              </svg>
              <p className="duc-dropzone-text">
                Drag &amp; drop file here<br />
                or <span className="duc-browse-link">Browse</span>
              </p>
            </div>
          </>
        )}

        <div className="duc-hint">PDF, JPG or PNG · Max 10 MB</div>
      </div>
    );
  };

  return (
    <div className="app-shell">
      <Navbar />
      <div className="app-body">
        <Sidebar />
        <main className="main-content">

          <div className="page-header">
            <h1 className="page-title">Merchant Onboard Verification</h1>
            <p className="page-subtitle">Select an existing merchant or create a new one to manage onboarding documents</p>
          </div>

          {/* ═══ MERCHANT LIST ═══ */}
          <div className="card">
            <div className="card-header">
              <span className="card-title"><span className="card-title-accent" />Merchants</span>
              <button className="btn btn-primary btn-sm" onClick={handleNewMerchant}>+ New Merchant</button>
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 80 }}>MID</th>
                    <th>Business Name</th>
                    <th style={{ width: 110 }}>Channel</th>
                    <th style={{ width: 200 }}>Merchant Type</th>
                    <th style={{ width: 130 }}>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {merchantsLoading ? (
                    <tr><td colSpan={5}><div className="empty-state"><div className="empty-state-text">Loading…</div></div></td></tr>
                  ) : merchants.length === 0 ? (
                    <tr><td colSpan={5}><div className="empty-state"><div className="empty-state-icon">🏬</div><div className="empty-state-text">No merchants yet — click "+ New Merchant"</div></div></td></tr>
                  ) : merchants.map(m => (
                    <tr key={m.mid} className={`merchant-row${form.mid === String(m.mid) && formVisible ? ' row-selected' : ''}`} onClick={() => handleSelectMerchant(m)}>
                      <td className="td-id">#{m.mid}</td>
                      <td className="td-name">{m.merchant_business_name}</td>
                      <td><span className={`channel-pill channel-pill--${m.merchant_channel?.toLowerCase()}`}>{m.merchant_channel || '—'}</span></td>
                      <td><span className="merchant-pill">{m.merchant_type_name}</span></td>
                      <td className="td-meta">{m.updated_at ? new Date(m.updated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ═══ MERCHANT FORM ═══ */}
          {formVisible && (
            <div className="card">
              <div className="card-header">
                <span className="card-title"><span className="card-title-accent" />{isEditing ? `Editing — MID ${form.mid}` : 'New Merchant'}</span>
                {isEditing && <span className="card-badge" style={{ background: 'var(--green-light)', color: '#15643A', border: '1px solid var(--green-border)' }}>Existing record</span>}
              </div>
              <div className="card-body">
                {setupMsg.text && <div className={`alert alert-${setupMsg.type}`}>{setupMsg.text}</div>}
                <form onSubmit={handleLoad}>
                  <div className="form-row form-row-2">
                    <div className="form-group">
                      <label className="form-label">MID</label>
                      <input className="form-control" type="number" value={form.mid} onChange={e => setForm({ ...form, mid: e.target.value })} placeholder="e.g. 1001" disabled={isEditing} style={isEditing ? { background: '#F7F9FC', color: 'var(--ash-2)' } : {}} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Merchant Business Name</label>
                      <input className="form-control" type="text" value={form.merchant_business_name} onChange={e => setForm({ ...form, merchant_business_name: e.target.value })} placeholder="e.g. ABC Stores (Pvt) Ltd" />
                    </div>
                  </div>
                  <div className="form-row form-row-2">
                    <div className="form-group">
                      <label className="form-label">Merchant Channel</label>
                      <select className="form-control form-control--select" value={form.merchant_channel} onChange={e => setForm({ ...form, merchant_channel: e.target.value })}>
                        <option value="">— Select channel —</option>
                        <option value="IPG">IPG</option>
                        <option value="POS">POS</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Merchant Type</label>
                      <select className="form-control form-control--select" value={form.merchant_type_id} onChange={e => setForm({ ...form, merchant_type_id: e.target.value })}>
                        <option value="">— Select merchant type —</option>
                        {merchantTypes.map(mt => <option key={mt.id} value={mt.id}>{mt.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-actions">
                    <button type="submit" className="btn btn-primary" disabled={setupLoading}>{setupLoading ? 'Saving…' : isEditing ? 'Update & Load Documents' : 'Save & Load Documents'}</button>
                    {isEditing && <button type="button" className="btn btn-danger" onClick={handleDeleteMerchant} disabled={deleteLoading}>{deleteLoading ? 'Deleting…' : 'Delete Merchant'}</button>}
                    <button type="button" className="btn btn-ghost" onClick={handleCancel}>Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* ═══ DOCUMENTS ═══ */}
          {docsVisible && requirements.length > 0 && (
            <div className="card">

              {/* ── Required Documents ── */}
              {mandatoryReqs.length > 0 && (
                <div className="doc-section">
                  <div className="doc-section-header">
                    <div className="doc-section-title-area">
                      <div className="doc-section-icon doc-section-icon--required">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                          <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
                        </svg>
                      </div>
                      <div>
                        <div className="doc-section-title">Required Documents</div>
                        <div className="doc-section-subtitle">These documents are mandatory to verify your business.</div>
                      </div>
                    </div>
                    <div className="doc-progress-wrap">
                      <ProgressRing done={mandatoryUploaded} total={mandatoryReqs.length} />
                      <span className="doc-progress-text">{mandatoryUploaded} of {mandatoryReqs.length} required uploaded</span>
                    </div>
                  </div>
                  <div className="duc-grid duc-grid--4">
                    {mandatoryReqs.map((req, i) => <DocCard key={req.id} req={req} idx={i} isMandatory={true} />)}
                  </div>
                </div>
              )}

              {/* ── Optional Documents ── */}
              {optionalReqs.length > 0 && (
                <div className="doc-section doc-section--optional">
                  <div className="doc-section-header">
                    <div className="doc-section-title-area">
                      <div className="doc-section-icon doc-section-icon--optional">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                      </div>
                      <div>
                        <div className="doc-section-title">Optional Documents</div>
                        <div className="doc-section-subtitle">These documents are optional and help strengthen verification.</div>
                      </div>
                    </div>
                  </div>
                  <div className="duc-grid duc-grid--2">
                    {optionalReqs.map((req, i) => <DocCard key={req.id} req={req} idx={mandatoryReqs.length + i} isMandatory={false} />)}
                  </div>
                </div>
              )}

              {/* ── Footer ── */}
              <div className="doc-upload-footer">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: allDone ? '#4ADE80' : 'var(--ash)' }}>
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    {allDone && <polyline points="9 12 11 14 15 10"/>}
                  </svg>
                  <span className="doc-upload-footer-info">
                    {mandatoryReqs.length} mandatory · {optionalReqs.length} optional
                  </span>
                </div>
                <button className="btn-upload-docs" onClick={handleUploadAll} disabled={uploadAllLoading || selectedCount === 0}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
                    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
                  </svg>
                  {uploadAllLoading ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}
