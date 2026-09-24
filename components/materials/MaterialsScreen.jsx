'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import ErrorBoundary from '../ui/ErrorBoundary';
import ConsumptionEntryRow from './ConsumptionEntryRow';
import { siteDisplayName } from '../../lib/report/reportModel';
import {
  OWNERSHIP_OPTIONS, emptyEntryRow, entryRowHasContent, filterLogs, formatOutput, formatQty,
  normalizeOwnership, ownershipCounts, serializeEntryRows, sortLogsNewestFirst, trustTotals, validateEntryRows,
} from '../../lib/materials/consumption';

const API = '/api/proxy';
const OFFLINE_QUEUE_KEY = 'dprOfflineQ';
const LOG_PAGE = 50;
const EMPTY_FILTERS = { start: '', end: '', site: '', material: '', ownership: '' };

function getLocalTodayYMD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(ymd || '');
}

const isTopLevel = (p) => !p.parent_id || String(p.parent_id).trim() === '';

function enqueueOffline(payload) {
  try {
    const q = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
    q.push(payload);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
    return true;
  } catch (e) {
    return false;
  }
}

// ── Legacy bridge — see index.html's "MATERIALS" section comment ──
const legacy = {
  logs: () => window.__getMaterialLogs?.() || [],
  status: () => window.__getMaterialLogsStatus?.() || 'idle',
  materials: () => window.__getMaterials?.() || [],
  projects: () => window.__getProjects?.() || [],
  user: () => window.__getCurrentUser?.() || null,
  toast: (msg) => window.showToast?.(msg),
  reload: () => window.loadMaterialLogs?.(),
};

export function OwnershipBadge({ ownership }) {
  const o = normalizeOwnership(ownership);
  return <span className={`ce-badge is-${o.toLowerCase()}`}>{o}</span>;
}

