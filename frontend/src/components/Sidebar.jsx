import { useLocation, useNavigate } from 'react-router-dom';

const navItems = [
  {
    key: 'requirement',
    label: 'Merchant Requirement',
    path: '/requirement-config',
    available: true,
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
    ),
  },
  {
    key: 'verification',
    label: 'Onboard Verification',
    path: '/onboard-verification',
    available: true,
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        <polyline points="9 12 11 14 15 10"/>
      </svg>
    ),
  },
  {
    key: 'documentation',
    label: 'Documentation',
    path: null,
    available: false,
    icon: (
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        <line x1="9" y1="7" x2="15" y2="7"/>
        <line x1="9" y1="11" x2="13" y2="11"/>
      </svg>
    ),
  },
];

function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <aside className="sidebar">
      <div className="sidebar-section-label">Modules</div>
      <div className="sidebar-divider" />
      <nav className="sidebar-nav">
        {navItems.map((item) => {
          const isActive = item.path && location.pathname === item.path;
          return (
            <button
              key={item.key}
              className={[
                'sidebar-item',
                isActive ? 'sidebar-item--active' : '',
                !item.available ? 'sidebar-item--disabled' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => item.available && item.path && navigate(item.path)}
              title={item.label}
            >
              <span className="sidebar-icon">{item.icon}</span>
              <span className="sidebar-text">{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

export default Sidebar;
