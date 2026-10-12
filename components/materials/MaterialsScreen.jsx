'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiMutate, apiPost } from '../../lib/client/api';
import { enqueueOffline, useApp } from '../app/AppContext';
import ConsumptionEntryRow from './ConsumptionEntryRow';
import MaterialReport from './MaterialReport';
import ReportActionBar from '../report/ReportActionBar';
import EditHistory from '../report/EditHistory';
import { submissionAuditId } from '../../lib/audit';
import Dialog from '../ui/Dialog';
import ExportButtons from '../ui/ExportButtons';
import { exportMaterialLogCsv, exportMaterialLogExcel } from '../../lib/exports/logExports';
import Icon from '../ui/Icon';
import SiteOptions from '../ui/SiteOptions';
import { siteDisplayName } from '../../lib/report/reportModel';
import { contractorsForSite, isArchivedSite, siteFilterOptions, siteFilterPaths, siteKey, sitePaths as sitePathsOf } from '../../lib/sites';
import SiteFilterOptions from '../ui/SiteFilterOptions';
import { buildMaterialReport } from '../../lib/materials/materialReport';
import {
  DATE_PRESETS, OWNERSHIP_OPTIONS, TRUST, activePreset, batchKey, emptyEntryRow, entryRowFrom, entryRowHasContent, filterLogs, formatQty,
  groupSubmissions, materialTotals, normalizeOwnership, ownershipCounts, presetRange, serializeEntryRows, sortLogsNewestFirst, submissionAccess,
  submissionMaterialTotals, validateEntryRows,
} from '../../lib/materials/consumption';

const LOG_PAGE = 25;
// site, contractor, material and the date range are shared by the log and
// the totals; ownership filters the log only (the totals have their own).
const EMPTY_FILTERS = { start: '', end: '', site: '', contractor: '', material: '', ownership: '' };

// Ownership the totals count: [value, button label, title noun].
const TOTALS_OWNERSHIP = [[TRUST, 'Trust only', 'Trust material totals'], ['Contractor', 'Contractor only', 'Contractor material totals'], ['', 'All ownerships', 'Material totals — all ownerships']];

const lower = (v) => String(v || '').trim().toLowerCase();

function getLocalTodayYMD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shortDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  if (!m) return String(ymd || '');
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Batch id for one submission (lib/dprSupabaseApi.js saveMaterialLog()).
function newBatchId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ (Math.random() * 16) >> (c / 4)).toString(16));
}

const OWNER_TAG = { Trust: 'info', Contractor: 'warn', Other: '' };

export function OwnershipBadge({ ownership }) {
  const o = normalizeOwnership(ownership);
  return <span className={`tag ${OWNER_TAG[o]}`}>{o}</span>;
}

// After a save: the day's consumption report and its export actions.
function SavedView({ result, onBack, onClose }) {
  const { report, queued, count } = result;
  return (
    <>
      <div className="success-hero">
        <div className={`tick${queued ? ' warn' : ''}`}><Icon name="check" /></div>
        <div>
          <h2 className="form-title">{queued ? 'Consumption saved offline' : 'Consumption saved'}</h2>
          <p className="lede">
            {count} entr{count === 1 ? 'y' : 'ies'} for {report.siteDisplay}, {report.displayDate}.
            {queued ? ' They sync automatically when you’re back online.' : ` The report below covers ${count === 1 ? 'this entry' : 'these entries'} only.`}
          </p>
        </div>
      </div>
      <div className="success">
        <MaterialReport report={report} />
        <div className="stack">
          <section className="panel">
            <h2 className="panel-title">Share this report</h2>
            <ReportActionBar report={report} layout="list" />
          </section>
          <button type="button" className="btn ghost" onClick={onBack}><Icon name="plus" />Log more consumption</button>
          <button type="button" className="btn ghost" onClick={() => { onBack(); onClose(); }}>Done — back to the log</button>
        </div>
      </div>
    </>
  );
}

