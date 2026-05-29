import Navbar from './Navbar';
import Sidebar from './Sidebar';

export default function PageLayout({ children }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-right">
        <Navbar />
        <main className="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
