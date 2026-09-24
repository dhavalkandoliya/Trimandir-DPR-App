'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ErrorBoundary from '../ui/ErrorBoundary';
import ExecutiveReport from '../report/ExecutiveReport';
import ReportActionBar from '../report/ReportActionBar';
import { buildReport, consumptionForRecord, recordActivities } from '../../lib/report/reportModel';
import ConsumptionEntryRow from '../materials/ConsumptionEntryRow';
import {
  emptyEntryRow, entryRowFrom, entryRowHasContent, serializeEntryRows, validateEntryRows,
} from '../../lib/materials/consumption';

const API = '/api/proxy';
const DRAFT_KEY = 'dpr_form_draft';
const OFFLINE_QUEUE_KEY = 'dprOfflineQ';

const CONDITIONS = [
  { val: 'Sunny',       label: '☀️ Sunny' },
  { val: 'Rainy',       label: '🌧️ Rainy' },
  { val: 'Cloudy',      label: '☁️ Cloudy' },
  { val: 'Site Closed', label: '🚧 Site Closed' },
  { val: 'Holiday',     label: '🎉 Holiday' },
];

// ── Pure helpers ──────────────────────────────────────────────────────

function getLocalTodayYMD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

const toCount = (v) => Math.max(0, Number(v) || 0);
const isTopLevel = (item) => !item.parent_id || String(item.parent_id).trim() === '';

let _keySeq = 0;
const nextKey = () => `r${++_keySeq}`;

function emptyActivityRow() {
  return { key: nextKey(), main: '', sub: '', skilled: '0', unskilled: '0', plannedQty: '', note: '' };
}

// Accepts both the draft shape ({main_activity, sub_activity, ...}) and the
// getDprList() record shape ({activity, main_activity, ...}, where `activity`
// holds the sub-activity name when one was chosen — see buildManpowerEntryRows
// in lib/dprSupabaseApi.js).
function activityRowFrom(a) {
  const main = a.main_activity || a.activity || '';
  let sub = a.sub_activity || '';
  if (!sub && a.main_activity && a.activity && a.activity !== a.main_activity) sub = a.activity;
  return {
    key: nextKey(),
    main,
    sub,
    skilled: String(a.skilled != null ? toCount(a.skilled) : 0),
    unskilled: String(a.unskilled != null ? toCount(a.unskilled) : 0),
    plannedQty: a.plannedQty ? String(a.plannedQty) : '',
    note: a.note || '',
  };
}

function rowsFromRecord(item) {
  return recordActivities(item).map(activityRowFrom);
}

// Row → wire/draft shape expected by saveDPR/editDPR (lib/dprSupabaseApi.js).
// No `section` is sent — the DPR is one unified table now.
function serializeActivity(r) {
  return {
    main_activity: r.main.trim(),
    sub_activity: r.sub.trim(),
    skilled: toCount(r.skilled),
    unskilled: toCount(r.unskilled),
    note: r.note.trim(),
    plannedQty: toCount(r.plannedQty),
  };
}

function readDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function enqueueOffline(payloads) {
  try {
    const q = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]');
    q.push(...payloads);
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
    return true;
  } catch (e) {
    return false;
  }
}

async function apiPost(body) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── Legacy bridge ─────────────────────────────────────────────────────
// The rest of the app (login, tabs, toasts, History) is still the legacy
// script injected by app/page.js. These wrappers are the only places this
// component touches it — see index.html's "DPR ENTRY FORM" section comment.

const legacy = {
  toast: (msg) => window.showToast?.(msg),
  actionToast: (msg, label, fn) => window.showActionToast?.(msg, label, fn),
  user: () => window.__getCurrentUser?.() || null,
  projects: () => window.__getProjects?.() || [],
  activities: () => window.__getActivities?.() || [],
  materials: () => window.__getMaterials?.() || [],
  materialLogs: () => window.__getMaterialLogs?.() || [],
  history: () => window.__getHistory?.() || [],
  reloadHistory: () => window.loadHistory?.(),
  reloadMaterialLogs: () => window.loadMaterialLogs?.(),
  editDprAt: (idx) => window.editDPR?.(idx),
};