// Edit one submission: every material saved with it, which can be changed,
// removed or added to. Date, site and logger stay as logged.
// contractors: the submission's site's contractors (its own older values stay selectable).
function EditSubmissionDialog({ submission, materials, contractors, onClose, onSaved }) {
  const { showToast } = useApp();
  const [rows, setRows] = useState(() => submission.entries.map(e => ({ ...entryRowFrom(e), id: e.id })));
  const [busy, setBusy] = useState(false);
  const updateRow = (k, next) => setRows(rs => rs.map(r => (r.key === k ? next : r)));
  const removeRow = (k) => setRows(rs => (rs.length > 1 ? rs.filter(r => r.key !== k) : rs));

  const save = async () => {
    const invalid = validateEntryRows(rows);
    if (invalid) { showToast(invalid); return; }
    const entries = rows.flatMap(r => serializeEntryRows([r]).map(e => ({ ...e, id: r.id || '' })));
    if (!entries.length) { showToast('⚠️ Keep at least one material with a quantity'); return; }
    setBusy(true);
    try {
      await apiMutate({ action: 'updateMaterialSubmission', ids: submission.entries.map(e => e.id), entries });
      showToast('✅ Submission updated');
      onSaved();
    } catch (err) {
      showToast(`⚠️ ${err.message || 'Update failed'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Edit submission — ${submission.site}, ${shortDate(submission.date)}`}
      onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" onClick={save} disabled={busy}><Icon name="check" />{busy ? 'Saving…' : 'Save changes'}</button>
      </>}
    >
      <p className="hint" style={{ marginBottom: 8 }}>Date and site stay as logged. Logged by {submission.loggedBy || '—'}.</p>
      {rows.map((r, i) => (
        <ConsumptionEntryRow
          key={r.key}
          index={i}
          row={r}
          materials={materials}
          contractors={contractors}
          onChange={(next) => updateRow(r.key, next)}
          onRemove={() => removeRow(r.key)}
          canRemove={rows.length > 1}
        />
      ))}
      <button type="button" className="btn add mat" onClick={() => setRows(rs => [...rs, emptyEntryRow()])}><Icon name="plus" />Add material</button>
    </Dialog>
  );
}

// View / edit / delete buttons for one submission, per submissionAccess().
// archived: its site is inactive, so it's read-only (admins may delete).
function SubmissionActions({ submission, user, archived, onView, onEdit, onDelete }) {
  const access = submissionAccess(submission.entries, user, { archived });
  const what = `${submission.site}, ${submission.date}`;
  return (
    <>
      <button type="button" className="icon-btn" onClick={onView} title="View submission report" aria-label={`View report for ${what}`}><Icon name="eye" /></button>
      {access.edit === 'direct' && <button type="button" className="icon-btn" onClick={onEdit} title="Edit submission" aria-label={`Edit submission for ${what}`}><Icon name="edit" /></button>}
      {access.delete === 'direct' && <button type="button" className="icon-btn danger" onClick={onDelete} title="Delete submission" aria-label={`Delete submission for ${what}`}><Icon name="trash" /></button>}
    </>
  );
}

