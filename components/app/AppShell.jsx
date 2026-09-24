'use client';

import AnalyticsDashboard from '../dashboard/AnalyticsDashboard';
import AdminPanel from '../admin/AdminPanel';
import DprEntryForm from '../dpr/DprEntryForm';
import HistoryScreen from '../history/HistoryScreen';
import MaterialsScreen from '../materials/MaterialsScreen';
import ErrorBoundary from '../ui/ErrorBoundary';
import { useApp } from './AppContext';
import LoginScreen from './LoginScreen';
import Toast from './Toast';

const TABS = [
  { id: 'Form', label: '📝 New DPR' },
  { id: 'History', label: '📂 History' },
  { id: 'Dashboard', label: '📊 Dashboard' },
  { id: 'Materials', label: '📦 Material Consumption' },
  { id: 'Admin', label: '⚙️ Admin', adminOnly: true },
];

// Every screen stays mounted while signed in (inactive tabs are just hidden)
// so a half-filled DPR form or the History filters survive a tab switch.
function TabPage({ id, children }) {
  const { activeTab } = useApp();
  const active = activeTab === id;
  return (
    <div className={`tab-page${active ? ' active' : ''}`} id={`tab${id}`} role="tabpanel" aria-labelledby={`tabBtn${id}`} hidden={!active}>
      <ErrorBoundary>{children}</ErrorBoundary>
    </div>
  );
}

export default function AppShell() {
  const { authStatus, user, logout, theme, toggleTheme, online, activeTab, switchTab } = useApp();
  const signedIn = authStatus === 'signedIn' && user;
  const isAdmin = signedIn && user.role === 'admin';

  return (
    <>
      {!signedIn && <LoginScreen />}

      {signedIn && (
        <div className="app-shell">
          <header className="header-wrap">
            <div>
              <div className="logo">📋 MAN POWER REPORT</div>
              <div className="sub">Trimandir Construction Project</div>
            </div>
            <div className="header-right">
              <div className="header-user">👤 {user.username}{isAdmin ? ' · Admin' : ''}</div>
              <div className="header-actions">
                <button type="button" className="btn-theme" onClick={toggleTheme} aria-label="Toggle dark mode" title="Toggle dark mode">
                  {theme === 'dark' ? '☀️' : '🌙'}
                </button>
                <button type="button" className="btn-signout" onClick={logout}>Sign Out</button>
              </div>
            </div>
          </header>

          {!online && <div id="offlineBadge" className="is-visible">⚠️ Offline Mode — data will sync on reconnect</div>}

          <nav className="tab-bar" role="tablist" aria-label="Sections">
            {TABS.filter(t => !t.adminOnly || isAdmin).map(t => (
              <button
                key={t.id}
                id={`tabBtn${t.id}`}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                className={`tab-btn${activeTab === t.id ? ' active' : ''}`}
                onClick={() => switchTab(t.id, { fromTabBar: true })}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <TabPage id="Form"><DprEntryForm /></TabPage>
          <TabPage id="History"><HistoryScreen /></TabPage>
          <TabPage id="Dashboard"><AnalyticsDashboard /></TabPage>
          <TabPage id="Materials"><MaterialsScreen /></TabPage>
          {isAdmin && <TabPage id="Admin"><AdminPanel /></TabPage>}

          <footer>© 2026 Trimandir Construction Project | Trimandir Site DPR</footer>
        </div>
      )}

      <Toast />
    </>
  );
}
