import { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import api from '../services/api';

// ─── helpers ───────────────────────────────────────────────
const fmt = (d) => d
  ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—';

// ─── initial form states ────────────────────────────────────
const MT_INIT   = { id: null, name: '' };
const REQ_INIT  = { id: null, merchant_type_id: '', required_docs: '', description: '', is_mandatory: true };

function RequirementConfig() {

  // ── Merchant Types ──────────────────────────────────────
  const [mtForm, setMtForm]       = useState(MT_INIT);
  const [merchantTypes, setMerchantTypes] = useState([]);
  const [mtMsg, setMtMsg]         = useState({ text: '', type: '' });
  const [mtLoading, setMtLoading] = useState(false);

  // ── Requirements ────────────────────────────────────────
  const [reqForm, setReqForm]     = useState(REQ_INIT);
  const [requirements, setRequirements] = useState([]);
  const [reqMsg, setReqMsg]       = useState({ text: '', type: '' });
  const [reqLoading, setReqLoading] = useState(false);

  useEffect(() => {
    fetchMerchantTypes();
    fetchRequirements();
  }, []);

  const fetchMerchantTypes = async () => {
    try { const r = await api.get('/merchant-types'); setMerchantTypes(r.data); } catch { /* silent */ }
  };
  const fetchRequirements = async () => {
    try { const r = await api.get('/requirements'); setRequirements(r.data); } catch { /* silent */ }
  };

  // ─── Merchant Type CRUD ────────────────────────────────
  const clearMt = () => { setMtForm(MT_INIT); setMtMsg({ text: '', type: '' }); };

  const handleMtSubmit = async (e) => {
    e.preventDefault();
    if (!mtForm.name.trim()) return setMtMsg({ text: 'Name is required.', type: 'error' });
    setMtLoading(true); setMtMsg({ text: '', type: '' });
    try {
      if (mtForm.id) {
        await api.put(`/merchant-types/${mtForm.id}`, { name: mtForm.name.trim() });
        setMtMsg({ text: 'Merchant type updated successfully.', type: 'success' });
      } else {
        await api.post('/merchant-types', { name: mtForm.name.trim() });
        setMtMsg({ text: 'Merchant type added successfully.', type: 'success' });
      }
      clearMt(); fetchMerchantTypes();
    } catch (err) {
      setMtMsg({ text: err.response?.data?.message || 'Operation failed.', type: 'error' });
    } finally { setMtLoading(false); }
  };

  const handleMtDelete = async () => {
    if (!mtForm.id || !window.confirm('Delete this merchant type?')) return;
    setMtLoading(true); setMtMsg({ text: '', type: '' });
    try {
      await api.delete(`/merchant-types/${mtForm.id}`);
      setMtMsg({ text: 'Merchant type deleted.', type: 'success' });
      clearMt(); fetchMerchantTypes();
    } catch (err) {
      setMtMsg({ text: err.response?.data?.message || 'Delete failed.', type: 'error' });
    } finally { setMtLoading(false); }
  };

  // ─── Requirement CRUD ──────────────────────────────────
  const clearReq = () => { setReqForm(REQ_INIT); setReqMsg({ text: '', type: '' }); };

  const handleReqAdd = async (e) => {
    e.preventDefault();
    if (!reqForm.merchant_type_id || !reqForm.required_docs.trim())
      return setReqMsg({ text: 'Merchant type and document name are required.', type: 'error' });
    setReqLoading(true); setReqMsg({ text: '', type: '' });
    try {
      await api.post('/requirements', {
        merchant_type_id: reqForm.merchant_type_id,
        required_docs: reqForm.required_docs.trim(),
        description: reqForm.description.trim(),
        is_mandatory: reqForm.is_mandatory,
      });
      setReqMsg({ text: 'Requirement added successfully.', type: 'success' });
      clearReq(); fetchRequirements();
    } catch (err) {
      setReqMsg({ text: err.response?.data?.message || 'Failed to add.', type: 'error' });
    } finally { setReqLoading(false); }
  };

  const handleReqUpdate = async () => {
    if (!reqForm.id) return setReqMsg({ text: 'Select a row to update.', type: 'error' });
    if (!reqForm.merchant_type_id || !reqForm.required_docs.trim())
      return setReqMsg({ text: 'Merchant type and document name are required.', type: 'error' });
    setReqLoading(true); setReqMsg({ text: '', type: '' });
    try {
      await api.put(`/requirements/${reqForm.id}`, {
        merchant_type_id: reqForm.merchant_type_id,
        required_docs: reqForm.required_docs.trim(),
        description: reqForm.description.trim(),
        is_mandatory: reqForm.is_mandatory,
      });
      setReqMsg({ text: 'Requirement updated successfully.', type: 'success' });
      clearReq(); fetchRequirements();
    } catch (err) {
      setReqMsg({ text: err.response?.data?.message || 'Failed to update.', type: 'error' });
    } finally { setReqLoading(false); }
  };

  const handleReqDelete = async () => {
    if (!reqForm.id) return setReqMsg({ text: 'Select a row to delete.', type: 'error' });
    if (!window.confirm('Delete this requirement?')) return;
    setReqLoading(true); setReqMsg({ text: '', type: '' });
    try {
      await api.delete(`/requirements/${reqForm.id}`);
      setReqMsg({ text: 'Requirement deleted.', type: 'success' });
      clearReq(); fetchRequirements();
    } catch (err) {
      setReqMsg({ text: err.response?.data?.message || 'Failed to delete.', type: 'error' });
    } finally { setReqLoading(false); }
  };

  // ──────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      <Navbar />
      <div className="app-body">
        <Sidebar />
        <main className="main-content">

          <div className="page-header">
            <h1 className="page-title">Requirement Configuration</h1>
            <p className="page-subtitle">Define merchant types, configure onboarding requirements, and set document fields</p>
          </div>

          {/* ══════════════════════════════════════════
              SECTION 1 — MERCHANT TYPES
          ══════════════════════════════════════════ */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">
                <span className="card-title-accent" />
                Merchant Types
              </span>
              <span className="card-badge">{merchantTypes.length} total</span>
            </div>

            <div className="card-body">
              {mtMsg.text && <div className={`alert alert-${mtMsg.type}`}>{mtMsg.text}</div>}
              {mtForm.id && (
                <div className="edit-banner">
                  Editing — {merchantTypes.find(m => m.id === mtForm.id)?.name}
                </div>
              )}

              <form onSubmit={handleMtSubmit}>
                <div className="inline-form-row">
                  <div className="form-group">
                    <label className="form-label">Merchant Type Name</label>
                    <input
                      className="form-control"
                      type="text"
                      value={mtForm.name}
                      onChange={e => setMtForm({ ...mtForm, name: e.target.value })}
                      placeholder="e.g. Sole Proprietor, Private Limited Company"
                    />
                  </div>
                  <div className="form-actions" style={{ paddingTop: 22 }}>
                    {!mtForm.id ? (
                      <>
                        <button type="submit" className="btn btn-primary" disabled={mtLoading}>
                          {mtLoading ? 'Adding…' : 'Add Type'}
                        </button>
                        <button type="button" className="btn btn-ghost" onClick={clearMt}>Clear</button>
                      </>
                    ) : (
                      <>
                        <button type="submit" className="btn btn-update" disabled={mtLoading}>
                          {mtLoading ? 'Saving…' : 'Update'}
                        </button>
                        <button type="button" className="btn btn-danger" onClick={handleMtDelete} disabled={mtLoading}>Delete</button>
                        <button type="button" className="btn btn-ghost" onClick={clearMt}>Cancel</button>
                      </>
                    )}
                  </div>
                </div>
              </form>
            </div>

            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>ID</th>
                    <th>Merchant Type</th>
                    <th style={{ width: 160 }}>Created</th>
                    <th style={{ width: 72 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {merchantTypes.length === 0 ? (
                    <tr><td colSpan={4}>
                      <div className="empty-state">
                        <div className="empty-state-icon">🏢</div>
                        <div className="empty-state-text">No merchant types yet — add one above</div>
                      </div>
                    </td></tr>
                  ) : merchantTypes.map(mt => (
                    <tr key={mt.id} className={mtForm.id === mt.id ? 'row-selected' : ''}>
                      <td className="td-id">#{mt.id}</td>
                      <td className="td-name">{mt.name}</td>
                      <td className="td-meta">{fmt(mt.created_at)}</td>
                      <td>
                        <button className="btn btn-sm btn-dark"
                          onClick={() => { setMtForm({ id: mt.id, name: mt.name }); setMtMsg({ text: '', type: '' }); }}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ══════════════════════════════════════════
              SECTION 2 — REQUIRED DOCUMENTS
          ══════════════════════════════════════════ */}
          <div className="card" id="req-section">
            <div className="card-header">
              <span className="card-title">
                <span className="card-title-accent" />
                Required Documents
              </span>
              <span className="card-badge">{requirements.length} records</span>
            </div>

            <div className="card-body">
              {reqMsg.text && <div className={`alert alert-${reqMsg.type}`}>{reqMsg.text}</div>}
              {reqForm.id && <div className="edit-banner">Editing Requirement #{reqForm.id}</div>}

              <form onSubmit={handleReqAdd}>
                <div className="form-row form-row-2">
                  <div className="form-group">
                    <label className="form-label">Merchant Type</label>
                    <select
                      className="form-control form-control--select"
                      value={reqForm.merchant_type_id}
                      onChange={e => setReqForm({ ...reqForm, merchant_type_id: e.target.value })}
                    >
                      <option value="">— Select merchant type —</option>
                      {merchantTypes.map(mt => (
                        <option key={mt.id} value={mt.id}>{mt.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Required Document</label>
                    <input
                      className="form-control"
                      type="text"
                      value={reqForm.required_docs}
                      onChange={e => setReqForm({ ...reqForm, required_docs: e.target.value })}
                      placeholder="e.g. Certified Business Registration Certificate"
                    />
                  </div>
                </div>

                <div className="form-row form-row-2">
                  <div className="form-group">
                    <label className="form-label">Requirement Type</label>
                    <select
                      className="form-control form-control--select"
                      value={reqForm.is_mandatory}
                      onChange={e => setReqForm({ ...reqForm, is_mandatory: e.target.value === 'true' })}
                    >
                      <option value="true">Mandatory</option>
                      <option value="false">Optional</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Description</label>
                    <input
                      className="form-control"
                      type="text"
                      value={reqForm.description}
                      onChange={e => setReqForm({ ...reqForm, description: e.target.value })}
                      placeholder="Brief description of this requirement"
                    />
                  </div>
                </div>

                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={reqLoading || !!reqForm.id}>
                    Add Requirement
                  </button>
                  <button type="button" className="btn btn-update" onClick={handleReqUpdate} disabled={reqLoading || !reqForm.id}>
                    Update
                  </button>
                  <button type="button" className="btn btn-danger" onClick={handleReqDelete} disabled={reqLoading || !reqForm.id}>
                    Delete
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={clearReq}>Clear</button>
                </div>
              </form>
            </div>

            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>ID</th>
                    <th style={{ width: 150 }}>Type</th>
                    <th>Document</th>
                    <th>Description</th>
                    <th style={{ width: 110 }}>Status</th>
                    <th style={{ width: 140 }}>Created</th>
                    <th style={{ width: 140 }}>Updated</th>
                    <th style={{ width: 72 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {requirements.length === 0 ? (
                    <tr><td colSpan={8}>
                      <div className="empty-state">
                        <div className="empty-state-icon">📄</div>
                        <div className="empty-state-text">No requirements configured — add one above</div>
                      </div>
                    </td></tr>
                  ) : requirements.map(req => (
                    <tr key={req.id} className={reqForm.id === req.id ? 'row-selected' : ''}>
                      <td className="td-id">#{req.id}</td>
                      <td><span className="merchant-pill">{req.merchant_type}</span></td>
                      <td className="td-name">{req.required_docs}</td>
                      <td className="td-desc">{req.description || '—'}</td>
                      <td>
                        <span className={`status-badge ${req.is_mandatory ? 'badge-mandatory' : 'badge-optional'}`}>
                          {req.is_mandatory ? 'Mandatory' : 'Optional'}
                        </span>
                      </td>
                      <td className="td-meta">{fmt(req.created_at)}</td>
                      <td className="td-meta">{fmt(req.updated_at)}</td>
                      <td>
                        <button className="btn btn-sm btn-dark"
                          onClick={() => {
                            setReqForm({
                              id: req.id,
                              merchant_type_id: req.merchant_type_id,
                              required_docs: req.required_docs,
                              description: req.description || '',
                              is_mandatory: Boolean(req.is_mandatory),
                            });
                            setReqMsg({ text: '', type: '' });
                            document.getElementById('req-section')?.scrollIntoView({ behavior: 'smooth' });
                          }}>
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </main>
      </div>
    </div>
  );
}

export default RequirementConfig;
