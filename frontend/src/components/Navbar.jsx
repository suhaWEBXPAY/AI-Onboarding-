import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

function UserAvatar({ name }) {
  const initials = (name || 'U')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return <div className="navbar-avatar">{initials}</div>;
}

// Polls the server-side cross-business stakeholder index (5-min TTL) so the bell
// stays live without the admin needing to open every merchant to discover overlap.
const DUPES_POLL_MS = 5 * 60 * 1000;

// A dismissal is keyed on identity + the exact set of businesses, so a dismissed
// alert automatically resurfaces if the person appears in a NEW business.
// Dismissals are stored server-side (DB) and shared across all admins/browsers.
const alertKeyOf = (dup) => `${dup.match_type}:${dup.identifier}:${(dup.businesses || []).map((b) => b.mid).sort().join(',')}`;

function StakeholderAlertsBell() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [dismissals, setDismissals] = useState([]);
  const wrapRef = useRef(null);
  const navigate = useNavigate();

  const dismissAlert = async (dup) => {
    try {
      const { data: rows } = await api.post('/onboard-verification/stakeholder-alert-dismissals', {
        alert_key: alertKeyOf(dup),
        identifier: dup.identifier,
        match_type: dup.match_type,
      });
      setDismissals(Array.isArray(rows) ? rows : []);
    } catch { /* dismissal is non-critical */ }
  };

  const restoreDismissal = async (id) => {
    try {
      const { data: rows } = await api.delete(`/onboard-verification/stakeholder-alert-dismissals/${id}`);
      setDismissals(Array.isArray(rows) ? rows : []);
    } catch { /* non-critical */ }
  };

  const load = useCallback(async () => {
    try {
      const [dupRes, dismissRes] = await Promise.allSettled([
        api.get('/onboard-verification/duplicate-stakeholders'),
        api.get('/onboard-verification/stakeholder-alert-dismissals'),
      ]);
      if (dupRes.status === 'fulfilled') setData(dupRes.value.data);
      if (dismissRes.status === 'fulfilled' && Array.isArray(dismissRes.value.data)) {
        setDismissals(dismissRes.value.data);
      }
    } catch {
      /* silent — notification bell is non-critical */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, DUPES_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const allDuplicates = data?.duplicates || [];
  const dismissalByKey = new Map(dismissals.map((d) => [d.alert_key, d]));
  const duplicates = allDuplicates.filter((d) => !dismissalByKey.has(alertKeyOf(d)));
  // Dismissed groups still matching current data — shown with a per-item Restore.
  const dismissedGroups = allDuplicates
    .filter((d) => dismissalByKey.has(alertKeyOf(d)))
    .map((d) => ({ group: d, dismissal: dismissalByKey.get(alertKeyOf(d)) }));
  const count = duplicates.length;

  const goToMerchant = (mid) => {
    setOpen(false);
    navigate(`/merchant-analysis?mid=${encodeURIComponent(mid)}`);
  };

  return (
    <div className="navbar-user-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`navbar-bell-btn${count > 0 ? ' navbar-bell-btn--alert' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Stakeholder cross-business alerts"
        aria-label="Notifications"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {count > 0 && <span className="navbar-bell-badge">{count > 99 ? '99+' : count}</span>}
      </button>

      {open && (
        <div className="navbar-dropdown navbar-dropdown--wide">
          <div className="navbar-dropdown-header">
            <span>Stakeholder Cross-Business Alerts</span>
            {count > 0 && <span className="navbar-dropdown-count">{count}</span>}
          </div>
          <div className="navbar-dropdown-divider" />
          <div className="navbar-dropdown-scroll">
            {loading && !data && (
              <div className="navbar-dropdown-empty">Checking for overlaps…</div>
            )}
            {!loading && count === 0 && (
              <div className="navbar-dropdown-empty">
                {dismissedGroups.length > 0
                  ? 'All alerts dismissed.'
                  : 'No stakeholder is registered under more than one business.'}
              </div>
            )}
            {duplicates.map((dup, i) => (
              <div key={`${dup.identifier}-${i}`} className="navbar-alert-item">
                <div className="navbar-alert-person">
                  <strong>{dup.businesses?.[0]?.name || '(unknown)'}</strong>
                  <span className="navbar-alert-idtype">{dup.match_type?.toUpperCase()}</span>
                  <button
                    type="button"
                    className="navbar-alert-dismiss"
                    onClick={() => dismissAlert(dup)}
                    title="Dismiss this alert (it returns if the person appears in a new business)"
                  >
                    ✕
                  </button>
                </div>
                <div className="navbar-alert-id">{dup.identifier}</div>
                <div className="navbar-alert-businesses">
                  {(dup.businesses || []).map((b, j) => (
                    <button
                      type="button"
                      key={j}
                      className="navbar-alert-business-link"
                      onClick={() => goToMerchant(b.mid)}
                    >
                      {b.business} <span className="navbar-alert-mid">MID {b.mid}</span>
                      {b.role ? <span className="navbar-alert-role"> · {b.role}</span> : null}
                      {b.source ? <span className="navbar-alert-role"> ({b.source})</span> : null}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {dismissedGroups.length > 0 && (
            <>
              <div className="navbar-dropdown-divider" />
              <div className="navbar-dropdown-header" style={{ paddingBottom: 6 }}>
                <span>Dismissed</span>
                <span className="navbar-dropdown-count">{dismissedGroups.length}</span>
              </div>
              {dismissedGroups.map(({ group, dismissal }) => (
                <div key={dismissal.id} className="navbar-alert-item navbar-alert-item--dismissed">
                  <div className="navbar-alert-person">
                    <span>{group.businesses?.[0]?.name || group.identifier}</span>
                    <span className="navbar-alert-id" style={{ marginTop: 0 }}>
                      {group.identifier} · {group.business_count} businesses
                      {dismissal.dismissed_by ? ` · by ${dismissal.dismissed_by}` : ''}
                    </span>
                    <button
                      type="button"
                      className="navbar-alert-restore"
                      onClick={() => restoreDismissal(dismissal.id)}
                    >
                      Restore
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Navbar() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  return (
    <nav className="navbar">
      <div />
      <div className="navbar-right">
        <StakeholderAlertsBell />
        <UserAvatar name={user.name} />
        <span className="navbar-user-name">{user.name || 'User'}</span>
      </div>
    </nav>
  );
}

export default Navbar;
