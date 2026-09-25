'use client';

import { Fragment, useMemo, useState } from 'react';
import { useApp } from '../app/AppContext';
import Icon from '../ui/Icon';
import { toTitleCase, toYMD } from '../../lib/report/reportModel';
import { useAdminAction } from './useAdminAction';

const PROTECTED = 'tpd-admin'; // also enforced server-side (lib/authSupabaseApi.js)
const INACTIVE_AFTER_DAYS = 3;
const EMPTY = { username: '', displayName: '', password: '', role: 'user' };

function formatDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
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
    <Fragment>
      <tr>
        <td>
          <b>{u.displayName ? toTitleCase(u.displayName) : u.username}</b>
          {isMe && <> <span className="tag">You</span></>}
          <div className="sub">{u.username}</div>
        </td>
        <td>{u.role === 'admin' ? <span className="tag warn">Administrator</span> : <span className="tag">Site supervisor</span>}</td>
        <td className="n">{stats.total}</td>
        <td>{stats.last || <span className="muted">Never</span>}</td>
        <td>{stats.inactive ? <span className="tag danger">Inactive</span> : <span className="tag ok">Active</span>}</td>
        <td className="acts">
          {isProtected ? <span className="tag">Protected</span> : (
            <>
              <button type="button" className={`icon-btn${resetting ? ' on' : ''}`} onClick={() => setResetting(r => !r)} aria-expanded={resetting} aria-label={`Reset password for ${u.username}`} title="Reset password"><Icon name="key" /></button>
              {!isMe && <button type="button" className="icon-btn danger" onClick={remove} disabled={busy} aria-label={`Delete ${u.username}`} title="Delete user"><Icon name="trash" /></button>}
            </>
          )}
        </td>
      </tr>
      {resetting && (
        <tr>
          <td colSpan={6}>
            <form className="inline-form" onSubmit={(e) => { e.preventDefault(); resetPassword(); }}>
              <input className="input" type="text" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder={`New password for ${u.username}`} autoComplete="new-password" aria-label="New password" autoFocus />
              <button type="submit" className="btn sm primary" disabled={busy || !newPass.trim()}>Save password</button>
              <button type="button" className="btn sm ghost" onClick={() => { setResetting(false); setNewPass(''); }}>Cancel</button>
            </form>
          </td>
        </tr>
      )}
    </Fragment>
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
      <form className="panel" onSubmit={create}>
        <h2 className="panel-title">Add user</h2>
        <div className="form-grid">
          <label className="field">
            <span>Username</span>
            <input className="input" value={form.username} onChange={set('username')} placeholder="e.g. site-manager-01" autoCapitalize="none" autoComplete="off" />
          </label>
          <label className="field">
            <span>Display name</span>
            <input className="input" value={form.displayName} onChange={set('displayName')} placeholder="e.g. Ramesh Patel" />
          </label>
          <label className="field">
            <span>Password</span>
            <input className="input" type="text" value={form.password} onChange={set('password')} placeholder="Set a password" autoComplete="new-password" />
          </label>
          <label className="field">
            <span>Role</span>
            <select className="select" value={form.role} onChange={set('role')}>
              <option value="user">Site supervisor</option>
              <option value="admin">Administrator</option>
            </select>
          </label>
          <button type="submit" className="btn primary" disabled={busy}><Icon name="plus" />Add user</button>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>Supervisors can create and view reports. Administrators also manage users, sites, lists and edit approvals.</p>
      </form>

      <div className="list-bar section-gap">
        <h2 className="panel-title">All users <em>({users.length})</em></h2>
      </div>
      <div className="list tscroll">
        <table className="dt">
          <thead>
            <tr><th>User</th><th>Role</th><th className="n">Reports filed</th><th>Last report</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {sorted.map(u => <UserRow key={u.username} u={u} stats={statsFor(u)} me={me} run={run} busy={busy} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}
