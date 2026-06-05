import { useCallback, useEffect, useRef, useState } from 'react';
import PageLayout from '../components/PageLayout';
import api from '../services/api';

function Documents() {
  const [search, setSearch] = useState('');
  const [merchants, setMerchants] = useState([]);
  const [meta, setMeta] = useState(null);
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  const [selected, setSelected] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError] = useState('');
  const [dlSuccess, setDlSuccess] = useState('');

  const searchTimer = useRef(null);

  const loadMerchants = useCallback(async (q, pg) => {
    setListLoading(true);
    setListError('');
    try {
      const { data } = await api.get('/onboard-verification/merchant-list', {
        params: { page: pg, ...(q ? { search: q } : {}) },
      });
      setMerchants(data.data || []);
      setMeta(data.meta || null);
    } catch (err) {
      setListError(err.response?.data?.message || 'Failed to load merchants.');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => { loadMerchants('', 1); }, [loadMerchants]);

  const handleSearchChange = (e) => {
    const q = e.target.value;
    setSearch(q);
    setPage(1);
    setSelected(null);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadMerchants(q, 1), 400);
  };

  const handlePageChange = (pg) => {
    setPage(pg);
    loadMerchants(search, pg);
  };

  const handleSelect = (merchant) => {
    setSelected(merchant);
    setDlError('');
    setDlSuccess('');
  };

  const handleDownload = async () => {
    if (!selected) return;
    setDownloading(true);
    setDlError('');
    setDlSuccess('');

    try {
      const mid = selected.id;
      const response = await api.get(
        `/onboard-verification/download-documents/${encodeURIComponent(mid)}`,
        { responseType: 'blob' }
      );

      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `merchant_${mid}_documents.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setDlSuccess(`Downloaded documents for "${selected.doing_business_name}".`);
    } catch (err) {
      let msg = 'Download failed.';
      if (err.response) {
        try {
          const text = await err.response.data.text();
          msg = JSON.parse(text).message || msg;
        } catch { msg = `Error ${err.response.status}`; }
      }
      setDlError(msg);
    } finally {
      setDownloading(false);
    }
  };

  const totalPages = meta ? meta.last_page : 1;

  return (
    <PageLayout title="Documents">
      <div className="page-header">
        <h1 className="page-title">Merchant Documents</h1>
        <p className="page-subtitle">Search and select a merchant to download all their documents as a PDF.</p>
      </div>

      <div className="docs-layout">
        {/* ── Left: merchant list ── */}
        <div className="docs-list-panel">
          <div className="docs-search-bar">
            <span className="vi-input-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </span>
            <input
              className="form-control vi-input-has-icon"
              type="text"
              placeholder="Search by business name…"
              value={search}
              onChange={handleSearchChange}
            />
          </div>

          {listError && (
            <div className="docs-feedback docs-feedback--error" style={{ margin: '8px 0' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {listError}
            </div>
          )}

          <div className="docs-merchant-list">
            {listLoading ? (
              <div className="docs-list-state">
                <span className="docs-spinner docs-spinner--dark" />
                Loading merchants…
              </div>
            ) : merchants.length === 0 ? (
              <div className="docs-list-state">No merchants found.</div>
            ) : (
              merchants.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`docs-merchant-row${selected?.id === m.id ? ' docs-merchant-row--active' : ''}`}
                  onClick={() => handleSelect(m)}
                >
                  <span className="docs-merchant-name">{m.doing_business_name}</span>
                  <span className="docs-merchant-num">{m.merchant_number}</span>
                </button>
              ))
            )}
          </div>

          {meta && totalPages > 1 && (
            <div className="docs-pagination">
              <button
                className="docs-page-btn"
                disabled={page <= 1 || listLoading}
                onClick={() => handlePageChange(page - 1)}
              >
                ‹
              </button>
              <span className="docs-page-info">
                Page {page} of {totalPages}
              </span>
              <button
                className="docs-page-btn"
                disabled={page >= totalPages || listLoading}
                onClick={() => handlePageChange(page + 1)}
              >
                ›
              </button>
            </div>
          )}
        </div>

        {/* ── Right: download panel ── */}
        <div className="docs-download-panel">
          {selected ? (
            <>
              <div className="docs-selected-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="11" x2="12" y2="17"/>
                  <polyline points="9 14 12 17 15 14"/>
                </svg>
              </div>

              <div className="docs-selected-name">{selected.doing_business_name}</div>
              {selected.registered_business_name !== selected.doing_business_name && (
                <div className="docs-selected-reg">{selected.registered_business_name}</div>
              )}
              <div className="docs-selected-mid">{selected.merchant_number}</div>

              <button
                className="btn btn-primary docs-download-btn"
                onClick={handleDownload}
                disabled={downloading}
              >
                {downloading ? (
                  <><span className="docs-spinner" />Downloading…</>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download PDF
                  </>
                )}
              </button>

              {dlError && (
                <div className="docs-feedback docs-feedback--error">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  {dlError}
                </div>
              )}
              {dlSuccess && (
                <div className="docs-feedback docs-feedback--success">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  {dlSuccess}
                </div>
              )}
            </>
          ) : (
            <div className="docs-empty-state">
              <div className="docs-empty-icon">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
              <p className="docs-empty-text">Select a merchant from the list to download their documents.</p>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

export default Documents;
