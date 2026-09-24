'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import ErrorBoundary from '../ui/ErrorBoundary';
import { siteDisplayName } from '../../lib/report/reportModel';
import {
  budgetStatus, buildBudgetRows, filterLogs, formatQty, sortLogsNewestFirst, usageTotals,
} from '../../lib/materials/materialUsage';

const API = '/api/proxy';
const OFFLINE_QUEUE_KEY = 'dprOfflineQ';
const LOG_PAGE = 50;
const EMPTY_FILTERS = { start: '', end: '', site: '', material: '' };

function getLocalTodayYMD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(ymd || '');
}

let _keySeq = 0;
const emptyRow = () => ({ key: `m${++_keySeq}`, name: '', qty: '' });
const toQty = (v) => Math.max(0, Number(v) || 0);
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

// ── Presentational pieces ─────────────────────────────────────────────

function BudgetBar({ used, budget, pending = 0, label }) {
  const st = budgetStatus(used + pending, budget);
  if (st.level === 'none') return null;
  const usedPct = Math.min(100, (used / budget) * 100);
  const pendingPct = Math.max(0, Math.min(100, ((used + pending) / budget) * 100) - usedPct);
  return (
    <div
      className={`mat-bar is-${st.level}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(st.pct, 100)}
      aria-valuetext={`${st.pct}% of budget`}
    >
      <div className="mat-bar-fill" style={{ width: `${usedPct}%` }} />
      {pendingPct > 0 && <div className="mat-bar-pending" style={{ left: `${usedPct}%`, width: `${pendingPct}%` }} />}
    </div>
  );
}

function remainingText(remaining, unit) {
  const u = unit ? ` ${unit}` : '';
  return remaining >= 0 ? `${formatQty(remaining)}${u} left` : `Over by ${formatQty(-remaining)}${u}`;
}

// Inline "remaining budget" hint under a log-form row, projecting the
// quantities being entered (all rows of this material in the form).
function RowBudgetHint({ material, used, pendingForMaterial }) {
  if (!material) return null;
  const unit = material.unit || '';
  const budget = Number(material.budget_qty) || 0;
  if (!budget) {
    return <div className="mat-hint">No budget set · {formatQty(used)}{unit ? ` ${unit}` : ''} used so far</div>;
  }
  const before = budgetStatus(used, budget);
  const after = budgetStatus(used + pendingForMaterial, budget);
  return (
    <div className={`mat-hint is-${after.level}`}>
      <BudgetBar used={used} pending={pendingForMaterial} budget={budget} label={`${material.material_name} budget`} />
      <div className="mat-hint-text">
        <span>{remainingText(before.remaining, unit)} of {formatQty(budget)}{unit ? ` ${unit}` : ''}</span>
        {pendingForMaterial > 0 && (
          <span className="mat-hint-after">
            {after.level === 'over'
              ? `⚠️ This entry goes over budget by ${formatQty(-after.remaining)}${unit ? ` ${unit}` : ''}`
              : `→ ${remainingText(after.remaining, unit)} after this entry`}
          </span>
        )}
      </div>
    </div>
  );
}

function LogRow({ index, row, materials, usage, pendingByName, onChange, onRemove, canRemove }) {
  const material = materials.find(m => m.material_name === row.name);
  const k = row.name.trim().toLowerCase();
  return (
    <div className="activitybox mat-log-row">
      <div className="entry-row-head">
        <span className="entry-row-title">Entry {index + 1}</span>
        {canRemove && <button type="button" className="delete-btn entry-row-remove" onClick={onRemove} aria-label="Remove material">✕</button>}
      </div>
      <div className="mat-log-fields">
        <div>
          <label>Material</label>
          <select value={row.name} onChange={(e) => onChange({ ...row, name: e.target.value })}>
            <option value="">— Select Material —</option>
            {materials.map(m => <option key={m.id} value={m.material_name}>{m.material_name}{m.unit ? ` (${m.unit})` : ''}</option>)}
          </select>
        </div>
        <div>
          <label>Quantity Used{material && material.unit ? ` (${material.unit})` : ''}</label>
          <input type="number" min="0" step="any" inputMode="decimal" value={row.qty} onChange={(e) => onChange({ ...row, qty: e.target.value })} placeholder="e.g. 25" />
        </div>
      </div>
      <RowBudgetHint material={material} used={usage.get(k) || 0} pendingForMaterial={pendingByName.get(k) || 0} />
    </div>
  );
}

function BudgetRow({ row, showPeriod }) {
  const { status: st, unit } = row;
  const u = unit ? ` ${unit}` : '';
  return (
    <div className={`mat-budget-row is-${st.level}`}>
      <div className="mat-budget-head">
        <span className="mat-budget-name">
          {row.name}
          {row.inactive && <span className="mat-tag">inactive</span>}
          {row.untracked && <span className="mat-tag">not in material list</span>}
        </span>
        <span className={`mat-budget-pct is-${st.level}`}>
          {st.level === 'none' ? 'No budget' : st.level === 'over' ? `⚠️ ${st.pct}%` : `${st.pct}%`}
        </span>
      </div>
      <BudgetBar used={row.used} budget={row.budget} label={`${row.name} budget used`} />
      <div className="mat-budget-meta">
        <span>{formatQty(row.used)}{st.level === 'none' ? `${u} used` : ` / ${formatQty(row.budget)}${u}`}</span>
        {st.level !== 'none' && <span className={`mat-remaining is-${st.level}`}>{remainingText(st.remaining, unit)}</span>}
      </div>
      {showPeriod && <div className="mat-budget-period">In selected period: {formatQty(row.periodUsed)}{u}</div>}
    </div>
  );
}

// ── Screen ────────────────────────────────────────────────────────────

// Portal-mounted React replacement for the legacy Material Consumption tab
// (addMaterialRow/saveMaterialsUsed/renderMaterialConsumptionTab in index.html).
export default function MaterialsScreen() {
  const [mountNode, setMountNode] = useState(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [date, setDate] = useState(getLocalTodayYMD);
  const [site, setSite] = useState('');
  const [rows, setRows] = useState(() => [emptyRow()]);
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

  const usage = useMemo(() => usageTotals(data.logs), [data.logs]);

  // Quantities currently typed into the form, per material — drives the
  // inline "after this entry" projection.
  const pendingByName = useMemo(() => {
    const m = new Map();
    rows.forEach(r => {
      const k = r.name.trim().toLowerCase();
      if (k) m.set(k, (m.get(k) || 0) + toQty(r.qty));
    });
    return m;
  }, [rows]);

  const isFiltered = !!(filters.start || filters.end || filters.site || filters.material);
  const filteredLogs = useMemo(() => sortLogsNewestFirst(filterLogs(data.logs, filters)), [data.logs, filters]);
  const budgetRows = useMemo(
    () => buildBudgetRows(data.materials, data.logs, isFiltered ? filteredLogs : null),
    [data.materials, data.logs, filteredLogs, isFiltered]
  );
  const overCount = budgetRows.filter(r => r.status.level === 'over').length;
  const warnCount = budgetRows.filter(r => r.status.level === 'warn').length;

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
    const missingName = rows.find(r => !r.name && toQty(r.qty) > 0);
    if (missingName) { legacy.toast('⚠️ Select a material for each quantity'); return; }
    const missingQty = rows.find(r => r.name && toQty(r.qty) <= 0);
    if (missingQty) { legacy.toast(`⚠️ Enter a quantity for ${missingQty.name}`); return; }
    const materialsUsed = rows.filter(r => r.name).map(r => ({ material_name: r.name, qty: toQty(r.qty) }));
    if (!materialsUsed.length) { legacy.toast('⚠️ Add at least one material with a quantity'); return; }

    const payload = { action: 'saveMaterialLog', date, site, by: user.username, materialsUsed };

    if (!navigator.onLine) {
      legacy.toast(enqueueOffline(payload) ? '💾 Offline — will sync on reconnect' : '⚠️ Offline and could not queue — try again');
      return;
    }

    setSaving(true);
    legacy.toast('☁️ Saving material consumption...');
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(r => r.json());
      if (res && res.error) { legacy.toast('⚠️ Save failed: ' + res.error); return; }
      legacy.toast(`✅ Saved ${materialsUsed.length} material entr${materialsUsed.length === 1 ? 'y' : 'ies'}`);
      setRows([emptyRow()]); // keep date + site for the next entry
      legacy.reload();
    } catch (e) {
      legacy.toast('⚠️ Save failed — check connection');
    } finally {
      setSaving(false);
    }
  };

  if (!mountNode) return null;

  let logBody;
  if (!data.logs.length) {
    if (data.status === 'loading' || data.status === 'idle') logBody = <p className="history-empty">⏳ Loading...</p>;
    else if (data.status === 'error') logBody = <p className="history-empty is-error">⚠️ Failed to load material logs.</p>;
    else logBody = <p className="history-empty">No material consumption logged yet.</p>;
  } else if (!filteredLogs.length) {
    logBody = <p className="history-empty">No entries match the current filter.</p>;
  } else {
    logBody = (
      <>
        <ul className="mat-log-list">
          {filteredLogs.slice(0, visibleLogs).map((l, i) => (
            <li key={`${l.createdAt || ''}-${l.material_name}-${i}`} className="mat-log-item">
              <div>
                <div className="mat-log-name">{l.material_name}</div>
                <div className="mat-log-meta">{formatDate(l.date)} · {siteDisplayName(l.site, data.projects)}{l.loggedBy ? ` · ${l.loggedBy}` : ''}</div>
              </div>
              <div className="mat-log-qty">{formatQty(l.qty)}{l.unit ? ` ${l.unit}` : ''}</div>
            </li>
          ))}
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
        <div className="section-title">📦 Log Material Consumption</div>
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
          <LogRow
            key={r.key}
            index={i}
            row={r}
            materials={activeMaterials}
            usage={usage}
            pendingByName={pendingByName}
            onChange={(next) => updateRow(r.key, next)}
            onRemove={() => removeRow(r.key)}
            canRemove={rows.length > 1}
          />
        ))}
        <button type="button" className="btn-add" onClick={() => setRows(rs => [...rs, emptyRow()])}>+ Add Material</button>
        <button type="button" className="btn-green mat-save-btn" onClick={save} disabled={saving}>
          {saving ? '⏳ Saving...' : '✅ Save Material Consumption'}
        </button>
      </div>

      <div className="card">
        <div className="section-title">📊 Usage vs Budget</div>
        {(overCount > 0 || warnCount > 0) && (
          <div className="mat-alerts">
            {overCount > 0 && <span className="mat-alert is-over">⚠️ {overCount} over budget</span>}
            {warnCount > 0 && <span className="mat-alert is-warn">{warnCount} near limit (≥80%)</span>}
          </div>
        )}
        {budgetRows.length
          ? budgetRows.map(r => <BudgetRow key={r.name} row={r} showPeriod={isFiltered} />)
          : <p className="history-empty">{data.status === 'loading' ? '⏳ Loading...' : 'No material usage or budgets recorded yet.'}</p>}
        <p className="mat-footnote">Budget progress uses all logged consumption, not just the filtered period.</p>
      </div>

      <div className="card">
        <div className="section-title">🧾 Consumption Log</div>
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
        </div>
        <div className="history-toolbar">
          <button type="button" className="btn-blue btn-sm" onClick={legacy.reload} disabled={data.status === 'loading'}>
            {data.status === 'loading' ? '⏳ Refreshing...' : '🔄 Refresh'}
          </button>
          <button type="button" className="btn-gray btn-sm" onClick={() => { setFilters(EMPTY_FILTERS); setVisibleLogs(LOG_PAGE); }} disabled={!isFiltered}>❌ Clear Filter</button>
        </div>
        <div className="history-count" aria-live="polite">
          📊 {filteredLogs.length} log entr{filteredLogs.length === 1 ? 'y' : 'ies'}{isFiltered ? ` (of ${data.logs.length})` : ''}
        </div>
        {logBody}
      </div>
    </ErrorBoundary>,
    mountNode
  );
}