// Portal-mounted React Materials tab: consumption-entry form, Trust-only
// Total Material Summary, and the filtered Consumption Entries list.
export default function MaterialsScreen() {
  const [mountNode, setMountNode] = useState(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [date, setDate] = useState(getLocalTodayYMD);
  const [site, setSite] = useState('');
  const [rows, setRows] = useState(() => [emptyEntryRow()]);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [visibleLogs, setVisibleLogs] = useState(LOG_PAGE);

  useEffect(() => {
    let cancelled = false;
    const tryFind = () => {
      const el = document.getElementById('__materials_mount__');
      if (el) { if (!cancelled) setMountNode(el); return true; }
      return false;
    };
    if (tryFind()) return undefined;
    const interval = setInterval(() => { if (tryFind()) clearInterval(interval); }, 200);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    const bump = () => setDataVersion(v => v + 1);
    window.addEventListener('dpr:materialLogsUpdated', bump);
    window.addEventListener('dpr:masterDataUpdated', bump);
    return () => {
      window.removeEventListener('dpr:materialLogsUpdated', bump);
      window.removeEventListener('dpr:masterDataUpdated', bump);
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => {
    if (typeof window === 'undefined') return { logs: [], status: 'idle', materials: [], projects: [] };
    return { logs: legacy.logs(), status: legacy.status(), materials: legacy.materials(), projects: legacy.projects() };
  }, [dataVersion]);

  const activeMaterials = useMemo(
    () => data.materials.filter(m => m.status !== 'inactive').slice().sort((a, b) => String(a.material_name).localeCompare(String(b.material_name))),
    [data.materials]
  );

  const siteOptions = useMemo(() => {
    const active = data.projects.filter(p => p.status === 'active');
    return active.filter(isTopLevel).flatMap(top => [
      { value: top.project_name, label: top.project_name },
      ...active.filter(p => String(p.parent_id).trim() === String(top.id).trim())
        .map(s => ({ value: s.project_name, label: `  ↳ ${s.project_name}` })),
    ]);
  }, [data.projects]);

  const contractorSuggestions = useMemo(
    () => [...new Set(data.logs.map(l => String(l.contractor || '').trim()).filter(Boolean))].sort(),
    [data.logs]
  );

  const isFiltered = Object.values(filters).some(Boolean);
  const filteredLogs = useMemo(() => sortLogsNewestFirst(filterLogs(data.logs, filters)), [data.logs, filters]);
  // Summary follows the filters (except ownership, which can only ever
  // narrow it to Trust or empty it) — totals are always Trust-only.
  const summaryLogs = useMemo(() => filterLogs(data.logs, { ...filters, ownership: '' }), [data.logs, filters]);
  const totals = useMemo(() => trustTotals(summaryLogs), [summaryLogs]);
  const counts = useMemo(() => ownershipCounts(summaryLogs), [summaryLogs]);

  const logSites = useMemo(() => [...new Set(data.logs.map(l => l.site).filter(Boolean))].sort(), [data.logs]);
  const logMaterials = useMemo(() => [...new Set(data.logs.map(l => l.material_name).filter(Boolean))].sort(), [data.logs]);

  const setFilter = (field) => (e) => { setFilters(f => ({ ...f, [field]: e.target.value })); setVisibleLogs(LOG_PAGE); };
  const updateRow = (k, next) => setRows(rs => rs.map(r => (r.key === k ? next : r)));
  const removeRow = (k) => setRows(rs => (rs.length > 1 ? rs.filter(r => r.key !== k) : rs));

  const save = async () => {
    if (saving) return;
    const user = legacy.user();
    if (!user) { legacy.toast('⚠️ Please sign in first'); return; }
    if (!date) { legacy.toast('⚠️ Select a date'); return; }
    if (!site) { legacy.toast('⚠️ Select a site'); return; }
    const invalid = validateEntryRows(rows);
    if (invalid) { legacy.toast(invalid); return; }
    const materialsUsed = serializeEntryRows(rows);
    if (!materialsUsed.length) { legacy.toast('⚠️ Add at least one consumption entry'); return; }

    const payload = { action: 'saveMaterialLog', date, site, by: user.username, materialsUsed };

    if (!navigator.onLine) {
      legacy.toast(enqueueOffline(payload) ? '💾 Offline — will sync on reconnect' : '⚠️ Offline and could not queue — try again');
      return;
    }

    setSaving(true);
    legacy.toast('☁️ Saving consumption entries...');
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(r => r.json());
      if (res && res.error) { legacy.toast('⚠️ Save failed: ' + res.error); return; }
      legacy.toast(`✅ Saved ${materialsUsed.length} consumption entr${materialsUsed.length === 1 ? 'y' : 'ies'}`);
      setRows([emptyEntryRow()]); // keep date + site for the next entry
      legacy.reload();
    } catch (e) {
      legacy.toast('⚠️ Save failed — check connection');
    } finally {
      setSaving(false);
    }
  };

  if (!mountNode) return null;

  const excluded = counts.Contractor + counts.Other;
  const loading = !data.logs.length && (data.status === 'loading' || data.status === 'idle');

  let logBody;
  if (!data.logs.length) {
    if (loading) logBody = <p className="history-empty">⏳ Loading...</p>;
    else if (data.status === 'error') logBody = <p className="history-empty is-error">⚠️ Failed to load consumption entries.</p>;
    else logBody = <p className="history-empty">No consumption entries logged yet.</p>;
  } else if (!filteredLogs.length) {
    logBody = <p className="history-empty">No entries match the current filter.</p>;
  } else {
    logBody = (
      <>
        <ul className="mat-log-list">
          {filteredLogs.slice(0, visibleLogs).map((l, i) => {
            const output = formatOutput(l.outputQty, l.outputUnit);
            return (
              <li key={l.id || `${l.createdAt}-${i}`} className={`mat-log-item ce-log-item${normalizeOwnership(l.ownership) === 'Trust' ? '' : ' is-reference'}`}>
                <div className="ce-log-main">
                  <div className="mat-log-name">
                    {l.material_name} <OwnershipBadge ownership={l.ownership} />
                  </div>
                  <div className="mat-log-meta">{formatDate(l.date)} · {siteDisplayName(l.site, data.projects)}{l.loggedBy ? ` · ${l.loggedBy}` : ''}</div>
                  {(l.contractor || output || l.remarks) && (
                    <div className="ce-log-details">
                      {l.contractor && <span>👷 {l.contractor}</span>}
                      {output && <span>🧱 Output: {output}</span>}
                      {l.remarks && <span className="ce-log-remarks">“{l.remarks}”</span>}
                    </div>
                  )}
                </div>
                <div className="mat-log-qty">{formatQty(l.qty)}{l.unit ? ` ${l.unit}` : ''}</div>
              </li>
            );
          })}
        </ul>
        {filteredLogs.length > visibleLogs && (
          <button type="button" className="btn-gray btn-sm mat-show-more" onClick={() => setVisibleLogs(v => v + LOG_PAGE)}>
            Show {Math.min(LOG_PAGE, filteredLogs.length - visibleLogs)} more
          </button>
        )}
      </>
    );
  }

  return createPortal(
    <ErrorBoundary>
      <div className="card">
        <div className="section-title">📦 Log Consumption Entries</div>
        <div className="history-filter-grid">
          <div>
            <label htmlFor="matDate">Date</label>
            <input id="matDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label htmlFor="matSite">Site / Project</label>
            <select id="matSite" value={site} onChange={(e) => setSite(e.target.value)}>
              <option value="">{data.projects.length ? '— Select Site —' : '⌛ Loading projects...'}</option>
              {siteOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
        {rows.map((r, i) => (
          <ConsumptionEntryRow
            key={r.key}
            index={i}
            row={r}
            materials={activeMaterials}
            contractorSuggestions={contractorSuggestions}
            onChange={(next) => updateRow(r.key, next)}
            onRemove={() => removeRow(r.key)}
            canRemove={rows.length > 1}
          />
        ))}
        <button type="button" className="btn-add" onClick={() => setRows(rs => [...rs, emptyEntryRow()])}>+ Add Entry</button>
        <button type="button" className="btn-green mat-save-btn" onClick={save} disabled={saving || !rows.some(entryRowHasContent)}>
          {saving ? '⏳ Saving...' : '✅ Save Consumption Entries'}
        </button>
      </div>

      <div className="card">
        <div className="section-title">🔍 Filter</div>
        <div className="history-filter-grid">
          <div>
            <label htmlFor="matStart">Start Date</label>
            <input id="matStart" type="date" value={filters.start} onChange={setFilter('start')} />
          </div>
          <div>
            <label htmlFor="matEnd">End Date</label>
            <input id="matEnd" type="date" value={filters.end} onChange={setFilter('end')} />
          </div>
          <div>
            <label htmlFor="matFSite">Site / Project</label>
            <select id="matFSite" value={filters.site} onChange={setFilter('site')}>
              <option value="">— All Sites —</option>
              {logSites.map(s => <option key={s} value={s}>{siteDisplayName(s, data.projects)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="matFMat">Material</label>
            <select id="matFMat" value={filters.material} onChange={setFilter('material')}>
              <option value="">— All Materials —</option>
              {logMaterials.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="matFOwn">Ownership</label>
            <select id="matFOwn" value={filters.ownership} onChange={setFilter('ownership')}>
              <option value="">— All —</option>
              {OWNERSHIP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </div>
        <div className="history-toolbar">
          <button type="button" className="btn-blue btn-sm" onClick={legacy.reload} disabled={data.status === 'loading'}>
            {data.status === 'loading' ? '⏳ Refreshing...' : '🔄 Refresh'}
          </button>
          <button type="button" className="btn-gray btn-sm" onClick={() => { setFilters(EMPTY_FILTERS); setVisibleLogs(LOG_PAGE); }} disabled={!isFiltered}>❌ Clear Filter</button>
        </div>
      </div>

      <div className="card">
        <div className="section-title">📊 Total Material Summary <span className="ce-trust-tag">Trust only</span></div>
        {totals.length ? (
          <div className="ce-summary-wrap">
            <table className="ce-summary">
              <thead><tr><th>Material</th><th className="c-n">Total Qty</th><th>Unit</th><th className="c-n">Entries</th></tr></thead>
              <tbody>
                {totals.map(t => (
                  <tr key={`${t.material}|${t.unit}`}>
                    <td>{t.material}</td>
                    <td className="c-n"><b>{formatQty(t.qty)}</b></td>
                    <td>{t.unit || '—'}</td>
                    <td className="c-n">{t.entries}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="history-empty">{loading ? '⏳ Loading...' : 'No Trust-supplied consumption in this selection.'}</p>
        )}
        <p className="mat-footnote">
          {filters.start || filters.end || filters.site || filters.material ? 'Cumulative for the filtered selection. ' : 'Cumulative for all logged entries. '}
          {excluded > 0
            ? `${excluded} Contractor/Other entr${excluded === 1 ? 'y is' : 'ies are'} listed below for reference and excluded from these totals.`
            : 'Contractor/Other entries are excluded from these totals.'}
        </p>
      </div>

      <div className="card">
        <div className="section-title">🧾 Consumption Entries</div>
        <div className="history-count" aria-live="polite">
          📊 {filteredLogs.length} entr{filteredLogs.length === 1 ? 'y' : 'ies'}{isFiltered ? ` (of ${data.logs.length})` : ''}
        </div>
        {logBody}
      </div>
    </ErrorBoundary>,
    mountNode
  );
}
