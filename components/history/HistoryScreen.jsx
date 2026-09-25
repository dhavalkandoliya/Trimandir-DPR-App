'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../app/AppContext';
import ExecutiveReport, { ConditionBadge } from '../report/ExecutiveReport';
import ReportActionBar from '../report/ReportActionBar';
import Dialog from '../ui/Dialog';
import ExportButtons from '../ui/ExportButtons';
import { exportDprLogCsv, exportDprLogExcel, exportDprLogPdf } from '../../lib/exports/logExports';
import Icon from '../ui/Icon';
import { runReportAction } from '../../lib/report/exportReport';
import { CONDITIONS, recordActivities, reportFromRecord, siteDisplayName, toYMD } from '../../lib/report/reportModel';

const PAGE_SIZE = 15;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const EMPTY_FILTERS = { start: '', end: '', site: '', supervisor: '', condition: '' };

function todayYMD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const parseYMD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
function shortDate(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || '—';
  return parseYMD(ymd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function relDay(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const days = Math.round((parseYMD(todayYMD()) - parseYMD(ymd)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return parseYMD(ymd).toLocaleDateString('en-IN', { weekday: 'short' });
}

const recordKey = (item) => toYMD(item.date) + '||' + String(item.site).trim();
const submittedMs = (item) => Number(item.submittedAt) || (item.submittedAt ? new Date(item.submittedAt).getTime() : 0);
const timeOf = (item) => {
  const ms = submittedMs(item);
  return ms ? new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '';
};

// Same edit-permission rules as AppContext canEdit() and the server
// (lib/dprSupabaseApi.js editDPR) — this only picks the button.
function editAction(item, user) {
  const isAdmin = user && user.role === 'admin';
  const isOwn = user && item.by === user.username;
  const ms = submittedMs(item);
  const withinWindow = ms && (Date.now() - ms) < EDIT_WINDOW_MS;
  const granted = item.editPermission === 'granted';
  const pending = item.editPermission === 'pending';
  if (!isAdmin && isOwn && !withinWindow && !granted && !pending) return 'request';
  if (!isAdmin && isOwn && pending) return 'pending';
  if (!isAdmin && !isOwn) return 'forbidden';
  return 'edit';
}

function DprViewDialog({ item, projects, materialLogs, autoOpenShare, canEditIt, onEdit, onClose }) {
  const report = useMemo(() => reportFromRecord(item, projects, materialLogs), [item, projects, materialLogs]);
  return (
    <Dialog
      title={`${report.siteDisplay}, ${shortDate(report.date)}`}
      paper
      onClose={onClose}
      footer={<>
        {canEditIt && <button type="button" className="btn push" onClick={onEdit}><Icon name="edit" />Edit</button>}
        <ReportActionBar report={report} autoOpenShare={autoOpenShare} />
      </>}
    >
      <ExecutiveReport report={report} />
    </Dialog>
  );
}

function SkeletonList() {
  return (
    <div className="list" aria-busy="true" aria-label="Loading reports">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="lrow">
          <div className="skel" style={{ height: 34 }} />
          <div className="skel" style={{ height: 34 }} />
          <div className="skel" style={{ height: 22, width: 90 }} />
          <div className="skel" style={{ height: 26, width: 40 }} />
          <div className="skel" style={{ height: 30 }} />
          <div className="skel" style={{ height: 30 }} />
        </div>
      ))}
    </div>
  );
}

function HistoryRow({ item, projects, user, onView, onAction }) {
  const edit = editAction(item, user);
  const ymd = toYMD(item.date);
  const mains = [...new Set(recordActivities(item).map(a => a.main_activity || a.activity).filter(Boolean))];
  const isAdmin = user && user.role === 'admin';
  const site = siteDisplayName(item.site, projects);

  return (
    <div className="lrow">
      <div className="date"><b>{shortDate(ymd).replace(/ \d{4}$/, '')}</b><span>{relDay(ymd)}</span></div>
      <div className="site">
        <b>{site}</b>
        <div className="sub">{mains.length ? mains.join(', ') : 'No activities'}</div>
      </div>
      <div className="cond"><ConditionBadge condition={item.siteCondition} /></div>
      <div className="num" aria-label={`${item.total || 0} workers`}>{item.total || 0}</div>
      <div className="by">
        <div>{item.by || '—'}</div>
        <div className="sub">
          {timeOf(item)}
          {item.editedBy && item.editedBy !== item.by && <span className="tag">Edited</span>}
          {item.editPermission === 'pending' && <span className="tag warn">Edit requested</span>}
          {item.editPermission === 'granted' && <span className="tag ok">Edit allowed</span>}
        </div>
      </div>
      <div className="acts">
        <button type="button" className="icon-btn" onClick={() => onView(item)} title="View report" aria-label={`View report for ${site}, ${ymd}`}><Icon name="eye" /></button>
        {edit === 'edit' && <button type="button" className="icon-btn" onClick={() => onAction('edit', item)} title="Edit" aria-label="Edit report"><Icon name="edit" /></button>}
        {edit === 'request' && <button type="button" className="icon-btn" onClick={() => onAction('request', item)} title="Request edit" aria-label="Request edit"><Icon name="lock" /></button>}
        {edit === 'pending' && <button type="button" className="icon-btn" disabled title="Edit request pending" aria-label="Edit request pending"><Icon name="lock" /></button>}
        <button type="button" className="icon-btn" onClick={() => onAction('jpg', item)} title="Download image" aria-label="Download image"><Icon name="image" /></button>
        <button type="button" className="icon-btn" onClick={() => onAction('pdf', item)} title="Download PDF" aria-label="Download PDF"><Icon name="pdf" /></button>
        <button type="button" className="icon-btn" onClick={() => onAction('share', item)} title="Share" aria-label="Share report"><Icon name="share" /></button>
        {isAdmin && <button type="button" className="icon-btn danger" onClick={() => onAction('delete', item)} title="Delete" aria-label="Delete report"><Icon name="trash" /></button>}
      </div>
    </div>
  );
}

// Report history: filters, newest-first list, per-record actions and the
// report viewer (paper card + exports).
export default function HistoryScreen() {
  const app = useApp();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [viewing, setViewing] = useState(null); // { item, autoOpenShare }
  const closeViewer = useCallback(() => setViewing(null), []);

  // Leaving the tab closes the viewer (it's portalled to <body>).
  useEffect(() => { if (app.activeTab !== 'History') closeViewer(); }, [app.activeTab, closeViewer]);

  const data = useMemo(() => ({
    history: app.history, projects: app.projects, users: app.users, materialLogs: app.materialLogs,
    status: app.historyStatus, user: app.user,
  }), [app.history, app.projects, app.users, app.materialLogs, app.historyStatus, app.user]);

  const siteOptions = useMemo(() => {
    const tops = data.projects.filter(p => !p.parent_id || String(p.parent_id).trim() === '');
    return tops.flatMap(top => [
      { value: top.project_name, label: top.project_name + (top.status === 'inactive' ? ' (inactive)' : '') },
      ...data.projects
        .filter(p => String(p.parent_id) === String(top.id))
        .map(s => ({ value: s.project_name, label: `  ↳ ${s.project_name}${s.status === 'inactive' ? ' (inactive)' : ''}` })),
    ]);
  }, [data.projects]);

  const supervisors = useMemo(() => {
    const set = new Set();
    data.users.forEach(u => u.username && set.add(u.username));
    data.history.forEach(h => h.by && set.add(h.by));
    return [...set].sort();
  }, [data.users, data.history]);

  const filtered = useMemo(() => {
    const site = filters.site.toLowerCase().trim();
    const sup = filters.supervisor.toLowerCase().trim();
    return data.history
      .filter(item => {
        const d = toYMD(item.date);
        if (filters.start && d < filters.start) return false;
        if (filters.end && d > filters.end) return false;
        // Substring match, as before: picking a parent project also matches its sub-projects' names.
        if (site && !String(item.site || '').toLowerCase().includes(site)) return false;
        if (sup && String(item.by || '').toLowerCase() !== sup) return false;
        if (filters.condition && item.siteCondition !== filters.condition) return false;
        return true;
      })
      .sort((a, b) => toYMD(b.date).localeCompare(toYMD(a.date)) || submittedMs(b) - submittedMs(a));
  }, [data.history, filters]);

  const shown = filtered.slice(0, limit);
  const isFiltered = Object.values(filters).some(Boolean);

  const setFilter = (field) => (e) => { setFilters(f => ({ ...f, [field]: e.target.value })); setLimit(PAGE_SIZE); };
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setLimit(PAGE_SIZE); };

  const onAction = (kind, item) => {
    switch (kind) {
      // Share needs its JPG/PDF chooser, which lives in the viewer's action bar.
      case 'share':   setViewing({ item, autoOpenShare: true }); break;
      case 'jpg':
      case 'pdf':     runReportAction(kind, reportFromRecord(item, data.projects, data.materialLogs), app.showToast); break;
      case 'edit':    closeViewer(); app.editDpr(item); break;
      case 'request': app.requestEdit(item); break;
      case 'delete':  app.deleteDpr(item); break;
      default: break;
    }
  };

  let list;
  if (!data.history.length) {
    if (data.status === 'loading' || data.status === 'idle') list = <SkeletonList />;
    else if (data.status === 'error') {
      list = <div className="list"><div className="empty"><h3>Couldn’t load reports</h3><p className="muted">Check your connection and try again.</p><button type="button" className="btn" onClick={app.reloadHistory}><Icon name="refresh" />Retry</button></div></div>;
    } else {
      list = <div className="list"><div className="empty"><h3>No reports yet</h3><p className="muted">Reports appear here once they’re submitted from the New report tab.</p></div></div>;
    }
  } else if (!filtered.length) {
    list = <div className="list"><div className="empty"><h3>No reports match these filters</h3><p className="muted">Clear a filter or widen the date range.</p><button type="button" className="btn" onClick={clearFilters}>Clear filters</button></div></div>;
  } else {
    list = (
      <>
        <div className="list">
          <div className="lrow head" aria-hidden="true"><span>Date</span><span>Site</span><span>Condition</span><span>Workers</span><span>Filed by</span><span /></div>
          {shown.map(item => (
            <HistoryRow key={recordKey(item)} item={item} projects={data.projects} user={data.user}
              onView={(it) => setViewing({ item: it, autoOpenShare: false })} onAction={onAction} />
          ))}
        </div>
        <div className="more-wrap">
          <span className="muted small">Showing {shown.length} of {filtered.length}</span>
          {filtered.length > shown.length && (
            <button type="button" className="btn sm" onClick={() => setLimit(l => l + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, filtered.length - shown.length)} more</button>
          )}
        </div>
      </>
    );
  }

  const viewingEdit = viewing ? editAction(viewing.item, data.user) === 'edit' : false;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Report history</h1>
          <p className="lede">Every daily report filed across your sites. Open one to view, share or edit.</p>
        </div>
        <div className="row">
          <ExportButtons
            noun="report"
            count={filtered.length}
            formats={[
              { kind: 'csv', label: 'CSV', run: () => exportDprLogCsv(filtered) },
              { kind: 'excel', label: 'Excel', run: () => exportDprLogExcel(filtered) },
              { kind: 'pdf', label: 'PDF', run: () => exportDprLogPdf(filtered) },
            ]}
          />
          <button type="button" className="btn ghost" onClick={app.reloadHistory} disabled={data.status === 'loading'}>
            <Icon name="refresh" />{data.status === 'loading' ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="filters five">
        <label className="field">
          <span>Site</span>
          <select className="select" value={filters.site} onChange={setFilter('site')}>
            <option value="">All sites</option>
            {siteOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Filed by</span>
          <select className="select" value={filters.supervisor} onChange={setFilter('supervisor')}>
            <option value="">Anyone</option>
            {supervisors.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Condition</span>
          <select className="select" value={filters.condition} onChange={setFilter('condition')}>
            <option value="">Any</option>
            {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.value}</option>)}
          </select>
        </label>
        <label className="field"><span>From</span><input className="input" type="date" value={filters.start} onChange={setFilter('start')} /></label>
        <label className="field"><span>To</span><input className="input" type="date" value={filters.end} onChange={setFilter('end')} /></label>
      </div>

      <div className="list-bar">
        <span className="muted small" aria-live="polite">
          {data.history.length} report{data.history.length === 1 ? '' : 's'} loaded{isFiltered ? ` · ${filtered.length} matching — exports cover the matching reports` : ''}
        </span>
        {isFiltered && <button type="button" className="btn sm ghost" onClick={clearFilters}><Icon name="x" />Clear filters</button>}
      </div>

      {list}

      {viewing && (
        <DprViewDialog
          item={viewing.item}
          autoOpenShare={viewing.autoOpenShare}
          projects={data.projects}
          materialLogs={data.materialLogs}
          canEditIt={viewingEdit}
          onEdit={() => onAction('edit', viewing.item)}
          onClose={closeViewer}
        />
      )}
    </>
  );
}