// Materials tab: consumption-entry form, Trust-only material totals, the
// filtered consumption log with its edit/delete lifecycle, and the
// Material Consumption Report.
export default function MaterialsScreen() {
  const app = useApp();
  const [date, setDate] = useState(getLocalTodayYMD);
  const [site, setSite] = useState('');
  const [rows, setRows] = useState(() => [emptyEntryRow()]);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [totalsOwnership, setTotalsOwnership] = useState(TRUST); // '' = all ownerships
  const [bySite, setBySite] = useState(false);  // totals split per site
  const fromRef = useRef(null);
  const [visibleLogs, setVisibleLogs] = useState(LOG_PAGE); // submissions shown
  const [saved, setSaved] = useState(null);     // { report, queued, count }
  const [viewingKey, setViewing] = useState(null); // batchKey of the submission whose report is open
  const [editingKey, setEditing] = useState(null); // batchKey of the submission being edited

  // Leaving the tab closes any open dialog (they're portalled to <body>).
  useEffect(() => { if (app.activeTab !== 'Materials') { setViewing(null); setEditing(null); } }, [app.activeTab]);
  useEffect(() => { if (saved) window.scrollTo({ top: 0, behavior: 'smooth' }); }, [saved]);
  useEffect(() => { if (!app.materialFormOpen) setSaved(null); }, [app.materialFormOpen]);

  const data = useMemo(() => ({
    logs: app.materialLogs, status: app.materialLogsStatus, materials: app.materials, projects: app.projects,
  }), [app.materialLogs, app.materialLogsStatus, app.materials, app.projects]);

  const activeMaterials = useMemo(
    () => data.materials.filter(m => m.status !== 'inactive').slice().sort((a, b) => String(a.material_name).localeCompare(String(b.material_name))),
    [data.materials]
  );

  // Contractors allocated to a site (lib/sites.js); null while no site is chosen.
  const contractorsAt = (s) => (s ? contractorsForSite(app.contractors, data.projects, s).map(c => c.name) : null);
  const siteContractors = useMemo(() => contractorsAt(site), [site, app.contractors, data.projects]); // eslint-disable-line react-hooks/exhaustive-deps

  const isFiltered = Object.values(filters).some(Boolean);
  // filters.site is a full site path; a parent filters to all of its
  // sub-sites — by path, so Surat's never pulls in Vasad's "Temple".
  const sitePaths = useMemo(() => (filters.site ? siteFilterPaths(filters.site, data.projects) : null), [filters.site, data.projects]);
  const logFilters = useMemo(() => ({ ...filters, sitePaths }), [filters, sitePaths]);
  const filteredLogs = useMemo(() => sortLogsNewestFirst(filterLogs(data.logs, logFilters)), [data.logs, logFilters]);
  // Totals follow the shared filters; which ownership they count is the
  // totals panel's own toggle (Trust by default), not the log's filter.
  const summaryLogs = useMemo(() => filterLogs(data.logs, { ...logFilters, ownership: '' }), [data.logs, logFilters]);
  const totals = useMemo(() => materialTotals(summaryLogs, { ownership: totalsOwnership }), [summaryLogs, totalsOwnership]);
  const counts = useMemo(() => ownershipCounts(summaryLogs), [summaryLogs]);
  const multiSite = useMemo(() => new Set(summaryLogs.map(l => lower(l.site))).size > 1, [summaryLogs]);
  const showBySite = bySite && multiSite;

  // The log table lists submissions (one row each), newest first. A
  // submission shows when any of its entries matches the filters, and
  // then shows in full; the exports stay per entry (the matching ones).
  const submissions = useMemo(() => groupSubmissions(sortLogsNewestFirst(data.logs)), [data.logs]);
  const filteredSubs = useMemo(() => {
    if (!isFiltered) return submissions;
    const keys = new Set(filteredLogs.map(batchKey));
    return submissions.filter(sub => keys.has(sub.key));
  }, [submissions, filteredLogs, isFiltered]);
  // Looked up by key so they follow reloads, and close once deleted.
  const viewing = useMemo(() => submissions.find(sub => sub.key === viewingKey) || null, [submissions, viewingKey]);
  const editing = useMemo(() => submissions.find(sub => sub.key === editingKey) || null, [submissions, editingKey]);

  // Project › sub-site options (already scoped to a supervisor's sites by
  // the server), plus any older log site no longer in the project list.
  const siteOptions = useMemo(() => siteFilterOptions(data.projects), [data.projects]);
  const extraSiteOptions = useMemo(() => {
    const known = new Set([...siteOptions.active, ...siteOptions.archived].map(o => lower(o.value)));
    return [...new Set(data.logs.map(l => String(l.site || '').trim()).filter(s => s && !known.has(lower(s))))].sort()
      .map(s => ({ value: s, label: s }));
  }, [siteOptions, data.logs]);

  // Contractors to filter by at a site filter value ('' = every site): the
  // ones allocated there, plus any named on its logged entries.
  const sitePathMap = useMemo(() => sitePathsOf(data.projects), [data.projects]);
  const contractorOptionsFor = (siteValue) => {
    const paths = siteValue ? siteFilterPaths(siteValue, data.projects) : null;
    const byKey = new Map();
    const add = (n) => { const k = lower(n); if (k && !byKey.has(k)) byKey.set(k, String(n).trim()); };
    if (paths) {
      [...sitePathMap.values()].filter(path => paths.has(siteKey(path)))
        .forEach(path => contractorsForSite(app.contractors, data.projects, path).forEach(c => add(c.name)));
    } else {
      (app.contractors || []).filter(c => c.status !== 'inactive').forEach(c => add(c.name));
    }
    data.logs.forEach(l => { if (l.contractor && (!paths || paths.has(siteKey(l.site)))) add(l.contractor); });
    return [...byKey.values()].sort((a, b) => a.localeCompare(b));
  };
  const contractorOptions = useMemo(() => contractorOptionsFor(filters.site), [filters.site, data.projects, data.logs, app.contractors]); // eslint-disable-line react-hooks/exhaustive-deps

  const logMaterials = useMemo(() => [...new Set(data.logs.map(l => l.material_name).filter(Boolean))].sort(), [data.logs]);

  // The report for the submission being viewed — all of its entries.
  const viewReport = useMemo(() => (viewing
    ? buildMaterialReport({ date: viewing.date, site: viewing.site, entries: viewing.entries, projects: data.projects })
    : null), [viewing, data.projects]);

  const patchFilters = (patch) => { setFilters(f => ({ ...f, ...patch })); setVisibleLogs(LOG_PAGE); };
  const setFilter = (field) => (e) => patchFilters({ [field]: e.target.value });
  // Another site drops a contractor filter that doesn't work there.
  const setSiteFilter = (e) => {
    const next = e.target.value;
    const keep = !filters.contractor || contractorOptionsFor(next).some(c => lower(c) === lower(filters.contractor));
    patchFilters(keep ? { site: next } : { site: next, contractor: '' });
  };
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setVisibleLogs(LOG_PAGE); };
  const preset = activePreset(filters);
  const updateRow = (k, next) => setRows(rs => rs.map(r => (r.key === k ? next : r)));
  const removeRow = (k) => setRows(rs => (rs.length > 1 ? rs.filter(r => r.key !== k) : rs));
  const ready = serializeEntryRows(rows).length;
  // Picking another site drops contractors that aren't allocated to it.
  const changeSite = (next) => {
    const allowed = new Set(contractorsAt(next) || []);
    setSite(next);
    setRows(rs => rs.map(r => (!r.contractor || allowed.has(r.contractor) ? r : { ...r, contractor: '' })));
  };

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
    const stray = materialsUsed.map(m => m.contractor).find(c => c && !(siteContractors || []).includes(c));
    if (stray) { app.showToast(`⚠️ ${stray} isn't allocated to ${site} — pick one of its contractors`); return; }

    // One submission = one batch, so its report is the same one the eye
    // button opens from any of its log rows later.
    const batchId = newBatchId();
    const payload = { action: 'saveMaterialLog', date, site, by: user.username, batchId, materialsUsed };
    // The report covers exactly this submission's entries; `saved` (the
    // server's new rows, same order) adds their ids.
    const done = (queued, saved = [], savedBatch = batchId) => {
      const entries = materialsUsed.map((m, i) => ({ ...m, id: saved[i] && saved[i].id, createdAt: (saved[i] && saved[i].createdAt) || new Date().toISOString() }));
      const report = buildMaterialReport({ date, site, projects: data.projects, loggedBy: user.username, entries, batchId: savedBatch });
      setRows([emptyEntryRow()]);
      setSaved({ report, queued, count: materialsUsed.length });
    };

    if (!navigator.onLine) {
      if (enqueueOffline([payload])) { app.showToast('💾 Offline — will sync on reconnect'); done(true); }
      else app.showToast('⚠️ Offline and could not queue — try again');
      return;
    }

    setSaving(true);
    app.showToast('☁️ Saving consumption entries...');
    try {
      const res = await apiPost(payload); // a 401 drops to the login screen; the entered rows stay
      if (res && res.error) { app.showToast('⚠️ Save failed: ' + res.error); return; }
      app.showToast(`✅ Saved ${materialsUsed.length} consumption entr${materialsUsed.length === 1 ? 'y' : 'ies'} for ${site}`);
      done(false, res && res.entries, (res && res.batchId) || ''); // keep date + site for the next entry
      app.reloadMaterialLogs();
    } catch (e) {
      app.showToast('⚠️ Save failed — check connection');
    } finally {
      setSaving(false);
    }
  };

  // ── Edit / delete lifecycle ──
  const run = async (body, success) => {
    try {
      await apiMutate(body);
      app.showToast(success);
      app.reloadMaterialLogs();
      return true;
    } catch (err) {
      app.showToast(`⚠️ ${err.message || 'Action failed'}`);
      return false;
    }
  };
  const deleteSubmission = (sub) => {
    const n = sub.entries.length;
    const what = n === 1 ? `${formatQty(sub.entries[0].qty)} ${sub.entries[0].unit} ${sub.entries[0].material_name}` : `this submission (${n} materials)`;
    if (!window.confirm(`Delete ${what} — ${sub.site}, ${shortDate(sub.date)}?`)) return;
    run({ action: 'deleteMaterialLog', ids: sub.entries.map(e => e.id) }, n === 1 ? '🗑️ Consumption entry deleted' : `🗑️ Submission deleted (${n} materials)`);
  };

  // Entries the totals leave out under the current ownership toggle.
  const excludedOwners = OWNERSHIP_OPTIONS.filter(o => totalsOwnership && o !== totalsOwnership);
  const excluded = excludedOwners.reduce((n, o) => n + counts[o], 0);
  const [, , totalsTitle] = TOTALS_OWNERSHIP.find(([v]) => v === totalsOwnership);
  let rangeText = 'all dates';
  if (preset === 'custom') {
    if (filters.start && filters.end) rangeText = `${shortDate(filters.start)} – ${shortDate(filters.end)}`;
    else rangeText = filters.start ? `from ${shortDate(filters.start)}` : `up to ${shortDate(filters.end)}`;
  } else if (preset !== 'all') {
    rangeText = DATE_PRESETS.find(([k]) => k === preset)[1].toLowerCase();
  }
  const scopeText = [
    filters.site ? siteDisplayName(filters.site, data.projects) : 'all sites',
    rangeText,
    filters.contractor && `contractor ${filters.contractor}`,
    filters.material,
  ].filter(Boolean).join(' · ');
  const loading = !data.logs.length && (data.status === 'loading' || data.status === 'idle');

  let logBody;
  if (!data.logs.length) {
    if (loading) {
      logBody = <div className="list"><div className="stack" style={{ padding: 16 }}>{[0, 1, 2, 3].map(i => <div key={i} className="skel" style={{ height: 30 }} />)}</div></div>;
    } else if (data.status === 'error') {
      logBody = <div className="list"><div className="empty"><h3>Couldn’t load consumption entries</h3><p className="muted">Check your connection and try again.</p><button type="button" className="btn" onClick={app.reloadMaterialLogs}><Icon name="refresh" />Retry</button></div></div>;
    } else {
      logBody = <div className="list"><div className="empty"><h3>No consumption logged yet</h3><p className="muted">Use + Log Material Consumption above to log today’s materials.</p></div></div>;
    }
  } else if (!filteredSubs.length) {
    logBody = <div className="list"><div className="empty"><h3>No entries match these filters</h3><p className="muted">Clear a filter or widen the date range.</p><button type="button" className="btn" onClick={clearFilters}>Clear filters</button></div></div>;
  } else {
    const shown = filteredSubs.slice(0, visibleLogs);
    logBody = (
      <>
        <div className="list tscroll">
          <table className="dt">
            <thead>
              <tr><th>Date</th><th>Site</th><th>Materials</th><th>Ownership</th><th>Logged by</th><th /></tr>
            </thead>
            <tbody>
              {shown.map(sub => {
                const owners = OWNERSHIP_OPTIONS.filter(o => sub.entries.some(e => normalizeOwnership(e.ownership) === o));
                const anyTrust = owners.includes('Trust');
                return (
                  <tr key={sub.key} className={anyTrust ? '' : 'ref'}>
                    <td style={{ whiteSpace: 'nowrap' }}><b>{shortDate(sub.date)}</b></td>
                    <td>{siteDisplayName(sub.site, data.projects)}</td>
                    <td>
                      <ul className="sub-mats">
                        {submissionMaterialTotals(sub.entries).map(m => (
                          <li key={m.key} className={m.trust ? '' : 'ref'}>
                            {m.material}: <span className="qty-sm">{formatQty(m.qty)}</span> <span className="muted">{m.unit}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td><div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{owners.map(o => <OwnershipBadge key={o} ownership={o} />)}</div></td>
                    <td>
                      {sub.loggedBy || '—'}
                      {sub.editedBy && <div className="sub">Edited by {sub.editedBy}</div>}
                      {isArchivedSite(sub.site, data.projects) && <div><span className="tag" title="This site is inactive — its entries are read-only">Archived</span></div>}
                    </td>
                    <td className="acts">
                      {sub.entries.every(e => e.id) && (
                        <SubmissionActions
                          submission={sub}
                          user={app.user}
                          archived={isArchivedSite(sub.site, data.projects)}
                          onView={() => setViewing(sub.key)}
                          onEdit={() => setEditing(sub.key)}
                          onDelete={() => deleteSubmission(sub)}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="more-wrap">
          <span className="muted small">Showing {shown.length} of {filteredSubs.length} submission{filteredSubs.length === 1 ? '' : 's'}{isFiltered ? ` (${submissions.length} total)` : ''}</span>
          {filteredSubs.length > visibleLogs && (
            <button type="button" className="btn sm" onClick={() => setVisibleLogs(v => v + LOG_PAGE)}>
              Show {Math.min(LOG_PAGE, filteredSubs.length - visibleLogs)} more
            </button>
          )}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          One row per submission. You can edit or delete your own submissions at any time; admins can change any of them.
        </p>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Material consumption</h1>
          <p className="lede">Log what each site used, and find every entry logged. Totals count Trust-supplied material by default — switch them to contractor or all ownerships, or split them per site.</p>
        </div>
        <div className="row">
          <button type="button" className="btn primary" onClick={app.openMaterialForm} aria-expanded={app.materialFormOpen}><Icon name="plus" />Log Material Consumption</button>
          <ExportButtons
            noun="entry"
            plural="entries"
            count={filteredLogs.length}
            formats={[
              { kind: 'csv', label: 'CSV', run: () => exportMaterialLogCsv(filteredLogs) },
              { kind: 'excel', label: 'Excel', run: () => exportMaterialLogExcel(filteredLogs) },
            ]}
          />
          <button type="button" className="btn ghost" onClick={app.reloadMaterialLogs} disabled={data.status === 'loading'}>
            <Icon name="refresh" />{data.status === 'loading' ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <section className="form-drawer" aria-label="Material consumption entry form" hidden={!app.materialFormOpen}>
        {saved ? <SavedView result={saved} onBack={() => setSaved(null)} onClose={app.closeMaterialForm} /> : (
          <>
            <div className="page-head">
              <div>
                <h2 className="form-title">Log consumption</h2>
                <p className="lede">One submission per site and day. Contractors are limited to the ones allocated to the chosen site.</p>
              </div>
              <button type="button" className="icon-btn" onClick={app.closeMaterialForm} aria-label="Close the form" title="Close — entries you’ve typed are kept"><Icon name="x" /></button>
            </div>
            <section className="panel mat-panel" style={{ marginBottom: 16 }}>
              <div className="grid2" style={{ marginBottom: 6 }}>
                <label className="field">
                  <span>Date</span>
                  <input className="input" type="date" value={date} max={getLocalTodayYMD()} onChange={(e) => setDate(e.target.value)} />
                </label>
                <label className="field">
                  <span>Site</span>
                  <select className="select" value={site} onChange={(e) => changeSite(e.target.value)}>
                    <SiteOptions projects={data.projects} current={site} />
                  </select>
                </label>
              </div>
              {rows.map((r, i) => (
                <ConsumptionEntryRow
                  key={r.key}
                  index={i}
                  row={r}
                  materials={activeMaterials}
                  contractors={siteContractors}
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
          </>
        )}
      </section>

      <section className="panel" aria-label="Filters">
        <div className="panel-head">
          <div>
            <h2 className="panel-title">Filters</h2>
            <p className="hint">Apply to the material totals and the consumption log below.</p>
          </div>
          {isFiltered && <button type="button" className="btn sm ghost" onClick={clearFilters}><Icon name="x" />Clear filters</button>}
        </div>
        <div className="seg" role="group" aria-label="Date range" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
          {DATE_PRESETS.map(([k, label]) => (
            <button key={k} type="button" className={preset === k ? 'on' : ''} aria-pressed={preset === k} onClick={() => patchFilters(presetRange(k))}>{label}</button>
          ))}
          <button type="button" className={preset === 'custom' ? 'on' : ''} aria-pressed={preset === 'custom'} onClick={() => fromRef.current && fromRef.current.focus()}>Custom</button>
        </div>
        <div className="filters five">
          <label className="field">
            <span>Site</span>
            <select className="select" value={filters.site} onChange={setSiteFilter}>
              <SiteFilterOptions options={siteOptions} extra={extraSiteOptions} />
            </select>
          </label>
          <label className="field">
            <span>Contractor</span>
            <select className="select" value={filters.contractor} onChange={setFilter('contractor')}>
              <option value="">All contractors</option>
              {contractorOptions.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Material</span>
            <select className="select" value={filters.material} onChange={setFilter('material')}>
              <option value="">All materials</option>
              {logMaterials.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="field"><span>From</span><input ref={fromRef} className="input" type="date" value={filters.start} max={filters.end || undefined} onChange={setFilter('start')} /></label>
          <label className="field"><span>To</span><input className="input" type="date" value={filters.end} min={filters.start || undefined} onChange={setFilter('end')} /></label>
        </div>
      </section>

      <div className="section-gap">
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">{totalsTitle}</h2>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <div className="seg" role="group" aria-label="Ownership counted in the totals" style={{ flexWrap: 'wrap' }}>
                {TOTALS_OWNERSHIP.map(([v, label]) => (
                  <button key={label} type="button" className={totalsOwnership === v ? 'on' : ''} aria-pressed={totalsOwnership === v} onClick={() => setTotalsOwnership(v)}>{label}</button>
                ))}
              </div>
              {multiSite && (
                <div className="seg" role="group" aria-label="Group the totals">
                  <button type="button" className={showBySite ? '' : 'on'} aria-pressed={!showBySite} onClick={() => setBySite(false)}>Total</button>
                  <button type="button" className={showBySite ? 'on' : ''} aria-pressed={showBySite} onClick={() => setBySite(true)}>By site</button>
                </div>
              )}
            </div>
          </div>
          {totals.length ? (
            <div className="tscroll">
              <table className="dt">
                <thead><tr><th>{showBySite ? 'Material / site' : 'Material'}</th><th className="n">Total</th><th className="n">Entries</th></tr></thead>
                <tbody>
                  {totals.map(t => {
                    const key = `${t.material}|${t.unit}`;
                    return [
                      <tr key={key} className={showBySite ? 'grp' : ''}>
                        <td>{t.material}</td>
                        <td className="n" style={{ whiteSpace: 'nowrap' }}><span className="qty">{formatQty(t.qty)}</span> <span className="muted">{t.unit || '—'}</span></td>
                        <td className="n">{t.entries}</td>
                      </tr>,
                      ...(showBySite ? t.sites.map(st => (
                        <tr key={`${key}|${st.site}`} className="site-split">
                          <td>{siteDisplayName(st.site, data.projects)}</td>
                          <td className="n" style={{ whiteSpace: 'nowrap' }}>{formatQty(st.qty)} <span className="muted">{t.unit || '—'}</span></td>
                          <td className="n">{st.entries}</td>
                        </tr>
                      )) : []),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">{loading ? 'Loading…' : `No ${totalsOwnership ? `${totalsOwnership}-supplied ` : ''}consumption in this selection.`}</p>
          )}
          <p className="hint" style={{ marginTop: 12 }}>
            Cumulative for {scopeText}.{' '}
            {excludedOwners.length > 0 && (excluded > 0
              ? `${excluded} ${excludedOwners.join('/')} entr${excluded === 1 ? 'y is' : 'ies are'} excluded from these totals.`
              : `${excludedOwners.join('/')} entries are excluded from these totals.`)}
          </p>
        </section>
      </div>

      <section className="section-gap">
        <div className="list-bar log-head">
          <div>
            <h2 className="panel-title">Consumption log</h2>
            <p className="hint">{isFiltered ? `${filteredSubs.length} of ${submissions.length} submissions have matching entries — exports cover the ${filteredLogs.length} matching entries.` : `${submissions.length} submissions, ${data.logs.length} entries. Exports list each entry shown by the filters.`}</p>
          </div>
          <label className="field log-owner">
            <span>Ownership</span>
            <select className="select" value={filters.ownership} onChange={setFilter('ownership')}>
              <option value="">All</option>
              {OWNERSHIP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </label>
        </div>
        {logBody}
      </section>

      {viewReport && (
        <Dialog title={`${viewReport.entries.length > 1 ? `${viewReport.entries.length} materials` : viewing.entries[0].material_name} — ${viewReport.siteDisplay}, ${shortDate(viewReport.date)}`} paper onClose={() => setViewing(null)} footer={<ReportActionBar report={viewReport} />}>
          {app.user && app.user.role === 'admin' && viewing.entries.every(e => e.id) && (
            <EditHistory kind="material" id={submissionAuditId(viewing.entries)} entryIds={viewing.entries.map(e => e.id)} />
          )}
          <MaterialReport report={viewReport} />
        </Dialog>
      )}
      {editing && (
        <EditSubmissionDialog
          key={editing.key}
          submission={editing}
          materials={activeMaterials}
          contractors={contractorsAt(editing.site)}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); app.reloadMaterialLogs(); }}
        />
      )}
    </>
  );
}
