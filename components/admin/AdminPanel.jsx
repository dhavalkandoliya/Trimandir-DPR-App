'use client';

import { useMemo, useState } from 'react';
import { apiMutate } from '../../lib/client/api';
import { formatQty } from '../../lib/materials/consumption';
import { useApp } from '../app/AppContext';
import Icon from '../ui/Icon';
import { siteDisplayName, toYMD, formatDisplayDate } from '../../lib/report/reportModel';
import { exportMasterLogCsv, exportMasterLogExcel, exportMasterLogPdf } from '../../lib/admin/masterLog';
import HierarchyAdmin from './HierarchyAdmin';
import MaterialsAdmin from './MaterialsAdmin';
import UsersAdmin from './UsersAdmin';

function localTodayYMD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function Overview() {
  const { history, projects, showToast } = useApp();
  const [exporting, setExporting] = useState(null);

  const stats = useMemo(() => {
    const today = localTodayYMD();
    const todays = history.filter(h => toYMD(h.date) === today);
    const counts = new Map();
    history.forEach(h => { if (h.site) counts.set(h.site, (counts.get(h.site) || 0) + 1); });
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      workforceToday: todays.reduce((s, h) => s + (Number(h.total) || 0), 0),
      reportsToday: todays.length,
      mostActive: top ? siteDisplayName(top[0], projects) : '—',
      mostActiveCount: top ? top[1] : 0,
      active: projects.filter(p => p.status === 'active').length,
      total: projects.length,
    };
  }, [history, projects]);

  const exportAs = async (kind) => {
    if (!history.length) { showToast('⚠️ No history records to export'); return; }
    setExporting(kind);
    try {
      if (kind === 'csv') exportMasterLogCsv(history);
      else if (kind === 'excel') await exportMasterLogExcel(history);
      else await exportMasterLogPdf(history);
      showToast(`✅ ${kind === 'csv' ? 'CSV' : kind === 'excel' ? 'Excel' : 'PDF'} exported`);
    } catch (err) {
      showToast(`⚠️ Export failed — ${err.message || 'try again'}`);
    } finally {
      setExporting(null);
    }
  };

  return (
    <>
      <div className="grid4">
        <div className="kpi accent"><span>Workforce today</span><b>{stats.workforceToday}</b><small>{stats.reportsToday} report{stats.reportsToday === 1 ? '' : 's'} filed</small></div>
        <div className="kpi"><span>Most active site</span><b className="text" title={stats.mostActive}>{stats.mostActive}</b><small>{stats.mostActiveCount} reports all time</small></div>
        <div className="kpi"><span>Active sites</span><b>{stats.active}</b><small>of {stats.total} in the list</small></div>
        <div className="kpi"><span>Reports on record</span><b>{history.length}</b><small>All sites, all time</small></div>
      </div>
      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Master log export</h2>
            <p className="hint">Every report flattened to one row per activity line.</p>
          </div>
          <div className="row" role="group" aria-label="Export master log">
            {[['csv', 'CSV'], ['excel', 'Excel'], ['pdf', 'PDF']].map(([k, label]) => (
              <button key={k} type="button" className="btn" onClick={() => exportAs(k)} disabled={!!exporting}>
                <Icon name={k === 'pdf' ? 'pdf' : 'down'} />{exporting === k ? 'Exporting…' : label}
              </button>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

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
  const [tab, setTab] = useState('overview');

  const tabs = [
    ['overview', 'Overview'],
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
          <p className="lede">Manage people, sites, the activity list and the material catalogue, and approve edit requests.</p>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="Admin sections">
        {tabs.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'overview' && <Overview />}
        {tab === 'requests' && <EditRequests pending={pending} pendingLogs={pendingLogs} />}
        {tab === 'users' && <UsersAdmin />}
        {tab === 'sites' && <HierarchyAdmin kind="projects" />}
        {tab === 'activities' && <HierarchyAdmin kind="activities" />}
        {tab === 'materials' && <MaterialsAdmin />}
      </div>
    </>
  );
}
