'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ErrorBoundary from '../ui/ErrorBoundary';

const ITEMS_PER_PAGE = 10;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const CONDITION_EMOJI = { Sunny: '☀️', Rainy: '🌧️', Cloudy: '☁️', 'Site Closed': '🚧', Holiday: '🎉' };

// ── Pure helpers (ports of the index.html utilities of the same name) ──

function toYMD(v) {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.substring(0, 10);
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }
  return s;
}

function formatDate(s) {
  const y = toYMD(s);
  if (!y || y.length < 10) return s || '';
  const [yr, mo, da] = y.split('-');
  return `${da}-${mo}-${yr}`;
}

const toNum = (v) => Number(v) || 0;
const recordKey = (item) => toYMD(item.date) + '||' + String(item.site).trim();
const submittedMs = (item) => Number(item.submittedAt) || (item.submittedAt ? new Date(item.submittedAt).getTime() : 0);

function toTitleCase(str) {
  if (!str) return '';
  return String(str).replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
    .toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bRcc\b/g, 'RCC').replace(/\bHvac\b/g, 'HVAC').replace(/\bCctv\b/g, 'CCTV')
    .replace(/\bAc\b/g, 'AC').replace(/\bDpr\b/g, 'DPR');
}

function siteDisplayName(siteName, projects) {
  if (!siteName) return '—';
  const norm = (v) => String(v).trim().toLowerCase();
  const proj = projects.find(p => norm(p.project_name) === norm(siteName));
  if (proj && proj.parent_id && String(proj.parent_id).trim() !== '') {
    const parent = projects.find(p => String(p.id).trim() === String(proj.parent_id).trim());
    if (parent) return `${parent.project_name} ➔ ${proj.project_name}`;
  }
  return siteName;
}

function poolRecordActivities(item) {
  const civil = Array.isArray(item.civilActivities) ? item.civilActivities : [];
  const interior = Array.isArray(item.interiorActivities) ? item.interiorActivities : [];
  const details = Array.isArray(item.details) ? item.details : [];
  const all = (civil.length || interior.length)
    ? [...civil, ...interior]
    : details.map(r => ({
      main_activity: r.main_activity || r.activity,
      activity: r.activity || r.main_activity,
      sub_activity: r.sub_activity || '',
      skilled: r.skilled, unskilled: r.unskilled, note: r.note,
    }));
  return all.filter(a => toNum(a.skilled) > 0 || toNum(a.unskilled) > 0);
}

// Same edit-permission rules as index.html's editDPR() gate, which still
// enforces them — this only decides which menu label to show.
function editAction(item, user) {
  const isAdmin = user && user.role === 'admin';
  const isOwn = user && item.by === user.username;
  const ms = submittedMs(item);
  const withinWindow = ms && (Date.now() - ms) < EDIT_WINDOW_MS;
  const granted = item.editPermission === 'granted';
  const pending = item.editPermission === 'pending';
  if (!isAdmin && isOwn && !withinWindow && !granted && !pending) return { kind: 'request', label: '🔑 Request Edit' };
  if (!isAdmin && isOwn && pending) return { kind: 'pending', label: '⏳ Edit Pending' };
  if (!isAdmin && !isOwn) return { kind: 'forbidden', label: '✏️ Edit (Disabled)' };
  return { kind: 'edit', label: '✏️ Edit' };
}

// ── Legacy bridge — see index.html's "HISTORY" section comment ──

const legacy = {
  history: () => window.__getHistory?.() || [],
  status: () => window.__getHistoryStatus?.() || 'idle',
  projects: () => window.__getProjects?.() || [],
  users: () => window.__getUsers?.() || [],
  user: () => window.__getCurrentUser?.() || null,
  toast: (msg) => window.showToast?.(msg),
  reload: () => window.loadHistory?.(),
  edit: (idx) => window.editDPR?.(idx),
  requestEdit: (idx) => window.requestEditDPR?.(idx),
  remove: (idx) => window.deleteDPR?.(idx),
  download: (idx, type) => window.downloadHistoryDPR?.(idx, type),
};

