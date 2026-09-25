'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import AnalyticsDashboard from '../dashboard/AnalyticsDashboard';
import AdminPanel from '../admin/AdminPanel';
import DprEntryForm from '../dpr/DprEntryForm';
import HistoryScreen from '../history/HistoryScreen';
import MaterialsScreen from '../materials/MaterialsScreen';
import ErrorBoundary from '../ui/ErrorBoundary';
import Icon from '../ui/Icon';
import { toYMD } from '../../lib/report/reportModel';
import { useApp } from './AppContext';
import LoginScreen from './LoginScreen';
import Toast from './Toast';

const TABS = [
  { id: 'Dashboard', label: 'Dashboard', short: 'Dashboard', icon: 'dashboard' },
  { id: 'Form', label: 'New report', short: 'Report', icon: 'entry' },
  { id: 'History', label: 'History', short: 'History', icon: 'history' },
  { id: 'Materials', label: 'Materials', short: 'Materials', icon: 'materials' },
  { id: 'Admin', label: 'Admin', short: 'Admin', icon: 'admin', adminOnly: true },
];

function todayYMD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const initials = (name) => String(name || '?').trim().split(/[\s._-]+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2) || '?';

// Every screen stays mounted while signed in (inactive tabs are just hidden)
// so a half-filled DPR form or the History filters survive a tab switch.
function TabPage({ id, children }) {
  const { activeTab } = useApp();
  const active = activeTab === id;
  return (
    <section id={`tab${id}`} aria-label={TABS.find(t => t.id === id).label} hidden={!active}>
      <ErrorBoundary>{children}</ErrorBoundary>
    </section>
  );
}

// Online / syncing / last-synced indicator — the stale-while-revalidate status.
function SyncStatus() {
  const { online, historyStatus } = useApp();
  const [syncedAt, setSyncedAt] = useState(null);
  const [, tick] = useState(0);
  useEffect(() => { if (historyStatus === 'ok') setSyncedAt(Date.now()); }, [historyStatus]);
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 30_000); return () => clearInterval(t); }, []);

  let cls = 'sync', text;
  if (!online) { cls += ' off'; text = 'Offline — entries sync on reconnect'; }
  else if (historyStatus === 'loading') { cls += ' busy'; text = 'Syncing…'; }
  else if (historyStatus === 'error') { cls += ' busy'; text = 'Could not sync — showing saved data'; }
  else if (syncedAt) {
    const m = Math.round((Date.now() - syncedAt) / 60_000);
    text = m < 1 ? 'Synced just now' : `Synced ${m} min ago`;
  } else text = 'Connecting…';
  return <div className={cls} role="status"><span className="dot" /><span className="sync-text">{text}</span></div>;
}

function UserMenu() {
  const { user, logout } = useApp();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const name = user.displayName || user.username;
  const role = user.role === 'admin' ? 'Administrator' : 'Site supervisor';

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="user-wrap" ref={wrapRef}>
      <button type="button" className="user-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="avatar">{initials(name)}</span>
        <span className="user-meta"><b>{name}</b><span>{role}</span></span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="mhead"><b>{name}</b>{user.username} · {role}</div>
          <hr />
          <button type="button" role="menuitem" onClick={() => { setOpen(false); logout(); }}>
            <Icon name="logout" />Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function AppShell() {
  const { authStatus, user, theme, toggleTheme, activeTab, switchTab, history, materialLogs } = useApp();
  const signedIn = authStatus === 'signedIn' && user;
  const isAdmin = signedIn && user.role === 'admin';
  const tabs = TABS.filter(t => !t.adminOnly || isAdmin);

  const pendingEdits = useMemo(
    () => history.filter(h => h.editPermission === 'pending').length + materialLogs.filter(l => l.requestStatus === 'pending').length,
    [history, materialLogs]
  );
  const filedToday = useMemo(() => {
    const t = todayYMD();
    return new Set(history.filter(h => toYMD(h.date) === t).map(h => String(h.site || '').trim())).size;
  }, [history]);

  useEffect(() => { window.scrollTo(0, 0); }, [activeTab]);

  const go = (id) => switchTab(id, { fromTabBar: true });
  const count = (t) => (t.id === 'Admin' && pendingEdits ? <span className="count" aria-label={`${pendingEdits} pending`}>{pendingEdits}</span> : null);

  return (
    <>
      {!signedIn && <LoginScreen />}

      {signedIn && (
        <>
          <div className="shell">
            <aside className="side">
              <div className="stripe" aria-hidden="true" />
              <div className="brand">
                <div className="brand-name">Trimandir DPR</div>
                <div className="brand-sub">Construction site reporting</div>
              </div>
              <nav className="nav" aria-label="Main">
                {tabs.map(t => (
                  <button key={t.id} type="button" className={activeTab === t.id ? 'on' : ''} aria-current={activeTab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
                    <Icon name={t.icon} /><span>{t.label}</span>{count(t)}
                  </button>
                ))}
              </nav>
              <div className="side-foot">
                {filedToday === 1 ? '1 site reported today' : `${filedToday} sites reported today`}
              </div>
            </aside>

            <div className="main">
              <header className="topbar">
                <div className="mobile-brand">Trimandir DPR</div>
                <SyncStatus />
                <div className="spacer" />
                <button type="button" className="icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} title="Toggle dark mode">
                  <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
                </button>
                <UserMenu />
              </header>

              <main className="content" id="view" tabIndex={-1}>
                <TabPage id="Dashboard"><AnalyticsDashboard /></TabPage>
                <TabPage id="Form"><DprEntryForm /></TabPage>
                <TabPage id="History"><HistoryScreen /></TabPage>
                <TabPage id="Materials"><MaterialsScreen /></TabPage>
                {isAdmin && <TabPage id="Admin"><AdminPanel /></TabPage>}
              </main>
            </div>
          </div>

          <nav className="bottom-nav" aria-label="Main" style={{ gridTemplateColumns: `repeat(${tabs.length},1fr)` }}>
            {tabs.map(t => (
              <button key={t.id} type="button" className={activeTab === t.id ? 'on' : ''} aria-current={activeTab === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
                <Icon name={t.icon} /><span>{t.short}</span>{count(t)}
              </button>
            ))}
          </nav>
        </>
      )}

      <Toast />
    </>
  );
}
