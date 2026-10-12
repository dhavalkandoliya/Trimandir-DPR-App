'use client';

import { useState } from 'react';
import { apiGet } from '../../lib/client/api';
import Icon from '../ui/Icon';

const when = (iso) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso || '') : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

// Admins only: a "View edit history" link that opens, in place, who
// changed this report, when, and what (Old → New) — lib/audit.js,
// dpr_audit_logs. kind 'dpr' (id = DPR id) or 'material' (id =
// submissionAuditId(), entryIds = the submission's entry ids).
export default function EditHistory({ kind, id, entryIds = [] }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ status: 'idle', items: [], error: '' });

  const load = async () => {
    setState({ status: 'loading', items: [], error: '' });
    try {
      const res = await apiGet('getAuditLog', { kind, id, entryIds: entryIds.join(',') });
      if (!Array.isArray(res)) throw new Error((res && res.error) || 'Could not load the history');
      setState({ status: 'ok', items: res, error: '' });
    } catch (err) {
      setState({ status: 'error', items: [], error: err.message || 'Could not load the history' });
    }
  };
  const toggle = () => {
    if (!open && state.status !== 'ok') load();
    setOpen(o => !o);
  };

  return (
    <div className="edit-history">
      <button type="button" className="history-link" aria-expanded={open} onClick={toggle}>
        <Icon name="list" />{open ? 'Hide edit history' : 'View edit history'}
      </button>
      {open && (
        <div className="history-panel">
          {state.status === 'loading' && <p className="muted small">Loading…</p>}
          {state.status === 'error' && <p className="small">⚠️ {state.error}</p>}
          {state.status === 'ok' && !state.items.length && (
            <p className="muted small">No edits recorded. Changes are recorded from when edit history was switched on.</p>
          )}
          {state.status === 'ok' && state.items.length > 0 && (
            <ol className="history-list">
              {state.items.map(h => (
                <li key={h.id}>
                  <div className="history-head">
                    <b>{h.changedBy || 'Someone'}</b>
                    <span className="muted small">{when(h.changedAt)}</span>
                    {h.action === 'DELETE' && <span className="tag danger">Deleted</span>}
                    {h.outsideApp && <span className="tag warn" title="Changed directly in the database, not through the app">Outside the app</span>}
                  </div>
                  <ul>{h.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
