'use client';

import { useMemo, useState } from 'react';
import { useApp } from '../app/AppContext';
import { siteDisplayName, toYMD } from '../../lib/report/reportModel';
import { exportMasterLogCsv, exportMasterLogExcel, exportMasterLogPdf } from '../../lib/admin/masterLog';
import HierarchyAdmin from './HierarchyAdmin';
import MaterialsAdmin from './MaterialsAdmin';
import UsersAdmin from './UsersAdmin';

function localTodayYMD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(ymd || '');
}

export function Accordion({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="admin-acc-card">
      <button type="button" className="admin-acc-header" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span>{title}</span>
        <span className="admin-acc-icon" aria-hidden="true">{open ? '▼' : '▶'}</span>
      </button>
      {open && <div className="admin-acc-body open">{children}</div>}
    </section>
  );
}

function AdminAnalytics() {
  const { history, projects, showToast } = useApp();
  const [exporting, setExporting] = useState(null);

  const stats = useMemo(() => {
    const today = localTodayYMD();
    const workforceToday = history.filter(h => toYMD(h.date) === today).reduce((s, h) => s + (Number(h.total) || 0), 0);
    const counts = new Map();
    history.forEach(h => { if (h.site) counts.set(h.site, (counts.get(h.site) || 0) + 1); });
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      workforceToday,
      mostActive: top ? siteDisplayName(top[0], projects) : '—',
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
      showToast(`✅ ${kind === 'csv' ? 'CSV' : kind === 'excel' ? 'Excel' : 'PDF'} exported!`);
    } catch (err) {
      showToast(`⚠️ Export failed — ${err.message || 'try again'}`);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="card">
      <div className="section-title">📊 Admin Analytics Dashboard</div>
      <div className="dash-grid admin-stats">
        <div className="dash-stat"><div className="num">{stats.workforceToday}</div><div className="lbl">Workforce Today</div></div>
        <div className="dash-stat"><div className="num admin-stat-text" title={stats.mostActive}>{stats.mostActive}</div><div className="lbl">Most Active Site</div></div>
        <div className="dash-stat"><div className="num">{stats.active}/{stats.total}</div><div className="lbl">Active Projects</div></div>
      </div>
      <div className="admin-export-bar" role="group" aria-label="Export master log">
        {[['csv', '📥 CSV'], ['excel', '📊 Excel'], ['pdf', '📄 PDF']].map(([k, label]) => (
          <button key={k} type="button" className="btn-green btn-sm" onClick={() => exportAs(k)} disabled={!!exporting}>
            {exporting === k ? '⏳' : label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PendingEditRequests() {
  const { history, projects, approveEdit } = useApp();
  const pending = useMemo(() => history.filter(h => h.editPermission === 'pending'), [history]);
  return (
    <div className="card">
      <div className="section-title">✏️ Pending Edit Requests</div>
      {pending.length ? pending.map(item => (
        <div key={`${toYMD(item.date)}||${item.site}`} className="admin-user-row">
          <div>
            <div className="admin-user-info">📅 {formatDate(toYMD(item.date))} · 📍 {siteDisplayName(item.site, projects)}</div>
            <div className="admin-user-sub">Requested by: <b>{item.requestedBy || '—'}</b> · Prepared by {item.by || '—'}</div>
          </div>
          <button type="button" className="btn-green btn-sm admin-inline-btn" onClick={() => approveEdit(item)}>✅ Approve</button>
        </div>
      )) : <p className="history-empty">✅ No pending requests.</p>}
    </div>
  );
}

export default function AdminPanel() {
  return (
    <>
      <AdminAnalytics />
      <PendingEditRequests />
      <Accordion title="⚙️ Create / Manage Users" defaultOpen><UsersAdmin /></Accordion>
      <Accordion title="📍 Manage Projects & Sub-Projects"><HierarchyAdmin kind="projects" /></Accordion>
      <Accordion title="📋 Manage Activities & Sub-Activities"><HierarchyAdmin kind="activities" /></Accordion>
      <Accordion title="🧱 Manage Materials"><MaterialsAdmin /></Accordion>
    </>
  );
}