// ── Report (React port of buildActivityReportHtml, View-modal variant) ──

function ActivityReport({ acts }) {
  if (!acts.length) {
    return <p className="history-empty">No activity detail available for this record.</p>;
  }
  const groups = new Map();
  acts.forEach(a => {
    const main = a.main_activity || a.activity || 'General';
    if (!groups.has(main)) groups.set(main, []);
    groups.get(main).push(a);
  });
  return [...groups.entries()].map(([main, rows]) => {
    const mainClean = String(main).trim().toLowerCase();
    return (
      <div key={main} className="report-activity history-report-group">
        <div className="history-report-group-title">📦 {toTitleCase(main)}</div>
        {rows.map((r, i) => {
          let child = String(r.activity || '').trim().replace(/^[↳\s\-➔]+/, '').trim();
          if (child.toLowerCase().indexOf(mainClean) === 0) {
            child = child.substring(mainClean.length).replace(/^[↳\s\-➔]+/, '').trim();
          }
          const isSub = child !== '' && child.toLowerCase() !== mainClean;
          const sk = toNum(r.skilled), un = toNum(r.unskilled);
          return (
            <div key={i} className={`history-report-row${isSub ? ' is-sub' : ''}`}>
              <div className="history-report-row-title">
                {isSub && <span className="history-report-arrow">↳</span>}
                {child || toTitleCase(main)}
              </div>
              <div className="history-report-row-counts">
                Skilled: <b>{sk}</b> · Unskilled: <b>{un}</b> · Total: <b>{sk + un}</b>
              </div>
              {r.note && <div className="history-report-note">📌 {r.note}</div>}
            </div>
          );
        })}
      </div>
    );
  });
}

