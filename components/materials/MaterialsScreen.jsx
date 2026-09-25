'use client';

import { useMemo, useState } from 'react';
import { apiPost } from '../../lib/client/api';
import { enqueueOffline, useApp } from '../app/AppContext';
import ConsumptionEntryRow from './ConsumptionEntryRow';
import Icon from '../ui/Icon';
import { siteDisplayName } from '../../lib/report/reportModel';
import {
  OWNERSHIP_OPTIONS, emptyEntryRow, entryRowHasContent, filterLogs, formatOutput, formatQty,
  normalizeOwnership, ownershipCounts, serializeEntryRows, sortLogsNewestFirst, trustTotals, validateEntryRows,
} from '../../lib/materials/consumption';

const LOG_PAGE = 25;
const EMPTY_FILTERS = { start: '', end: '', site: '', material: '', ownership: '' };

function getLocalTodayYMD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shortDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  if (!m) return String(ymd || '');
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const isTopLevel = (p) => !p.parent_id || String(p.parent_id).trim() === '';
const OWNER_TAG = { Trust: 'info', Contractor: 'warn', Other: '' };

export function OwnershipBadge({ ownership }) {
  const o = normalizeOwnership(ownership);
  return <span className={`tag ${OWNER_TAG[o]}`}>{o}</span>;
}

