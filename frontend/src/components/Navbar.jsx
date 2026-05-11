import { useNavigate } from 'react-router-dom';

function Navbar() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <span className="brand-title">
          AI-Onboarding<span>-V2</span>
        </span>
        <span className="brand-sub">Merchant Onboarding Platform</span>
      </div>
      <div className="navbar-right">
        <span className="navbar-user">{user.name || 'User'}</span>
        <button className="btn-logout" onClick={handleLogout}>Sign out</button>
      </div>
    </nav>
  );
}

export default Navbar;