// ── Subcomponents ─────────────────────────────────────────────────────

function Stepper({ label, value, onChange }) {
  const set = (n) => onChange(String(Math.max(0, n)));
  return (
    <div>
      <label>{label}</label>
      <div className="counter-wrap">
        <button type="button" className="counter-btn" onClick={() => set(toCount(value) - 1)} aria-label={`Decrease ${label.toLowerCase()}`}>−</button>
        <input
          type="number"
          inputMode="numeric"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => set(toCount(value))}
          aria-label={label}
        />
        <button type="button" className="counter-btn" onClick={() => set(toCount(value) + 1)} aria-label={`Increase ${label.toLowerCase()}`}>+</button>
      </div>
    </div>
  );
}

function ActivityRow({ index, row, mains, subsFor, onChange, onRemove }) {
  const subs = subsFor(row.main);
  const mainKnown = mains.some(m => m.activity_name === row.main);
  const subKnown = subs.some(s => s.activity_name === row.sub);
  const showSub = subs.length > 0 || !!row.sub;
  const total = toCount(row.skilled) + toCount(row.unskilled);
  const update = (patch) => onChange({ ...row, ...patch });

  return (
    <div className="activitybox">
      <div className="entry-row-head">
        <span className="entry-row-title">Activity {index + 1}</span>
        <div className="entry-row-actions">
          <span className="entry-row-total">Total: <b>{total}</b></span>
          <button type="button" className="delete-btn entry-row-remove" onClick={onRemove}>🗑️ Remove</button>
        </div>
      </div>

      <label>Main Activity</label>
      <select value={row.main} onChange={(e) => update({ main: e.target.value, sub: '' })}>
        <option value="">— Select Main Activity —</option>
        {mains.map(m => <option key={m.id} value={m.activity_name}>{m.activity_name}</option>)}
        {row.main && !mainKnown && <option value={row.main}>{row.main}</option>}
      </select>

      {showSub && (
        <>
          <label>Sub-Activity</label>
          <select value={row.sub} onChange={(e) => update({ sub: e.target.value })}>
            <option value="">— Select Sub-Activity —</option>
            {subs.map(s => <option key={s.id} value={s.activity_name}>{s.activity_name}</option>)}
            {row.sub && !subKnown && <option value={row.sub}>{row.sub}</option>}
          </select>
        </>
      )}

      <div className="row2">
        <Stepper label="Skilled" value={row.skilled} onChange={(v) => update({ skilled: v })} />
        <Stepper label="Unskilled" value={row.unskilled} onChange={(v) => update({ unskilled: v })} />
      </div>

      <label>Planned Qty <span className="entry-optional">(Optional — for % complete)</span></label>
      <input
        type="number"
        min="0"
        value={row.plannedQty}
        onChange={(e) => update({ plannedQty: e.target.value })}
        placeholder="e.g. total units planned for this activity"
      />
      <label>Note <span className="entry-optional">(Optional)</span></label>
      <input type="text" value={row.note} onChange={(e) => update({ note: e.target.value })} placeholder="Work location or note..." />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────

// Portal-mounted React replacement for the legacy New DPR form
// (addActivityRow/generate/saveToCloud/saveFormDraft in index.html).
export default function DprEntryForm() {
  const [mountNode, setMountNode] = useState(null);
  const [dataVersion, setDataVersion] = useState(0);

  const [date, setDate] = useState(getLocalTodayYMD);
  const [site, setSite] = useState('');
  const [condition, setCondition] = useState('');
  const [rows, setRows] = useState(() => [emptyActivityRow()]);
  const [materialRows, setMaterialRows] = useState([]);
  const [editingKey, setEditingKey] = useState(null);
  const [saving, setSaving] = useState(false);
  const [generatedReport, setGeneratedReport] = useState(null);
  const reportRef = useRef(null);

  // Drafts are only written after the legacy script has told us which state
  // to start from (init/reset/edit) — otherwise the pristine initial render
  // would overwrite a saved draft before bootApp() gets to restore it.
  const readyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const tryFind = () => {
      const el = document.getElementById('__entry_mount__');
      if (el) { if (!cancelled) setMountNode(el); return true; }
      return false;
    };
    if (tryFind()) return undefined;
    const interval = setInterval(() => { if (tryFind()) clearInterval(interval); }, 200);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    const bump = () => setDataVersion(v => v + 1);
    window.addEventListener('dpr:masterDataUpdated', bump);
    window.addEventListener('dpr:historyUpdated', bump);
    window.addEventListener('dpr:materialLogsUpdated', bump);
    return () => {
      window.removeEventListener('dpr:masterDataUpdated', bump);
      window.removeEventListener('dpr:historyUpdated', bump);
      window.removeEventListener('dpr:materialLogsUpdated', bump);
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const master = useMemo(() => {
    if (typeof window === 'undefined') return { projects: [], activities: [], materials: [], history: [] };
    return {
      projects: legacy.projects(),
      activities: legacy.activities(),
      materials: legacy.materials().filter(m => m.status !== 'inactive'),
      history: legacy.history(),
    };
  }, [dataVersion]);

  const siteOptions = useMemo(() => {
    const active = master.projects.filter(p => p.status === 'active');
    return active.filter(isTopLevel).flatMap(top => [
      { value: top.project_name, label: top.project_name },
      ...active
        .filter(p => String(p.parent_id).trim() === String(top.id).trim())
        .map(s => ({ value: s.project_name, label: `  ↳ ${s.project_name}` })),
    ]);
  }, [master.projects]);

  const contractorSuggestions = useMemo(
    // Guarded like `master` above: this also runs during the server prerender.
    () => (typeof window === 'undefined' ? [] : [...new Set(legacy.materialLogs().map(l => String(l.contractor || '').trim()).filter(Boolean))].sort()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataVersion]
  );

  const mains = useMemo(
    () => master.activities.filter(a => isTopLevel(a) && a.status === 'active'),
    [master.activities]
  );

  // Resolved by name (not by the option's id) so a row restored from a draft
  // before the activities list loaded still gets its sub-activities once it does.
  const subsFor = useCallback((mainName) => {
    if (!mainName) return [];
    const parent = master.activities.find(a => isTopLevel(a) && a.activity_name === mainName);
    if (!parent) return [];
    return master.activities.filter(a => String(a.parent_id).trim() === String(parent.id).trim() && a.status === 'active');
  }, [master.activities]);

  const resetForm = useCallback(() => {
    setDate(getLocalTodayYMD());
    setSite('');
    setCondition('');
    setRows([emptyActivityRow()]);
    setMaterialRows([]);
    setEditingKey(null);
  }, []);

  const loadDraftOrReset = useCallback(() => {
    const draft = readDraft();
    if (!draft) { resetForm(); return; }
    setDate(draft.date || getLocalTodayYMD());
    setSite(draft.site || '');
    setCondition(draft.siteCondition || '');
    const acts = Array.isArray(draft.activities) ? draft.activities : [];
    setRows(acts.length ? acts.map(activityRowFrom) : [emptyActivityRow()]);
    const mats = Array.isArray(draft.materials) ? draft.materials : [];
    setMaterialRows(mats.map(entryRowFrom)); // older drafts ({material_name, qty}) load too
    setEditingKey(null);
  }, [resetForm]);

  const loadRecordForEdit = useCallback((item) => {
    setEditingKey(toYMD(item.date) + '||' + String(item.site).trim());
    setDate(toYMD(item.date));
    setSite(item.site || '');
    setCondition(item.siteCondition || '');
    const loaded = rowsFromRecord(item);
    setRows(loaded.length ? loaded : [emptyActivityRow()]);
    setMaterialRows([]);
  }, []);

  // Commands from the legacy script (bootApp, tab switch, History → Edit).
  // Anything sent before this component mounted is queued by sendEntryCommand().
  useEffect(() => {
    const handle = (cmd) => {
      if (!cmd) return;
      if (cmd.type === 'init') loadDraftOrReset();
      else if (cmd.type === 'reset') resetForm();
      else if (cmd.type === 'edit' && cmd.record) loadRecordForEdit(cmd.record);
      readyRef.current = true;
    };
    window.__dprEntryHandler = handle;
    const queued = window.__dprEntryQueue || [];
    window.__dprEntryQueue = [];
    queued.forEach(handle);
    return () => { if (window.__dprEntryHandler === handle) window.__dprEntryHandler = null; };
  }, [loadDraftOrReset, resetForm, loadRecordForEdit]);

  // Draft persistence — same localStorage key/shape the legacy form used, plus
  // `materials`. Edits of an existing DPR are never drafted.
  useEffect(() => {
    if (!readyRef.current || editingKey) return;
    const activities = rows.map(serializeActivity);
    // Draft keeps partially-filled entries too (the save path validates).
    const materials = materialRows.filter(entryRowHasContent).map(m => ({
      material_name: m.name, qty: m.qty, unit: m.unit, ownership: m.ownership, contractor: m.contractor,
      output_qty: m.outputQty, output_unit: m.outputUnit, remarks: m.remarks,
    }));
    const isEmpty = !site && !condition && !materials.length &&
      activities.every(a => !a.main_activity && !a.skilled && !a.unskilled && !a.note && !a.plannedQty);
    try {
      if (isEmpty) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, JSON.stringify({ date, site, siteCondition: condition, activities, materials }));
    } catch (e) { /* storage full/blocked — drafting is best-effort */ }
  }, [date, site, condition, rows, materialRows, editingKey]);

  useEffect(() => {
    if (generatedReport) reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [generatedReport]);

  // ── Derived totals (summary footer) ──
  const totals = useMemo(() => {
    const t = { skilled: 0, unskilled: 0, rows: 0 };
    rows.forEach(r => {
      if (!r.main) return;
      t.rows++;
      t.skilled += toCount(r.skilled);
      t.unskilled += toCount(r.unskilled);
    });
    t.total = t.skilled + t.unskilled;
    t.materials = serializeEntryRows(materialRows).length;
    return t;
  }, [rows, materialRows]);

  // ── Row mutations ──
  const updateRow = (key, next) => setRows(rs => rs.map(r => (r.key === key ? next : r)));
  const removeRow = (key) => setRows(rs => rs.filter(r => r.key !== key));
  const addRow = () => setRows(rs => [...rs, emptyActivityRow()]);
  const updateMaterial = (key, next) => setMaterialRows(ms => ms.map(m => (m.key === key ? next : m)));
  const removeMaterial = (key) => setMaterialRows(ms => ms.filter(m => m.key !== key));
  const addMaterial = () => setMaterialRows(ms => [...ms, emptyEntryRow()]);

  // ── Quick actions ──
  const quickNewToday = () => {
    resetForm();
    const lastSite = master.history[0] ? master.history[0].site : '';
    if (lastSite && siteOptions.some(o => o.value === lastSite)) setSite(lastSite);
    readyRef.current = true;
    legacy.toast('🆕 New DPR ready for today');
  };

  const duplicateLast = () => {
    if (!site) { legacy.toast('⚠️ Select a site first'); return; }
    const prior = master.history.find(h => String(h.site || '').trim() === site.trim());
    if (!prior) { legacy.toast('⚠️ No previous DPR found for this site'); return; }
    const copied = rowsFromRecord(prior);
    if (!copied.length) { legacy.toast('⚠️ Previous DPR has no activity rows'); return; }
    setRows(copied);
    legacy.toast(`📋 Duplicated ${copied.length} activity row(s) from last DPR`);
  };

  // ── Generate & save ──
  const generate = async () => {
    if (saving) return;
    const user = legacy.user();
    if (!user) { legacy.toast('⚠️ Please sign in first'); return; }
    if (!date) { legacy.toast('⚠️ Select a date'); return; }
    if (!site) { legacy.toast('⚠️ Select a site'); return; }

    const activities = rows.filter(r => r.main.trim()).map(serializeActivity);
    const activeActs = activities.filter(a => a.skilled > 0 || a.unskilled > 0);
    if (!activeActs.length) { legacy.toast('⚠️ Enter at least one activity with workers'); return; }

    const invalidMaterial = editingKey ? null : validateEntryRows(materialRows);
    if (invalidMaterial) { legacy.toast(invalidMaterial); return; }
    const materialsUsed = editingKey ? [] : serializeEntryRows(materialRows);

    const total = activities.reduce((s, a) => s + a.skilled + a.unskilled, 0);
    const existing = master.history.find(h => toYMD(h.date) === date && String(h.site).trim() === site.trim());
    const prepBy = existing ? (existing.by || user.username) : user.username;
    const editedBy = existing && existing.by !== user.username ? user.username : '';

    // The preview stays up after the save resets the form, so the
    // JPG/PDF/Share actions keep working against what was submitted.
    setGeneratedReport(buildReport({
      date, site, activities: activeActs, preparedBy: prepBy, editedBy, condition, projects: master.projects,
      // New DPR: the entries on this form. Edit: what's already logged for this site/day.
      materials: editingKey ? consumptionForRecord({ date, site }, legacy.materialLogs()) : materialsUsed,
    }));

    const isEdit = !!editingKey;
    const payload = {
      action: isEdit ? 'editDPR' : 'saveDPR',
      date,
      site,
      total,
      activities,
      by: prepBy,
      editedBy,
      submittedAt: new Date().toISOString(),
      siteCondition: condition,
    };
    const materialPayload = materialsUsed.length
      ? { action: 'saveMaterialLog', date, site, by: user.username, materialsUsed }
      : null;

    if (!navigator.onLine) {
      const queued = enqueueOffline(materialPayload ? [payload, materialPayload] : [payload]);
      legacy.toast(queued ? '💾 Offline — will sync on reconnect' : '⚠️ Offline and could not queue — keep this page open and retry');
      return;
    }

    setSaving(true);
    legacy.toast('☁️ Saving to cloud...');
    try {
      const res = await apiPost(payload);
      if (res && res.status === 'duplicate') {
        legacy.actionToast('⚠️ A DPR already exists for this date & site.', 'Edit existing DPR', () => {
          const idx = legacy.history().findIndex(h => toYMD(h.date) === date && String(h.site || '').trim() === site.trim());
          if (idx > -1) legacy.editDprAt(idx);
          else legacy.toast('⚠️ Could not find it — try reloading History.');
        });
        return;
      }
      if (res && res.error) { legacy.toast('⚠️ Save failed: ' + res.error); return; }

      let materialError = '';
      if (materialPayload) {
        try {
          const mRes = await apiPost(materialPayload);
          if (mRes && mRes.error) materialError = mRes.error;
        } catch (e) {
          materialError = 'connection error';
        }
      }

      // Confirmed success — reset for the next entry but leave the generated
      // #report visible so Download/Share keep working against it.
      if (materialError) legacy.toast(`⚠️ DPR saved, but materials failed (${materialError}) — log them from the Materials tab`);
      else legacy.toast(isEdit ? '✅ DPR Updated!' : '✅ Saved!');
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
      resetForm();
      legacy.reloadHistory();
      if (materialPayload && !materialError) legacy.reloadMaterialLogs();
    } catch (e) {
      legacy.toast('⚠️ Save failed — check connection');
    } finally {
      setSaving(false);
    }
  };

  if (!mountNode) return null;

  const siteKnown = siteOptions.some(o => o.value === site);

  return createPortal(
    <ErrorBoundary>
      <div className="dpr-entry">
        <div className="btn-group entry-quick-actions">
          <button type="button" className="btn-gray btn-sm" onClick={quickNewToday}>🌿 New DPR (Today)</button>
          <button type="button" className="btn-gray btn-sm" onClick={duplicateLast}>📋 Duplicate Last DPR</button>
        </div>

        {editingKey && (
          <div className="entry-edit-banner">
            ✏️ Editing DPR for <b>{date}</b> · {site}
            <button type="button" className="btn-gray btn-sm" onClick={loadDraftOrReset}>Cancel edit</button>
          </div>
        )}

        <div className="card">
          <div className="section-title">📅 Date &amp; Site</div>
          <label htmlFor="entryDate">Date</label>
          <input id="entryDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!!editingKey} />
          <label htmlFor="entrySite">Site / Project</label>
          <select id="entrySite" value={site} onChange={(e) => setSite(e.target.value)} disabled={!!editingKey}>
            <option value="">{master.projects.length ? '— Select Site —' : '⌛ Loading projects...'}</option>
            {siteOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            {site && !siteKnown && <option value={site}>{site}</option>}
          </select>
          <label>Site Condition <span className="entry-optional">(Optional)</span></label>
          <div className="condition-chips">
            {CONDITIONS.map(c => (
              <button
                key={c.val}
                type="button"
                className={`condition-chip${condition === c.val ? ' selected' : ''}`}
                aria-pressed={condition === c.val}
                onClick={() => setCondition(cur => (cur === c.val ? '' : c.val))}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="section-title">📋 Work Activities</div>
          {rows.map((row, i) => (
            <ActivityRow
              key={row.key}
              index={i}
              row={row}
              mains={mains}
              subsFor={subsFor}
              onChange={(next) => updateRow(row.key, next)}
              onRemove={() => removeRow(row.key)}
            />
          ))}
          <button type="button" className="btn-add" onClick={addRow}>+ Add Activity Row</button>
        </div>

        <div className="card">
          <div className="section-title">📦 Consumption Entries <span className="entry-optional">(Optional)</span></div>
          {editingKey ? (
            <p className="entry-hint">Consumption entries aren&apos;t changed when editing a DPR — log extra entries from the Materials tab.</p>
          ) : (
            <>
              {materialRows.map((m, i) => (
                <ConsumptionEntryRow
                  key={m.key}
                  index={i}
                  row={m}
                  materials={master.materials}
                  contractorSuggestions={contractorSuggestions}
                  onChange={(next) => updateMaterial(m.key, next)}
                  onRemove={() => removeMaterial(m.key)}
                />
              ))}
              {!materialRows.length && <p className="entry-hint">No consumption entries added for this DPR.</p>}
              <button type="button" className="btn-add" onClick={addMaterial}>+ Add Entry</button>
            </>
          )}
        </div>

        <div className="entry-summary-bar" role="region" aria-label="DPR summary">
          <div className="entry-summary-stats">
            <div className="entry-stat"><span className="entry-stat-num">{totals.total}</span><span className="entry-stat-lbl">Total</span></div>
            <div className="entry-stat"><span className="entry-stat-num">{totals.skilled}</span><span className="entry-stat-lbl">Skilled</span></div>
            <div className="entry-stat"><span className="entry-stat-num">{totals.unskilled}</span><span className="entry-stat-lbl">Unskilled</span></div>
            <div className="entry-stat"><span className="entry-stat-num">{totals.rows}</span><span className="entry-stat-lbl">Activities</span></div>
            {totals.materials > 0 && (
              <div className="entry-stat"><span className="entry-stat-num">{totals.materials}</span><span className="entry-stat-lbl">Materials</span></div>
            )}
          </div>
          <button type="button" className="btn-green entry-generate-btn" onClick={generate} disabled={saving}>
            {saving ? '⏳ Saving...' : editingKey ? '✅ Update DPR' : '✅ Generate DPR'}
          </button>
        </div>

        {generatedReport && (
          <section className="report-preview" ref={reportRef} aria-label="Generated DPR">
            <div className="report-preview-head">
              <div className="section-title">📊 Generated DPR</div>
              <button type="button" className="modal-close" aria-label="Close preview" onClick={() => setGeneratedReport(null)}>✕</button>
            </div>
            <ReportActionBar report={generatedReport} />
            <ExecutiveReport report={generatedReport} />
          </section>
        )}
      </div>
    </ErrorBoundary>,
    mountNode
  );
}
