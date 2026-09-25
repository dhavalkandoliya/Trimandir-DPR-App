'use client';

import { useMemo, useState } from 'react';
import { apiMutate } from '../../lib/client/api';
import { formatQty } from '../../lib/materials/consumption';
import { useApp } from '../app/AppContext';
import Icon from '../ui/Icon';
import { siteDisplayName, toYMD, formatDisplayDate } from '../../lib/report/reportModel';
import HierarchyAdmin from './HierarchyAdmin';
import MaterialsAdmin from './MaterialsAdmin';
import UsersAdmin from './UsersAdmin';

function EditRequests({ pending, pendingLogs }) {
  const { projects, approveEdit, showToast, reloadMaterialLogs } = useApp();
  const [busy, setBusy] = useState(null);

  // Approve: an edit is granted (they may edit once); a delete removes the entry.
  const resolve = async (log, approve) => {
    const what = log.requestType === 'delete' ? 'delete' : 'edit';
    if (approve && what === 'delete' && !window.confirm(`Delete ${formatQty(log.qty)} ${log.unit} ${log.material_name} (${log.site}) permanently?`)) return;
    setBusy(log.id);
    try {
      const res = await apiMutate({ action: 'resolveMaterialLogRequest', id: log.id, approve });
      showToast(res.result === 'deleted' ? '🗑️ Entry deleted' : res.result === 'granted' ? `✅ ${log.requestedBy || 'They'} can now edit this entry` : 'Request declined');
      reloadMaterialLogs();
    } catch (err) {
      showToast(`⚠️ ${err.message || 'Action failed'}`);
    } finally {
      setBusy(null);
    }
  };

  if (!pending.length && !pendingLogs.length) {
    return <div className="list"><div className="empty"><h3>No requests waiting</h3><p className="muted">When a supervisor asks to change a locked report or consumption entry, it shows up here.</p></div></div>;
  }
  return (
    <div className="stack">
      {pending.length > 0 && (
        <section>
          <div className="list-bar"><h2 className="panel-title">Daily reports <em>({pending.length})</em></h2></div>
          <div className="list">
            {pending.map(item => (
              <div key={`${toYMD(item.date)}||${item.site}`} className="lrow simple">
                <div>
                  <b>{item.requestedBy || 'Someone'}</b> wants to edit <b>{siteDisplayName(item.site, projects)}</b>, {formatDisplayDate(item.date)}
                  <div className="sub">Originally filed by {item.by || '—'}.</div>
                </div>
                <div className="row">
                  <button type="button" className="btn sm primary" onClick={() => approveEdit(item)}><Icon name="check" />Allow edit</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {pendingLogs.length > 0 && (
        <section>
          <div className="list-bar"><h2 className="panel-title">Material consumption <em>({pendingLogs.length})</em></h2></div>
          <div className="list">
            {pendingLogs.map(log => {
              const del = log.requestType === 'delete';
              return (
                <div key={log.id} className="lrow simple">
                  <div>
                    <b>{log.requestedBy || 'Someone'}</b> wants to <b>{del ? 'delete' : 'edit'}</b> {formatQty(log.qty)} {log.unit} <b>{log.material_name}</b> — {siteDisplayName(log.site, projects)}, {formatDisplayDate(log.date)}
                    <div className="sub">
                      <span className={`tag ${del ? 'danger' : 'warn'}`}>{del ? 'Delete' : 'Edit'}</span> {log.ownership}{log.contractor ? ` · ${log.contractor}` : ''} · logged by {log.loggedBy || '—'}
                    </div>
                  </div>
                  <div className="row">
                    <button type="button" className="btn sm danger" onClick={() => resolve(log, false)} disabled={busy === log.id}>Decline</button>
                    <button type="button" className="btn sm primary" onClick={() => resolve(log, true)} disabled={busy === log.id}>
                      <Icon name={del ? 'trash' : 'check'} />{del ? 'Approve & delete' : 'Allow edit'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

export default function AdminPanel() {
  const { history, materialLogs } = useApp();
  const pending = useMemo(() => history.filter(h => h.editPermission === 'pending'), [history]);
  const pendingLogs = useMemo(() => materialLogs.filter(l => l.requestStatus === 'pending'), [materialLogs]);
  const pendingCount = pending.length + pendingLogs.length;
  const [tab, setTab] = useState('requests');

  const tabs = [
    ['requests', `Edit requests${pendingCount ? ` (${pendingCount})` : ''}`],
    ['users', 'Users'],
    ['sites', 'Sites'],
    ['activities', 'Activities'],
    ['materials', 'Material catalogue'],
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <p className="lede">Approve edit requests and manage people, sites, the activity list and the material catalogue. Today’s stats are on the Dashboard; log exports are on History and Materials.</p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Admin sections">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'requests' && <EditRequests pending={pending} pendingLogs={pendingLogs} />}
        {tab === 'users' && <UsersAdmin />}
        {tab === 'sites' && <HierarchyAdmin kind="projects" />}
        {tab === 'activities' && <HierarchyAdmin kind="activities" />}
        {tab === 'materials' && <MaterialsAdmin />}
      </div>
    </>
  );
}
