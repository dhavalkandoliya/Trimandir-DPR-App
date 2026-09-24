'use client';

import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../../lib/client/api';
import { useApp } from './AppContext';

export default function LoginScreen() {
  const { authStatus, authMessage, login } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState({ text: '', tone: 'error' });
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState([]);
  const passRef = useRef(null);
  const checking = authStatus === 'checking';

  useEffect(() => { if (authMessage) setMessage({ text: authMessage, tone: 'error' }); }, [authMessage]);

  // Quick-select chips: account names only (public, pre-login).
  useEffect(() => {
    apiGet('getUsers')
      .then((list) => { if (Array.isArray(list)) setNames(list.map(u => u.username)); })
      .catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || checking) return;
    const u = username.trim();
    const p = password.trim();
    if (!u || !p) { setMessage({ text: '❌ Enter username and password.', tone: 'error' }); return; }
    setBusy(true);
    setMessage({ text: '⏳ Authenticating...', tone: 'info' });
    try {
      const res = await login(u, p);
      if (res && res.success) { setPassword(''); setMessage({ text: '', tone: 'info' }); return; }
      setMessage({ text: res && res.error ? `❌ Server Error: ${res.error}` : '❌ Invalid username or password.', tone: 'error' });
    } catch {
      setMessage({ text: '⚠️ Connection error. Try again.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="loginOverlay">
      <form className="login-box" onSubmit={submit} noValidate>
        <div className="login-logo">📋 DPR — Man Power Report</div>
        <div className="login-sub">Trimandir Construction Project</div>
        <label htmlFor="loginName" className="login-label">Username</label>
        <input
          id="loginName" type="text" value={username} onChange={(e) => setUsername(e.target.value)}
          placeholder="Enter username" autoCapitalize="none" autoCorrect="off" autoComplete="username" disabled={checking}
        />
        <label htmlFor="loginPass" className="login-label">Password</label>
        <input
          id="loginPass" ref={passRef} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password" autoCapitalize="none" autoCorrect="off" autoComplete="current-password" disabled={checking}
        />
        <button type="submit" className="btn-green login-submit" disabled={busy || checking}>
          {checking ? '⏳ Restoring session…' : busy ? '⏳ Signing in…' : 'Sign In →'}
        </button>
        <div className={`login-err${message.tone === 'info' ? ' is-info' : ''}`} role="alert">{message.text}</div>
        <div className="login-hint">Please sign in to continue</div>
      </form>
      {names.length > 0 && (
        <div className="login-chips-wrap">
          <div className="login-chips-title">— Quick Select —</div>
          <div className="user-chips">
            {names.map(n => (
              <button key={n} type="button" className="user-chip" onClick={() => { setUsername(n); passRef.current?.focus(); }}>{n}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
