'use client';

import { useMemo, useState } from 'react';
import { useApp } from '../app/AppContext';
import { toTitleCase, toYMD } from '../../lib/report/reportModel';
import { useAdminAction } from './useAdminAction';

const PROTECTED = 'tpd-admin'; // also enforced server-side (lib/authSupabaseApi.js)
const INACTIVE_AFTER_DAYS = 3;
const EMPTY = { username: '', displayName: '', password: '', role: 'user' };

function formatDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}

function UserRow({ u, stats, me, run, busy }) {
  const [resetting, setResetting] = useState(false);
  const [newPass, setNewPass] = useState('');
  const isProtected = u.username.toLowerCase() === PROTECTED;
  const isMe = me && u.username.toLowerCase() === me.username.toLowerCase();

  const resetPassword = async () => {
    const p = newPass.trim();
    if (!p) return;
    if (isMe && !window.confirm('Changing your own password signs you out everywhere, including here. Continue?')) return;
    const ok = await run({ action: 'resetPassword', username: u.username, password: p }, { success: `🔑 Password updated for ${u.username}`, refresh: false });
    if (ok) { setResetting(false); setNewPass(''); }
  };

  const remove = () => {
    if (!window.confirm(`Delete user "${u.username}"? They are signed out immediately.`)) return;
    run({ action: 'deleteUser', username: u.username }, { success: `🗑️ ${u.username} deleted` });
  };

  return (
    <div className="admin-user-row admin-user-card">
      <div className="admin-user-head">
        <div>
          <span className="admin-user-info">👤 {u.username}</span>
          <span className={`admin-badge ${stats.inactive ? 'is-inactive' : 'is-active'}`}>{stats.inactive ? '⚠️ Inactive' : '🟢 Active'}</span>
          {isMe && <span className="admin-badge is-me">You</span>}
        </div>
        <div className="admin-row-actions">
          {isProtected ? <span className="admin-protected">Protected</span> : (
            <>
              <button type="button" className="btn-gray btn-sm admin-icon-btn" onClick={() => setResetting(r => !r)} aria-label={`Reset password for ${u.username}`} title="Reset password">🔑</button>
              {!isMe && <button type="button" className="btn-red btn-sm admin-icon-btn" onClick={remove} disabled={busy} aria-label={`Delete ${u.username}`} title="Delete user">🗑️</button>}
            </>
          )}
        </div>
      </div>
      <div className="admin-user-sub admin-user-grid">
        <div>Display: <b>{u.displayName ? toTitleCase(u.displayName) : u.username}</b></div>
        <div>Role: <b>{u.role === 'admin' ? 'Admin' : 'Supervisor'}</b></div>
        <div>Total DPRs: <b>{stats.total}</b></div>
        <div>Last Upload: <b>{stats.last || 'Never'}</b></div>
      </div>
      {resetting && (
        <form className="admin-inline-form" onSubmit={(e) => { e.preventDefault(); resetPassword(); }}>
          <input type="text" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder={`New password for ${u.username}`} autoComplete="new-password" aria-label="New password" />
          <button type="submit" className="btn-green btn-sm admin-inline-btn" disabled={busy || !newPass.trim()}>Save</button>
          <button type="button" className="btn-gray btn-sm admin-inline-btn" onClick={() => { setResetting(false); setNewPass(''); }}>Cancel</button>
        </form>
      )}
    </div>
  );
}

export default function UsersAdmin() {
  const { users, history, user: me, showToast } = useApp();
  const { run, busy } = useAdminAction();
  const [form, setForm] = useState(EMPTY);

  const statsByUser = useMemo(() => {
    const map = new Map();
    history.forEach(h => {
      const k = String(h.by || '').trim().toLowerCase();
      if (!k) return;
      const cur = map.get(k) || { total: 0, lastYmd: '' };
      cur.total += 1;
      const ymd = toYMD(h.date);
      if (ymd > cur.lastYmd) cur.lastYmd = ymd;
      map.set(k, cur);
    });
    return map;
  }, [history]);

  const statsFor = (u) => {
    const s = statsByUser.get(u.username.toLowerCase()) || { total: 0, lastYmd: '' };
    const days = s.lastYmd ? (Date.now() - new Date(s.lastYmd).getTime()) / 86_400_000 : Infinity;
    return { total: s.total, last: formatDate(s.lastYmd), inactive: days >= INACTIVE_AFTER_DAYS };
  };

  const create = async (e) => {
    e.preventDefault();
    const username = form.username.trim();
    const password = form.password.trim();
    if (!username || !password) { showToast('⚠️ Username and password required'); return; }
    if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) { showToast('⚠️ Username already exists'); return; }
    const ok = await run(
      { action: 'createUser', username, displayName: form.displayName.trim() || username, password, role: form.role },
      { success: `✅ User ${username} created`, pending: '⏳ Creating user...' }
    );
    if (ok) setForm(EMPTY);
  };

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const sorted = [...users].sort((a, b) => a.username.localeCompare(b.username));

  return (
    <>
      <form className="admin-form" onSubmit={create}>
        <div className="admin-form-title">➕ Create New User</div>
        <label htmlFor="newUsername">Username</label>
        <input id="newUsername" value={form.username} onChange={set('username')} placeholder="e.g. site-manager-01" autoCapitalize="none" autoComplete="off" />
        <label htmlFor="newDisplayName">Display Name</label>
        <input id="newDisplayName" value={form.displayName} onChange={set('displayName')} placeholder="e.g. Ramesh Patel" />
        <label htmlFor="newPassword">Password</label>
        <input id="newPassword" type="text" value={form.password} onChange={set('password')} placeholder="Set a password" autoComplete="new-password" />
        <label htmlFor="newRole">Role</label>
        <select id="newRole" value={form.role} onChange={set('role')}>
          <option value="user">User — Can create &amp; view DPRs</option>
          <option value="admin">Admin — Full access + Management</option>
        </select>
        <button type="submit" className="btn-green" disabled={busy}>✅ Create User</button>
      </form>
      <div className="admin-list-title">👥 All Users ({users.length})</div>
      <div className="admin-list-scroll">
        {sorted.map(u => <UserRow key={u.username} u={u} stats={statsFor(u)} me={me} run={run} busy={busy} />)}
      </div>
    </>
  );
}
