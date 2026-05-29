function UserAvatar({ name }) {
  const initials = (name || 'U')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return <div className="navbar-avatar">{initials}</div>;
}

function Navbar() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  return (
    <nav className="navbar">
      <div />
      <div className="navbar-right">
        <UserAvatar name={user.name} />
        <span className="navbar-user-name">{user.name || 'User'}</span>
      </div>
    </nav>
  );
}

export default Navbar;
