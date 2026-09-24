'use client';

// App-wide state for the React DPR app: the signed-in session, the shared
// data (projects/activities/materials/users, DPR history, consumption
// entries), the IndexedDB cache that repaints the last session's data
// instantly, toasts, tabs, theme, and the offline queue.
//
// Replaces the legacy index.html script's globals (_projects, _history …),
// its window.__get* bridge and 'dpr:*' event bus.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AUTH_EXPIRED_EVENT, apiGet, apiPost } from '../../lib/client/api';
import { cacheClear, cacheGet, cacheSet } from '../../lib/client/idbCache';

const AppContext = createContext(null);
export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp() must be used inside <AppProvider>');
  return ctx;
};

export const OFFLINE_QUEUE_KEY = 'dprOfflineQ';
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const EMPTY_MASTER = { projects: [], activities: [], materials: [], users: [] };

export function recordKey(item) {
  const d = String(item.date || '').slice(0, 10);
  return `${d}||${String(item.site || '').trim()}`;
}

export function readOfflineQueue() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]'); } catch { return []; }
}
export function enqueueOffline(payloads) {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify([...readOfflineQueue(), ...payloads]));
    return true;
  } catch {
    return false;
  }
}

// Wraps a state setter so it's ignored if the session changed meanwhile.
function guardFor(epochRef, fn) {
  const at = epochRef.current;
  return (...args) => { if (epochRef.current === at) fn(...args); };
}

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState('checking'); // 'checking' | 'signedOut' | 'signedIn'
  const [authMessage, setAuthMessage] = useState('');

  const [master, setMaster] = useState(EMPTY_MASTER);
  const [history, setHistory] = useState([]);
  const [historyStatus, setHistoryStatus] = useState('idle');
  const [materialLogs, setMaterialLogs] = useState([]);
  const [materialLogsStatus, setMaterialLogsStatus] = useState('idle');

  const [activeTab, setActiveTab] = useState('Form');
  const [toast, setToast] = useState(null); // { id, msg, action?: { label, onClick } }
  const [entryCommand, setEntryCommand] = useState(null); // { seq, cmd }
  const [theme, setTheme] = useState('light');
  const [online, setOnline] = useState(true);

  // Bumped on every sign-in/sign-out so a slow response from the previous
  // session can never land in the next one's state.
  const epoch = useRef(0);
  const authStatusRef = useRef('checking');
  useEffect(() => { authStatusRef.current = authStatus; }, [authStatus]);
  const toastTimer = useRef(null);
  const cmdSeq = useRef(0);

  // ── Toasts ──────────────────────────────────────────────────────────
  const showToast = useCallback((msg) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), msg });
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);
  const showActionToast = useCallback((msg, label, onClick) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), msg, action: { label, onClick } });
    toastTimer.current = setTimeout(() => setToast(null), 6000); // a decision, not a glance
  }, []);
  const hideToast = useCallback(() => { clearTimeout(toastTimer.current); setToast(null); }, []);

  const sendEntryCommand = useCallback((cmd) => setEntryCommand({ seq: ++cmdSeq.current, cmd }), []);

  // ── Data loading (stale-while-revalidate over IndexedDB) ───────────

  const reloadMaster = useCallback(async () => {
    const apply = guardFor(epoch, (fn) => setMaster(fn));
    try {
      const res = await apiGet('getBootstrapData');
      if (!res || res.error) throw new Error(res && res.error);
      // The server omits any table whose query failed (partialErrors) — keep
      // the previous list for those rather than blanking the dropdowns.
      let merged = null;
      apply((prev) => {
        merged = {
          projects: Array.isArray(res.projects) ? res.projects : prev.projects,
          activities: Array.isArray(res.activities) ? res.activities : prev.activities,
          materials: Array.isArray(res.materials) ? res.materials : prev.materials,
          users: Array.isArray(res.users) ? res.users : prev.users,
        };
        return merged;
      });
      if (merged) cacheSet('bootstrap', merged);
      return merged || true;
    } catch (e) {
      return null; // keep whatever is cached — a stale view beats a broken one
    }
  }, []);

  const reloadHistory = useCallback(async () => {
    const set = guardFor(epoch, setHistory), setStatus = guardFor(epoch, setHistoryStatus);
    setStatus('loading');
    try {
      const res = await apiGet('');
      if (!Array.isArray(res)) throw new Error(res && res.error);
      set(res);
      cacheSet('dprHistory', res);
      setStatus('ok');
    } catch {
      setStatus('error');
    }
  }, []);

  const reloadMaterialLogs = useCallback(async () => {
    const set = guardFor(epoch, setMaterialLogs), setStatus = guardFor(epoch, setMaterialLogsStatus);
    setStatus('loading');
    try {
      const res = await apiGet('getMaterialLogs');
      if (!Array.isArray(res)) throw new Error(res && res.error);
      set(res);
      cacheSet('materialLogs', res);
      setStatus('ok');
    } catch {
      setStatus('error');
    }
  }, []);

  // ── Auth ────────────────────────────────────────────────────────────
  const beginSession = useCallback((u) => {
    epoch.current += 1;
    setUser(u);
    setAuthMessage('');
    setAuthStatus('signedIn');
  }, []);

  const endSession = useCallback((message) => {
    epoch.current += 1;
    setUser(null);
    setAuthStatus('signedOut');
    setAuthMessage(message || '');
    setActiveTab('Form');
    setEntryCommand(null); // a pending 'edit' must not replay into the next session
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiGet('session')
      .then((res) => { if (!cancelled) (res && res.user ? beginSession(res.user) : endSession('')); })
      .catch(() => { if (!cancelled) endSession("⚠️ Can't reach the server — check your connection."); });
    return () => { cancelled = true; };
  }, [beginSession, endSession]);

  useEffect(() => {
    const onExpired = () => {
      if (authStatusRef.current === 'signedIn') endSession('🔒 Your session expired — please sign in again.');
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [endSession]);

  const login = useCallback(async (username, password) => {
    const res = await apiPost({ action: 'login', username, password });
    if (res && res.success && res.user) beginSession(res.user);
    return res;
  }, [beginSession]);

  const logout = useCallback(async () => {
    apiPost({ action: 'logout' }).catch(() => {});
    endSession('');
    setMaster(EMPTY_MASTER);
    setHistory([]);
    setMaterialLogs([]);
    setHistoryStatus('idle');
    setMaterialLogsStatus('idle');
    cacheClear(); // may be a shared site-office device
  }, [endSession]);

  // Boot once per sign-in: paint from cache, then refresh everything.
  useEffect(() => {
    if (authStatus !== 'signedIn') return;
    const at = epoch.current;
    (async () => {
      const [b, h, m] = await Promise.all([cacheGet('bootstrap'), cacheGet('dprHistory'), cacheGet('materialLogs')]);
      if (epoch.current !== at) return;
      if (b && Array.isArray(b.projects)) setMaster({ ...EMPTY_MASTER, ...b });
      if (Array.isArray(h)) setHistory(h);
      if (Array.isArray(m)) setMaterialLogs(m);
      if (!b) showToast('⏳ Loading data...');
      sendEntryCommand({ type: 'init' }); // form restores this user's draft, if any
      const results = await Promise.all([reloadMaster(), reloadHistory(), reloadMaterialLogs()]);
      if (!results[0] && !b && epoch.current === at) showToast('⚠️ Could not reach server');
    })();
  }, [authStatus, reloadMaster, reloadHistory, reloadMaterialLogs, sendEntryCommand, showToast]);

  // ── Theme ───────────────────────────────────────────────────────────
  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  }, []);
  const toggleTheme = useCallback(() => {
    setTheme((cur) => {
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('dprTheme', next); } catch {}
      return next;
    });
  }, []);

  // ── Offline queue ───────────────────────────────────────────────────
  // Sequential and lossless: only entries the server accepted (or already
  // has — a 'duplicate' DPR) leave the queue; anything that failed stays for
  // the next attempt. (The old version cleared the queue even on failure.)
  const syncing = useRef(false);
  const syncOfflineQueue = useCallback(async () => {
    if (syncing.current) return;
    const queue = readOfflineQueue();
    if (!queue.length) return;
    syncing.current = true;
    showToast(`🔄 Syncing ${queue.length} queued entr${queue.length === 1 ? 'y' : 'ies'}...`);
    const remaining = [];
    let authLost = false;
    for (const payload of queue) {
      if (authLost) { remaining.push(payload); continue; }
      try {
        const res = await apiPost(payload);
        if (res && res.code === 'AUTH_REQUIRED') { authLost = true; remaining.push(payload); }
        else if (res && res.error) remaining.push(payload);
      } catch {
        remaining.push(payload);
      }
    }
    try { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining)); } catch {}
    syncing.current = false;
    const done = queue.length - remaining.length;
    showToast(remaining.length ? `⚠️ Synced ${done}, ${remaining.length} still queued — will retry` : `✅ All ${done} synced!`);
    if (done) { reloadHistory(); reloadMaterialLogs(); }
  }, [showToast, reloadHistory, reloadMaterialLogs]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => { setOnline(true); if (authStatus === 'signedIn') syncOfflineQueue(); };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [authStatus, syncOfflineQueue]);

  useEffect(() => {
    if (authStatus === 'signedIn' && navigator.onLine) syncOfflineQueue(); // anything left from a previous visit
  }, [authStatus, syncOfflineQueue]);

  // ── Tabs & cross-screen actions ─────────────────────────────────────
  const switchTab = useCallback((tab, { fromTabBar = false } = {}) => {
    setActiveTab(tab);
    // Clicking "New DPR" restores the draft (or a blank form), leaving any edit.
    if (tab === 'Form' && fromTabBar) sendEntryCommand({ type: 'init' });
    if (tab === 'Materials') reloadMaterialLogs();
  }, [sendEntryCommand, reloadMaterialLogs]);

  const canEdit = useCallback((item) => {
    if (!user) return { ok: false, reason: '⚠️ Please sign in first' };
    if (user.role === 'admin') return { ok: true };
    if (String(item.by || '').toLowerCase() !== user.username.toLowerCase()) return { ok: false, reason: '❌ You can only edit your own DPRs' };
    const sub = Number(item.submittedAt) || (item.submittedAt ? new Date(item.submittedAt).getTime() : 0);
    if ((sub && Date.now() - sub < EDIT_WINDOW_MS) || item.editPermission === 'granted') return { ok: true };
    return { ok: false, reason: '🔒 Edit window expired. Request Edit first.' };
  }, [user]);

  const editDpr = useCallback((item) => {
    const check = canEdit(item); // the server enforces the same rule
    if (!check.ok) { showToast(check.reason); return; }
    sendEntryCommand({ type: 'edit', record: item });
    setActiveTab('Form');
    showToast('✏️ Loaded for editing — click Update DPR when done');
  }, [canEdit, sendEntryCommand, showToast]);

  const requestEdit = useCallback(async (item) => {
    if (!window.confirm('Request edit permission from Admin for this DPR?')) return;
    showToast('📤 Sending request...');
    try {
      const res = await apiPost({ action: 'requestEditDPR', key: recordKey(item) });
      if (res && res.error) { showToast('⚠️ Request failed: ' + res.error); return; }
      showToast('✅ Request sent!');
      reloadHistory();
    } catch { showToast('⚠️ Request failed — check connection'); }
  }, [showToast, reloadHistory]);

  const approveEdit = useCallback(async (item) => {
    if (!window.confirm('Approve edit access for this DPR?')) return;
    showToast('⏳ Approving...');
    try {
      const res = await apiPost({ action: 'approveEditDPR', key: recordKey(item) });
      if (res && res.error) { showToast('⚠️ Approval failed: ' + res.error); return; }
      showToast('✅ Edit access granted!');
      reloadHistory();
    } catch { showToast('⚠️ Approval failed — check connection'); }
  }, [showToast, reloadHistory]);

  const deleteDpr = useCallback(async (item) => {
    if (!user || user.role !== 'admin') { showToast('❌ Only Admin can delete'); return; }
    if (!window.confirm('Delete this DPR record permanently?')) return;
    try {
      const res = await apiPost({ action: 'delete', id: recordKey(item) });
      if (res && res.error) { showToast('⚠️ Delete failed: ' + res.error); return; }
      showToast('🗑️ Deleted!');
      reloadHistory();
    } catch { showToast('⚠️ Delete failed — check connection'); }
  }, [user, showToast, reloadHistory]);

  const value = useMemo(() => ({
    // auth
    user, authStatus, authMessage, login, logout,
    // data
    projects: master.projects, activities: master.activities, materials: master.materials, users: master.users,
    history, historyStatus, materialLogs, materialLogsStatus,
    reloadMaster, reloadHistory, reloadMaterialLogs,
    // ui
    activeTab, switchTab, toast, showToast, showActionToast, hideToast, theme, toggleTheme, online,
    entryCommand, sendEntryCommand,
    // DPR actions
    canEdit, editDpr, requestEdit, approveEdit, deleteDpr, syncOfflineQueue,
  }), [user, authStatus, authMessage, login, logout, master, history, historyStatus, materialLogs, materialLogsStatus,
    reloadMaster, reloadHistory, reloadMaterialLogs, activeTab, switchTab, toast, showToast, showActionToast, hideToast,
    theme, toggleTheme, online, entryCommand, sendEntryCommand, canEdit, editDpr, requestEdit, approveEdit, deleteDpr, syncOfflineQueue]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