// Materials tab: consumption-entry form, Trust-only material totals, and
// the filtered consumption log.
export default function MaterialsScreen() {
  const app = useApp();
  const [date, setDate] = useState(getLocalTodayYMD);
  const [site, setSite] = useState('');
  const [rows, setRows] = useState(() => [emptyEntryRow()]);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [visibleLogs, setVisibleLogs] = useState(LOG_PAGE);

  const data = useMemo(() => ({
    logs: app.materialLogs, status: app.materialLogsStatus, materials: app.materials, projects: app.projects,
  }), [app.materialLogs, app.materialLogsStatus, app.materials, app.projects]);

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
  // Totals follow the filters (except ownership, which can only ever
  // narrow them to Trust or empty them) — totals are always Trust-only.
  const summaryLogs = useMemo(() => filterLogs(data.logs, { ...filters, ownership: '' }), [data.logs, filters]);
  const totals = useMemo(() => trustTotals(summaryLogs), [summaryLogs]);
  const counts = useMemo(() => ownershipCounts(summaryLogs), [summaryLogs]);

  const logSites = useMemo(() => [...new Set(data.logs.map(l => l.site).filter(Boolean))].sort(), [data.logs]);
  const logMaterials = useMemo(() => [...new Set(data.logs.map(l => l.material_name).filter(Boolean))].sort(), [data.logs]);

  const setFilter = (field) => (e) => { setFilters(f => ({ ...f, [field]: e.target.value })); setVisibleLogs(LOG_PAGE); };
  const updateRow = (k, next) => setRows(rs => rs.map(r => (r.key === k ? next : r)));
  const removeRow = (k) => setRows(rs => (rs.length > 1 ? rs.filter(r => r.key !== k) : rs));
  const ready = serializeEntryRows(rows).length;

  const save = async () => {
    if (saving) return;
    const user = app.user;
    if (!user) { app.showToast('⚠️ Please sign in first'); return; }
    if (!date) { app.showToast('⚠️ Choose a date'); return; }
    if (!site) { app.showToast('⚠️ Choose the site these materials were used at'); return; }
    const invalid = validateEntryRows(rows);
    if (invalid) { app.showToast(invalid); return; }
    const materialsUsed = serializeEntryRows(rows);
    if (!materialsUsed.length) { app.showToast('⚠️ Add at least one consumption entry'); return; }

    const payload = { action: 'saveMaterialLog', date, site, by: user.username, materialsUsed };

    if (!navigator.onLine) {
      if (enqueueOffline([payload])) { app.showToast('💾 Offline — will sync on reconnect'); setRows([emptyEntryRow()]); }
      else app.showToast('⚠️ Offline and could not queue — try again');
      return;
    }

    setSaving(true);
    app.showToast('☁️ Saving consumption entries...');
    try {
      const res = await apiPost(payload); // a 401 drops to the login screen; the entered rows stay
      if (res && res.error) { app.showToast('⚠️ Save failed: ' + res.error); return; }
      app.showToast(`✅ Saved ${materialsUsed.length} consumption entr${materialsUsed.length === 1 ? 'y' : 'ies'} for ${site}`);
      setRows([emptyEntryRow()]); // keep date + site for the next entry
      app.reloadMaterialLogs();
    } catch (e) {
      app.showToast('⚠️ Save failed — check connection');
    } finally {
      setSaving(false);
    }
  };

  const excluded = counts.Contractor + counts.Other;
  const loading = !data.logs.length && (data.status === 'loading' || data.status === 'idle');

  let logBody;
  if (!data.logs.length) {
    if (loading) {
      logBody = <div className="list"><div className="stack" style={{ padding: 16 }}>{[0, 1, 2, 3].map(i => <div key={i} className="skel" style={{ height: 30 }} />)}</div></div>;
    } else if (data.status === 'error') {
      logBody = <div className="list"><div className="empty"><h3>Couldn’t load consumption entries</h3><p className="muted">Check your connection and try again.</p><button type="button" className="btn" onClick={app.reloadMaterialLogs}><Icon name="refresh" />Retry</button></div></div>;
    } else {
      logBody = <div className="list"><div className="empty"><h3>No consumption logged yet</h3><p className="muted">Use the form above to log today’s materials.</p></div></div>;
    }
  } else if (!filteredLogs.length) {
    logBody = <div className="list"><div className="empty"><h3>No entries match these filters</h3><p className="muted">Clear a filter or widen the date range.</p><button type="button" className="btn" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button></div></div>;
  } else {
    const shown = filteredLogs.slice(0, visibleLogs);
    logBody = (
      <>
        <div className="list tscroll">
          <table className="dt">
            <thead>
              <tr><th>Date</th><th>Site</th><th>Material</th><th className="n">Quantity</th><th>Ownership</th><th>Contractor / output</th><th>Logged by</th></tr>
            </thead>
            <tbody>
              {shown.map((l, i) => {
                const output = formatOutput(l.outputQty, l.outputUnit);
                const trust = normalizeOwnership(l.ownership) === 'Trust';
                return (
                  <tr key={l.id || `${l.createdAt}-${i}`} className={trust ? '' : 'ref'}>
                    <td style={{ whiteSpace: 'nowrap' }}><b>{shortDate(l.date)}</b></td>
                    <td>{siteDisplayName(l.site, data.projects)}</td>
                    <td>
                      <b>{l.material_name}</b>
                      {l.remarks && <div className="sub">“{l.remarks}”</div>}
                    </td>
                    <td className="n" style={{ whiteSpace: 'nowrap' }}><span className="qty">{formatQty(l.qty)}</span> <span className="muted">{l.unit}</span></td>
                    <td><OwnershipBadge ownership={l.ownership} /></td>
                    <td>
                      {l.contractor || <span className="muted">—</span>}
                      {output && <div className="sub">Output: {output}</div>}
                    </td>
                    <td>{l.loggedBy || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="more-wrap">
          <span className="muted small">Showing {shown.length} of {filteredLogs.length}{isFiltered ? ` (${data.logs.length} total)` : ''}</span>
          {filteredLogs.length > visibleLogs && (
            <button type="button" className="btn sm" onClick={() => setVisibleLogs(v => v + LOG_PAGE)}>
              Show {Math.min(LOG_PAGE, filteredLogs.length - visibleLogs)} more
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Material consumption</h1>
          <p className="lede">Log what each site used. Only Trust-supplied material counts toward the totals; contractor and other entries are kept for reference.</p>
        </div>
        <button type="button" className="btn" onClick={app.reloadMaterialLogs} disabled={data.status === 'loading'}>
          <Icon name="refresh" />{data.status === 'loading' ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="mat-grid">
        <section className="panel mat-panel">
          <h2 className="panel-title">Log consumption</h2>
          <div className="grid2" style={{ marginBottom: 6 }}>
            <label className="field">
              <span>Date</span>
              <input className="input" type="date" value={date} max={getLocalTodayYMD()} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span>Site</span>
              <select className="select" value={site} onChange={(e) => setSite(e.target.value)}>
                <option value="">{data.projects.length ? 'Choose site' : 'Loading sites…'}</option>
                {siteOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
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
          <button type="button" className="btn add mat" onClick={() => setRows(rs => [...rs, emptyEntryRow()])}><Icon name="plus" />Add material</button>
          <div className="row between" style={{ marginTop: 16 }}>
            <span className="muted small">{ready ? `${ready} entr${ready === 1 ? 'y' : 'ies'} ready to save` : 'Add at least one material with a quantity'}</span>
            <button type="button" className="btn primary" onClick={save} disabled={saving || !rows.some(entryRowHasContent)}>
              <Icon name="check" />{saving ? 'Saving…' : 'Save consumption'}
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Trust material totals</h2>
            <span className="tag mat">Trust only</span>
          </div>
          {totals.length ? (
            <div className="tscroll">
              <table className="dt">
                <thead><tr><th>Material</th><th className="n">Total</th><th className="n">Entries</th></tr></thead>
                <tbody>
                  {totals.map(t => (
                    <tr key={`${t.material}|${t.unit}`}>
                      <td>{t.material}</td>
                      <td className="n" style={{ whiteSpace: 'nowrap' }}><span className="qty">{formatQty(t.qty)}</span> <span className="muted">{t.unit || '—'}</span></td>
                      <td className="n">{t.entries}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">{loading ? 'Loading…' : 'No Trust-supplied consumption in this selection.'}</p>
          )}
          <p className="hint" style={{ marginTop: 12 }}>
            {filters.start || filters.end || filters.site || filters.material ? 'Cumulative for the filtered selection. ' : 'Cumulative for all logged entries. '}
            {excluded > 0
              ? `${excluded} Contractor/Other entr${excluded === 1 ? 'y is' : 'ies are'} excluded from these totals.`
              : 'Contractor/Other entries are excluded from these totals.'}
          </p>
        </section>
      </div>

      <section className="section-gap">
        <div className="page-head" style={{ marginBottom: 12 }}>
          <h2 className="panel-title">Consumption log</h2>
          {isFiltered && <button type="button" className="btn sm ghost" onClick={() => { setFilters(EMPTY_FILTERS); setVisibleLogs(LOG_PAGE); }}><Icon name="x" />Clear filters</button>}
        </div>
        <div className="filters five">
          <label className="field">
            <span>Site</span>
            <select className="select" value={filters.site} onChange={setFilter('site')}>
              <option value="">All sites</option>
              {logSites.map(s => <option key={s} value={s}>{siteDisplayName(s, data.projects)}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Material</span>
            <select className="select" value={filters.material} onChange={setFilter('material')}>
              <option value="">All materials</option>
              {logMaterials.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Ownership</span>
            <select className="select" value={filters.ownership} onChange={setFilter('ownership')}>
              <option value="">All</option>
              {OWNERSHIP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
          <label className="field"><span>From</span><input className="input" type="date" value={filters.start} onChange={setFilter('start')} /></label>
          <label className="field"><span>To</span><input className="input" type="date" value={filters.end} onChange={setFilter('end')} /></label>
        </div>
        {logBody}
      </section>
    </>
  );
}
