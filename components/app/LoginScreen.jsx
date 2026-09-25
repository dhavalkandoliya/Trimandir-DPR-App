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
    if (!u || !p) { setMessage({ text: 'Enter your username and password.', tone: 'error' }); return; }
    setBusy(true);
    setMessage({ text: 'Signing in…', tone: 'info' });
    try {
      const res = await login(u, p);
      if (res && res.success) { setPassword(''); setMessage({ text: '', tone: 'info' }); return; }
      setMessage({ text: res && res.error ? `Server error: ${res.error}` : 'That username and password don’t match.', tone: 'error' });
    } catch {
      setMessage({ text: 'Connection error — check your network and try again.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit} noValidate>
        <div className="stripe" aria-hidden="true" />
        <div className="login-brand">
          <div className="brand-name">Trimandir DPR</div>
          <div className="brand-sub">Construction site reporting</div>
        </div>
        <div className="login-body stack">
          <div>
            <h1>Sign in</h1>
            <p className="lede">Trimandir Construction Project</p>
          </div>
          <label className="field">
            <span>Username</span>
            <input
              className="input" type="text" value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username" autoCapitalize="none" autoCorrect="off" autoComplete="username" disabled={checking}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              ref={passRef} className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password" autoCapitalize="none" autoCorrect="off" autoComplete="current-password" disabled={checking}
            />
          </label>
          <button type="submit" className="btn primary lg block" disabled={busy || checking}>
            {checking ? 'Restoring session…' : busy ? 'Signing in…' : 'Sign in'}
          </button>
          <div className={`login-msg${message.tone === 'info' ? ' info' : ''}`} role="alert">{message.text}</div>
        </div>
      </form>
      {names.length > 0 && (
        <div className="login-names">
          <p className="hint">Quick select</p>
          <div className="chips">
            {names.map(n => (
              <button
                key={n} type="button" className="chip plain" aria-pressed={username === n}
                onClick={() => { setUsername(n); passRef.current?.focus(); }}
              >
                <span className="cdot" />{n}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