function DprViewModal({ item, projects, onClose }) {
  const boxRef = useRef(null);
  const byLine = item.editedBy && item.editedBy !== item.by ? `${item.by} (Edited by: ${item.editedBy})` : (item.by || '—');
  const acts = useMemo(() => poolRecordActivities(item), [item]);

  useEffect(() => {
    const trigger = document.activeElement;
    boxRef.current?.querySelector('.modal-close')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !boxRef.current) return;
      const focusables = boxRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (trigger && document.body.contains(trigger)) trigger.focus();
    };
  }, [onClose]);

  return createPortal(
    <div id="dprModal" className="open" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="dprModalTitle" ref={boxRef}>
        <div className="modal-header">
          <h3 id="dprModalTitle">📊 DPR — Man Power Report</h3>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="report-meta">
            <b>📅 Date :</b> {formatDate(toYMD(item.date)) || '—'}<br />
            <b>📍 Site :</b> {siteDisplayName(item.site, projects)}<br />
            <b>👤 Filled by :</b> {byLine}<br />
            <b>👷 Total :</b> {item.total || 0} workers
          </div>
          <ActivityReport acts={acts} />
          <div className="report-total history-report-total">👷 Total Manpower : {item.total || 0}</div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function HistorySkeleton() {
  return [40, 50, 35].map((w, i) => (
    <div key={i} className="skeleton-card">
      <div className="skeleton-block" style={{ width: `${w}%`, height: 18 }} />
      <div className="skeleton-block" style={{ width: `${80 - i * 10}%`, height: 14 }} />
      <div className="skeleton-block" style={{ width: '25%', height: 26, marginTop: 6 }} />
    </div>
  ));
}

function HistoryItem({ item, projects, user, menuOpen, onToggleMenu, onView, onAction }) {
  const edit = editAction(item, user);
  const date = formatDate(toYMD(item.date)) || '—';
  const run = (fn) => (e) => { e.stopPropagation(); onToggleMenu(null); fn(); };

  return (
    <div className="history-item">
      <button
        type="button"
        className="history-options-btn"
        aria-label={`Actions for DPR ${date}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={(e) => { e.stopPropagation(); onToggleMenu(menuOpen ? null : recordKey(item)); }}
      >
        ⋮
      </button>
      <div className={`history-dropdown${menuOpen ? ' show' : ''}`} role="menu" onClick={(e) => e.stopPropagation()}>
        <button type="button" role="menuitem" className="history-dropdown-item" onClick={run(() => onAction(edit.kind, item))}>{edit.label}</button>
        <button type="button" role="menuitem" className="history-dropdown-item delete-item" onClick={run(() => onAction('delete', item))}>❌ Delete</button>
        <button type="button" role="menuitem" className="history-dropdown-item" onClick={run(() => onAction('image', item))}>📸 Download Image</button>
        <button type="button" role="menuitem" className="history-dropdown-item" onClick={run(() => onAction('pdf', item))}>📄 Download PDF</button>
        <button type="button" role="menuitem" className="history-dropdown-item" onClick={run(() => onAction('share', item))}>📤 Share (WhatsApp / Email)</button>
      </div>

      <div className="history-item-title">
        📅 {date}
        {item.by && (
          <span className="history-item-by">By: <b>{item.by}</b>{item.editedBy && item.editedBy !== item.by ? ' (Edited)' : ''}</span>
        )}
      </div>
      <div className="history-item-meta">
        📍 {siteDisplayName(item.site, projects)} · 👷 <b>{item.total || 0}</b> workers
        {item.siteCondition ? ` · ${CONDITION_EMOJI[item.siteCondition] || ''} ${item.siteCondition}` : ''}
      </div>
      <div className="hbtn-group">
        <button type="button" className="btn-blue btn-sm history-view-btn" onClick={() => onView(item)}>📂 View</button>
      </div>
    </div>
  );
}

// Portal-mounted React replacement for the legacy History tab
// (renderHistory/openDPR/pagination in index.html).
export default function HistoryScreen() {
  const [mountNode, setMountNode] = useState(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [filters, setFilters] = useState({ start: '', end: '', site: '', supervisor: '' });
  const [page, setPage] = useState(1);
  const [openMenuKey, setOpenMenuKey] = useState(null);
  const [viewing, setViewing] = useState(null);
  const closeViewer = useCallback(() => setViewing(null), []);

  useEffect(() => {
    let cancelled = false;
    const tryFind = () => {
      const el = document.getElementById('__history_mount__');
      if (el) { if (!cancelled) setMountNode(el); return true; }
      return false;
    };
    if (tryFind()) return undefined;
    const interval = setInterval(() => { if (tryFind()) clearInterval(interval); }, 200);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    const bump = () => setDataVersion(v => v + 1);
    window.addEventListener('dpr:historyUpdated', bump);
    window.addEventListener('dpr:masterDataUpdated', bump);
    window.addEventListener('dpr:closeDprModal', closeViewer);
    return () => {
      window.removeEventListener('dpr:historyUpdated', bump);
      window.removeEventListener('dpr:masterDataUpdated', bump);
      window.removeEventListener('dpr:closeDprModal', closeViewer);
    };
  }, [closeViewer]);

  // Close the ⋮ menu on any outside click or Escape.
  useEffect(() => {
    if (!openMenuKey) return undefined;
    const close = () => setOpenMenuKey(null);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenuKey]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => {
    if (typeof window === 'undefined') return { history: [], projects: [], users: [], status: 'idle', user: null };
    return { history: legacy.history(), projects: legacy.projects(), users: legacy.users(), status: legacy.status(), user: legacy.user() };
  }, [dataVersion]);

  const siteOptions = useMemo(() => {
    const tops = data.projects.filter(p => !p.parent_id || String(p.parent_id).trim() === '');
    return tops.flatMap(top => [
      { value: top.project_name, label: top.project_name + (top.status === 'inactive' ? ' (Inactive)' : '') },
      ...data.projects
        .filter(p => String(p.parent_id) === String(top.id))
        .map(s => ({ value: s.project_name, label: `  ↳ ${s.project_name}${s.status === 'inactive' ? ' (Inactive)' : ''}` })),
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
        return true;
      })
      .sort((a, b) => toYMD(b.date).localeCompare(toYMD(a.date)) || submittedMs(b) - submittedMs(a));
  }, [data.history, filters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageItems = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
  const isFiltered = !!(filters.start || filters.end || filters.site || filters.supervisor);

  const setFilter = (field) => (e) => { setFilters(f => ({ ...f, [field]: e.target.value })); setPage(1); };
  const clearFilters = () => { setFilters({ start: '', end: '', site: '', supervisor: '' }); setPage(1); };

  // Legacy actions still take an index into the live _history array.
  const onAction = (kind, item) => {
    const idx = legacy.history().indexOf(item);
    if (idx < 0) { legacy.toast('⚠️ Record changed — refresh and try again'); return; }
    switch (kind) {
      case 'edit':      legacy.edit(idx); break;
      case 'request':   legacy.requestEdit(idx); break;
      case 'pending':   legacy.toast('⏳ Edit request is pending Admin approval'); break;
      case 'forbidden': legacy.toast('❌ You can only edit your own DPRs'); break;
      case 'delete':    legacy.remove(idx); break;
      case 'image':
      case 'pdf':
      case 'share':     legacy.download(idx, kind); break;
      default: break;
    }
  };

  if (!mountNode) return null;

  let listBody;
  if (!data.history.length) {
    if (data.status === 'loading' || data.status === 'idle') listBody = <HistorySkeleton />;
    else if (data.status === 'error') listBody = <p className="history-empty is-error">⚠️ Failed to load records.</p>;
    else listBody = <p className="history-empty">No records loaded. Click Refresh.</p>;
  } else if (!filtered.length) {
    listBody = <p className="history-empty">No records match the current filter.</p>;
  } else {
    listBody = pageItems.map(item => {
      const key = recordKey(item);
      return (
        <HistoryItem
          key={key}
          item={item}
          projects={data.projects}
          user={data.user}
          menuOpen={openMenuKey === key}
          onToggleMenu={setOpenMenuKey}
          onView={setViewing}
          onAction={onAction}
        />
      );
    });
  }

  return createPortal(
    <ErrorBoundary>
      <div className="card">
        <div className="section-title">📂 DPR History</div>

        <div className="history-filter-grid">
          <div>
            <label htmlFor="histStart">Start Date</label>
            <input id="histStart" type="date" value={filters.start} onChange={setFilter('start')} />
          </div>
          <div>
            <label htmlFor="histEnd">End Date</label>
            <input id="histEnd" type="date" value={filters.end} onChange={setFilter('end')} />
          </div>
          <div>
            <label htmlFor="histSite">Site / Project</label>
            <select id="histSite" value={filters.site} onChange={setFilter('site')}>
              <option value="">— Show All Sites —</option>
              {siteOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="histSup">Supervisor</label>
            <select id="histSup" value={filters.supervisor} onChange={setFilter('supervisor')}>
              <option value="">— Show All Supervisors —</option>
              {supervisors.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div className="history-toolbar">
          <button type="button" className="btn-blue btn-sm" onClick={legacy.reload} disabled={data.status === 'loading'}>
            {data.status === 'loading' ? '⏳ Refreshing...' : '🔄 Refresh'}
          </button>
          <button type="button" className="btn-gray btn-sm" onClick={clearFilters} disabled={!isFiltered}>❌ Clear Filter</button>
        </div>

        <div className="history-count" aria-live="polite">
          📊 {data.history.length} total record{data.history.length !== 1 ? 's' : ''} loaded
          {isFiltered ? ` · ${filtered.length} matching` : ''}
        </div>

        <div>{listBody}</div>

        {filtered.length > 0 && (
          <div className="history-pagination">
            <button type="button" className="btn-blue btn-sm" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1}>◀ Previous</button>
            <span className="history-page-indicator">Page {currentPage} of {totalPages}</span>
            <button type="button" className="btn-blue btn-sm" onClick={() => setPage(currentPage + 1)} disabled={currentPage === totalPages}>Next ▶</button>
          </div>
        )}
      </div>

      {viewing && <DprViewModal item={viewing} projects={data.projects} onClose={closeViewer} />}
    </ErrorBoundary>,
    mountNode
  );
}
