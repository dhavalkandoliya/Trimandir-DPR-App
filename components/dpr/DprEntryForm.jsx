'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiPost } from '../../lib/client/api';
import { enqueueOffline, useApp } from '../app/AppContext';
import ExecutiveReport from '../report/ExecutiveReport';
import ReportActionBar from '../report/ReportActionBar';
import Icon from '../ui/Icon';
import {
  CONDITIONS, buildReport, consumptionForRecord, formatDisplayDate, recordActivities,
} from '../../lib/report/reportModel';
import ConsumptionEntryRow from '../materials/ConsumptionEntryRow';
import {
  emptyEntryRow, entryRowFrom, entryRowHasContent, serializeEntryRows, validateEntryRows,
} from '../../lib/materials/consumption';

const DRAFT_KEY = 'dpr_form_draft';
const SEP = '||'; // activity picker value: "<main>||<sub>" ("<main>||" = main activity only)

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

const toCount = (v) => Math.max(0, Math.floor(Number(v) || 0));
const isTopLevel = (item) => !item.parent_id || String(item.parent_id).trim() === '';

let _keySeq = 0;
const nextKey = () => `r${++_keySeq}`;

function emptyActivityRow() {
  return { key: nextKey(), main: '', sub: '', skilled: '0', unskilled: '0', plannedQty: '', note: '', open: false };
}

// Accepts both the draft shape ({main_activity, sub_activity, ...}) and the
// getDprList() record shape ({activity, main_activity, ...}, where `activity`
// holds the sub-activity name when one was chosen — see buildManpowerEntryRows
// in lib/dprSupabaseApi.js).
function activityRowFrom(a) {
  const main = a.main_activity || a.activity || '';
  let sub = a.sub_activity || '';
  if (!sub && a.main_activity && a.activity && a.activity !== a.main_activity) sub = a.activity;
  const note = a.note || '';
  const plannedQty = a.plannedQty ? String(a.plannedQty) : '';
  return {
    key: nextKey(),
    main,
    sub,
    skilled: String(a.skilled != null ? toCount(a.skilled) : 0),
    unskilled: String(a.unskilled != null ? toCount(a.unskilled) : 0),
    plannedQty,
    note,
    open: !!(note || plannedQty),
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

// ── Subcomponents ─────────────────────────────────────────────────────

// −/+ counter. Press and hold a button to keep counting (after 380 ms,
// every 80 ms); ↑/↓ in the field step too. onStep must use a functional
// state update, since the hold interval calls it repeatedly.
function Stepper({ label, value, onChange, onStep }) {
  const timers = useRef({});
  const stop = useCallback(() => { clearTimeout(timers.current.t); clearInterval(timers.current.i); }, []);
  useEffect(() => stop, [stop]);

  const press = (delta) => (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault(); // no focus shift, no text selection while holding
    stop();
    onStep(delta);
    timers.current.t = setTimeout(() => { timers.current.i = setInterval(() => onStep(delta), 80); }, 380);
  };
  const button = (delta, symbol, aria) => (
    <button
      type="button"
      aria-label={aria}
      onPointerDown={press(delta)}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => { if (e.detail === 0) onStep(delta); }} // keyboard activation only; pointers step on press
    >
      {symbol}
    </button>
  );

  return (
    <div>
      <span className="mini-label">{label}</span>
      <div className="step">
        {button(-1, '−', `Fewer ${label.toLowerCase()}`)}
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          aria-label={`${label} workers`}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
          onFocus={(e) => { const el = e.target; setTimeout(() => el.select(), 0); }}
          onBlur={() => onChange(String(toCount(value)))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); onStep(e.key === 'ArrowUp' ? 1 : -1); }
          }}
        />
        {button(1, '+', `More ${label.toLowerCase()}`)}
      </div>
    </div>
  );
}

function ActivityRow({ index, row, mains, subsFor, onChange, onStep, onRemove }) {
  const total = toCount(row.skilled) + toCount(row.unskilled);
  const update = (patch) => onChange({ ...row, ...patch });
  const value = row.main ? `${row.main}${SEP}${row.sub}` : '';

  // Grouped picker: a main activity with sub-activities becomes an
  // optgroup (its first option logs the main activity on its own).
  const known = !row.main || mains.some(m => m.activity_name === row.main && (!row.sub || subsFor(m.activity_name).some(s => s.activity_name === row.sub)));

  return (
    <div className="arow">
      <div className="arow-main">
        <label className="field">
          <span className="sr">Activity {index + 1}</span>
          <select
            className="select"
            value={value}
            onChange={(e) => {
              const [main, sub = ''] = e.target.value.split(SEP);
              update({ main: main || '', sub: e.target.value ? sub : '' });
            }}
          >
            <option value="">Choose activity</option>
            {mains.map(m => {
              const subs = subsFor(m.activity_name);
              if (!subs.length) return <option key={m.id} value={`${m.activity_name}${SEP}`}>{m.activity_name}</option>;
              return (
                <optgroup key={m.id} label={m.activity_name}>
                  <option value={`${m.activity_name}${SEP}`}>{m.activity_name} — general</option>
                  {subs.map(s => <option key={s.id} value={`${m.activity_name}${SEP}${s.activity_name}`}>{s.activity_name}</option>)}
                </optgroup>
              );
            })}
            {!known && <option value={value}>{row.sub ? `${row.main} / ${row.sub}` : row.main} (inactive)</option>}
          </select>
        </label>
        <Stepper label="Skilled" value={row.skilled} onChange={(v) => update({ skilled: v })} onStep={(d) => onStep('skilled', d)} />
        <Stepper label="Unskilled" value={row.unskilled} onChange={(v) => update({ unskilled: v })} onStep={(d) => onStep('unskilled', d)} />
        <div className={`total${total ? '' : ' zero'}`} aria-label={`Total ${total}`}>{total}</div>
        <div className="arow-tools">
          <span className="rt">Total <b>{total}</b></span>
          <span>
            <button
              type="button"
              className={`icon-btn${row.open ? ' on' : ''}`}
              aria-expanded={row.open}
              aria-label="Note and planned quantity"
              title="Note and planned quantity"
              onClick={() => update({ open: !row.open })}
            >
              <Icon name="note" />
            </button>
            <button type="button" className="icon-btn danger" onClick={onRemove} aria-label="Remove activity" title="Remove activity">
              <Icon name="trash" />
            </button>
          </span>
        </div>
      </div>
      {row.open && (
        <div className="arow-more">
          <label className="field">
            <span>Note <em>(optional)</em></span>
            <input className="input" value={row.note} onChange={(e) => update({ note: e.target.value })} placeholder="Location or remark, e.g. Grid C–D, 3rd floor" />
          </label>
          <label className="field">
            <span>Planned qty <em>(optional)</em></span>
            <input className="input" type="number" min="0" inputMode="decimal" value={row.plannedQty} onChange={(e) => update({ plannedQty: e.target.value })} placeholder="e.g. 120" />
          </label>
        </div>
      )}
    </div>
  );
}

// After a save: the submitted report, share/download actions, and a way
// back to a fresh form.
function SuccessView({ result, onNew }) {
  const { report, queued, isEdit } = result;
  const t = report.totals;
  const title = queued ? 'Report saved offline' : isEdit ? 'Changes saved' : 'Report submitted';
  const lede = queued
    ? `${report.siteDisplay}, ${report.displayDate}. It will sync automatically when you're back online.`
    : `${report.siteDisplay}, ${report.displayDate}. ${t.total} workers across ${t.activities} ${t.activities === 1 ? 'activity' : 'activities'}. Share it with the team below.`;
  return (
    <>
      <div className="success-hero">
        <div className={`tick${queued ? ' warn' : ''}`}><Icon name="check" /></div>
        <div><h1>{title}</h1><p className="lede">{lede}</p></div>
      </div>
      <div className="success">
        <ExecutiveReport report={report} />
        <div className="stack">
          <section className="panel">
            <h2 className="panel-title">Share this report</h2>
            <ReportActionBar report={report} layout="list" />
          </section>
          <button type="button" className="btn ghost" onClick={onNew}><Icon name="plus" />Start another report</button>
        </div>
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────

// New DPR form: activity rows, consumption entries, draft, live preview,
// save + success view.
export default function DprEntryForm() {
  const app = useApp();

  const [date, setDate] = useState(getLocalTodayYMD);
  const [site, setSite] = useState('');
  const [condition, setCondition] = useState('');
  const [rows, setRows] = useState(() => [emptyActivityRow()]);
  const [materialRows, setMaterialRows] = useState([]);
  const [editingKey, setEditingKey] = useState(null);
  const [saving, setSaving] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [submitted, setSubmitted] = useState(null); // { report, queued, isEdit }

  // Drafts are only written after the app has told us which state to start
  // from (init/reset/edit) — otherwise the pristine initial render would
  // overwrite a saved draft before the boot's 'init' restores it.
  const readyRef = useRef(false);

  const master = useMemo(() => ({
    projects: app.projects,
    activities: app.activities,
    materials: app.materials.filter(m => m.status !== 'inactive'),
    history: app.history,
  }), [app.projects, app.activities, app.materials, app.history]);

  const siteOptions = useMemo(() => {
    const active = master.projects.filter(p => p.status === 'active');
    return active.filter(isTopLevel).flatMap(top => [
      { value: top.project_name, label: top.project_name },
      ...active
        .filter(p => String(p.parent_id).trim() === String(top.id).trim())
        .map(s => ({ value: s.project_name, label: `  ↳ ${s.project_name}` })),
    ]);
  }, [master.projects]);

  const contractorSuggestions = useMemo(
    () => [...new Set(app.materialLogs.map(l => String(l.contractor || '').trim()).filter(Boolean))].sort(),
    [app.materialLogs]
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

  const username = app.user ? app.user.username : '';
  const loadDraftOrReset = useCallback(() => {
    const draft = readDraft();
    // A draft written by someone else on this device is not theirs to submit.
    // (Older drafts predate the `user` tag and still load.)
    if (!draft || (draft.user && draft.user.toLowerCase() !== username.toLowerCase())) { resetForm(); return; }
    setDate(draft.date || getLocalTodayYMD());
    setSite(draft.site || '');
    setCondition(draft.siteCondition || '');
    const acts = Array.isArray(draft.activities) ? draft.activities : [];
    setRows(acts.length ? acts.map(activityRowFrom) : [emptyActivityRow()]);
    const mats = Array.isArray(draft.materials) ? draft.materials : [];
    setMaterialRows(mats.map(entryRowFrom)); // older drafts ({material_name, qty}) load too
    setEditingKey(null);
  }, [resetForm, username]);

  const loadRecordForEdit = useCallback((item) => {
    setEditingKey(toYMD(item.date) + '||' + String(item.site).trim());
    setDate(toYMD(item.date));
    setSite(item.site || '');
    setCondition(item.siteCondition || '');
    const loaded = rowsFromRecord(item);
    setRows(loaded.length ? loaded : [emptyActivityRow()]);
    setMaterialRows([]);
  }, []);

  // Commands from the app (boot 'init', New report tab 'init', History → 'edit').
  const lastSeq = useRef(0);
  useEffect(() => {
    const c = app.entryCommand;
    if (!c || c.seq === lastSeq.current) return;
    lastSeq.current = c.seq;
    const { cmd } = c;
    setSubmitted(null);
    if (cmd.type === 'init') loadDraftOrReset();
    else if (cmd.type === 'reset') resetForm();
    else if (cmd.type === 'edit' && cmd.record) loadRecordForEdit(cmd.record);
    readyRef.current = true;
  }, [app.entryCommand, loadDraftOrReset, resetForm, loadRecordForEdit]);

  // Draft persistence — same localStorage key/shape as before, plus
  // `materials`. Edits of an existing DPR are never drafted.
  useEffect(() => {
    if (!readyRef.current || editingKey) { setDraftSaved(false); return; }
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
      else localStorage.setItem(DRAFT_KEY, JSON.stringify({ user: username, date, site, siteCondition: condition, activities, materials }));
      setDraftSaved(!isEmpty);
    } catch (e) { setDraftSaved(false); /* storage full/blocked — drafting is best-effort */ }
  }, [date, site, condition, rows, materialRows, editingKey, username]);

  useEffect(() => { if (submitted) window.scrollTo({ top: 0, behavior: 'smooth' }); }, [submitted]);

  // ── Derived totals (summary bar) ──
  const totals = useMemo(() => {
    const t = { skilled: 0, unskilled: 0, rows: 0 };
    rows.forEach(r => {
      if (!r.main) return;
      const sk = toCount(r.skilled), un = toCount(r.unskilled);
      if (sk + un > 0) t.rows++;
      t.skilled += sk;
      t.unskilled += un;
    });
    t.total = t.skilled + t.unskilled;
    t.materials = serializeEntryRows(materialRows).length;
    return t;
  }, [rows, materialRows]);

  // An existing DPR for this date + site (the server refuses a second one).
  const existing = useMemo(() => {
    if (editingKey || !site || !date) return null;
    return master.history.find(h => toYMD(h.date) === date && String(h.site || '').trim() === site.trim()) || null;
  }, [editingKey, site, date, master.history]);

  const preparedBy = existing ? (existing.by || username) : username;

  // Live preview, rebuilt from the form as it's filled in.
  const preview = useMemo(() => {
    if (!site && !rows.some(r => r.main)) return null;
    return buildReport({
      date, site, condition, preparedBy, projects: master.projects, draft: true,
      activities: rows.filter(r => r.main.trim()).map(serializeActivity),
      materials: editingKey ? consumptionForRecord({ date, site }, app.materialLogs) : serializeEntryRows(materialRows),
    });
  }, [date, site, condition, rows, materialRows, editingKey, preparedBy, master.projects, app.materialLogs]);

  // ── Row mutations ──
  const updateRow = (key, next) => setRows(rs => rs.map(r => (r.key === key ? next : r)));
  const stepRow = useCallback((key, field, delta) => {
    setRows(rs => rs.map(r => (r.key === key ? { ...r, [field]: String(Math.max(0, toCount(r[field]) + delta)) } : r)));
  }, []);
  const removeRow = (key) => {
    const index = rows.findIndex(r => r.key === key);
    const removed = rows[index];
    setRows(rs => rs.filter(r => r.key !== key));
    if (removed && (removed.main || toCount(removed.skilled) || toCount(removed.unskilled) || removed.note)) {
      app.showActionToast('Activity removed', 'Undo', () => setRows(rs => [...rs.slice(0, index), removed, ...rs.slice(index)]));
    }
  };
  const addRow = () => setRows(rs => [...rs, emptyActivityRow()]);
  const updateMaterial = (key, next) => setMaterialRows(ms => ms.map(m => (m.key === key ? next : m)));
  const removeMaterial = (key) => setMaterialRows(ms => ms.filter(m => m.key !== key));
  const addMaterial = () => setMaterialRows(ms => [...ms, emptyEntryRow()]);

  // ── Quick actions ──
  const clearForm = () => {
    const snapshot = { date, site, condition, rows, materialRows };
    resetForm();
    readyRef.current = true;
    app.showActionToast('Form cleared', 'Undo', () => {
      setDate(snapshot.date);
      setSite(snapshot.site);
      setCondition(snapshot.condition);
      setRows(snapshot.rows);
      setMaterialRows(snapshot.materialRows);
    });
  };

  const duplicateLast = () => {
    if (!site) { app.showToast('⚠️ Choose a site first'); return; }
    const prior = master.history.find(h => String(h.site || '').trim() === site.trim());
    if (!prior) { app.showToast('⚠️ No previous report found for this site'); return; }
    const copied = rowsFromRecord(prior).map(r => ({ ...r, note: '', open: !!r.plannedQty }));
    if (!copied.length) { app.showToast('⚠️ The previous report has no activity rows'); return; }
    setRows(copied);
    app.showToast(`📋 Copied ${copied.length} activit${copied.length === 1 ? 'y' : 'ies'} from ${formatDisplayDate(prior.date)} — update today's counts`);
  };

  // ── Save ──
  const submit = async () => {
    if (saving) return;
    const user = app.user;
    if (!user) { app.showToast('⚠️ Please sign in first'); return; }
    if (!date) { app.showToast('⚠️ Choose the report date'); return; }
    if (!site) { app.showToast('⚠️ Choose the site this report is for'); return; }

    const activities = rows.filter(r => r.main.trim()).map(serializeActivity);
    const activeActs = activities.filter(a => a.skilled > 0 || a.unskilled > 0);
    if (!activeActs.length) { app.showToast('⚠️ Add at least one activity with workers'); return; }

    const invalidMaterial = editingKey ? null : validateEntryRows(materialRows);
    if (invalidMaterial) { app.showToast(invalidMaterial); return; }
    const materialsUsed = editingKey ? [] : serializeEntryRows(materialRows);

    const total = activities.reduce((s, a) => s + a.skilled + a.unskilled, 0);
    const prior = master.history.find(h => toYMD(h.date) === date && String(h.site).trim() === site.trim());
    const prepBy = prior ? (prior.by || user.username) : user.username;
    const editedBy = prior && prior.by !== user.username ? user.username : '';
    const submittedAt = new Date().toISOString();

    const report = buildReport({
      date, site, activities: activeActs, preparedBy: prepBy, editedBy, condition, projects: master.projects, submittedAt,
      // New DPR: the entries on this form. Edit: what's already logged for this site/day.
      materials: editingKey ? consumptionForRecord({ date, site }, app.materialLogs) : materialsUsed,
    });

    const isEdit = !!editingKey;
    const payload = {
      action: isEdit ? 'editDPR' : 'saveDPR',
      date,
      site,
      total,
      activities,
      by: prepBy,
      editedBy,
      submittedAt,
      siteCondition: condition,
    };
    const materialPayload = materialsUsed.length
      ? { action: 'saveMaterialLog', date, site, by: user.username, materialsUsed }
      : null;

    const finish = (result) => {
      try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
      resetForm();
      setSubmitted(result);
    };

    if (!navigator.onLine) {
      if (enqueueOffline(materialPayload ? [payload, materialPayload] : [payload])) {
        app.showToast('💾 Offline — will sync on reconnect');
        finish({ report, queued: true, isEdit });
      } else {
        app.showToast('⚠️ Offline and could not queue — keep this page open and retry');
      }
      return;
    }

    setSaving(true);
    app.showToast('☁️ Saving to cloud...');
    try {
      const res = await apiPost(payload);
      if (res && res.status === 'duplicate') {
        app.showActionToast('⚠️ A DPR already exists for this date & site.', 'Edit existing DPR', () => {
          const existingRec = app.history.find(h => toYMD(h.date) === date && String(h.site || '').trim() === site.trim());
          if (existingRec) app.editDpr(existingRec);
          else app.showToast('⚠️ Could not find it — try reloading History.');
        });
        return;
      }
      if (res && res.error) { app.showToast('⚠️ Save failed: ' + res.error); return; }

      let materialError = '';
      if (materialPayload) {
        try {
          const mRes = await apiPost(materialPayload);
          if (mRes && mRes.error) materialError = mRes.error;
        } catch (e) {
          materialError = 'connection error';
        }
      }

      if (materialError) app.showToast(`⚠️ DPR saved, but materials failed (${materialError}) — log them from the Materials tab`);
      else app.showToast(isEdit ? '✅ DPR updated' : '✅ Report submitted');
      finish({ report, queued: false, isEdit });
      app.reloadHistory();
      if (materialPayload && !materialError) app.reloadMaterialLogs();
    } catch (e) {
      app.showToast('⚠️ Save failed — check connection');
    } finally {
      setSaving(false);
    }
  };

  if (submitted) return <SuccessView result={submitted} onNew={() => setSubmitted(null)} />;

  const siteKnown = siteOptions.some(o => o.value === site);
  const existingEdit = existing ? app.canEdit(existing) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{editingKey ? 'Edit daily report' : 'New daily report'}</h1>
          <p className="lede">
            {editingKey
              ? `Changes replace the report filed for ${site} on ${formatDisplayDate(date)}.`
              : 'Record today’s manpower by activity. Your draft saves on this device as you type.'}
          </p>
        </div>
        <div className="row">
          {editingKey
            ? <button type="button" className="btn" onClick={loadDraftOrReset}>Cancel editing</button>
            : <button type="button" className="btn" onClick={duplicateLast}><Icon name="copy" />Copy last report</button>}
          {!editingKey && <button type="button" className="btn ghost" onClick={clearForm}>Clear form</button>}
        </div>
      </div>

      {editingKey && (
        <div className="banner info">
          <Icon name="edit" />
          <div className="btxt"><b>Editing a submitted report</b>Date and site are locked. Consumption entries aren’t changed here — log extra entries from the Materials tab.</div>
        </div>
      )}
      {existing && (
        <div className="banner warn">
          <Icon name="lock" />
          <div className="btxt">
            <b>{site} already has a report for {formatDisplayDate(date)}.</b>
            Filed by {existing.by || 'someone'}. Open it instead of filing a second one.
          </div>
          <div className="row">
            {existingEdit && existingEdit.ok
              ? <button type="button" className="btn sm primary" onClick={() => app.editDpr(existing)}>Edit that report</button>
              : existing.editPermission === 'pending'
                ? <span className="tag warn">Edit requested</span>
                : String(existing.by || '').toLowerCase() === username.toLowerCase() &&
                  <button type="button" className="btn sm primary" onClick={() => app.requestEdit(existing)}>Request edit</button>}
          </div>
        </div>
      )}

      <div className="entry-grid">
        <div>
          <section className="panel">
            <h2 className="panel-title">Date, site and conditions</h2>
            <div className="stack">
              <div className="grid2">
                <label className="field">
                  <span>Report date</span>
                  <input className="input" type="date" value={date} max={getLocalTodayYMD()} onChange={(e) => setDate(e.target.value)} disabled={!!editingKey} />
                </label>
                <label className="field">
                  <span>Site</span>
                  <select className="select" value={site} onChange={(e) => setSite(e.target.value)} disabled={!!editingKey}>
                    <option value="">{master.projects.length ? 'Choose site' : 'Loading sites…'}</option>
                    {siteOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    {site && !siteKnown && <option value={site}>{site}</option>}
                  </select>
                </label>
              </div>
              <div className="field">
                <span>Site condition <em>(optional)</em></span>
                <div className="chips" role="group" aria-label="Site condition">
                  {CONDITIONS.map(c => (
                    <button
                      key={c.value}
                      type="button"
                      className={`chip ${c.cls}`}
                      aria-pressed={condition === c.value}
                      onClick={() => setCondition(cur => (cur === c.value ? '' : c.value))}
                    >
                      <span className="cdot" />{c.value}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Manpower by activity</h2>
              <span className="muted small">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
            </div>
            <div className="rows-head" aria-hidden="true"><span>Activity</span><span>Skilled</span><span>Unskilled</span><span>Total</span><span /></div>
            {rows.map((row, i) => (
              <ActivityRow
                key={row.key}
                index={i}
                row={row}
                mains={mains}
                subsFor={subsFor}
                onChange={(next) => updateRow(row.key, next)}
                onStep={(field, delta) => stepRow(row.key, field, delta)}
                onRemove={() => removeRow(row.key)}
              />
            ))}
            {!rows.length && <p className="muted small" style={{ padding: '10px 0' }}>No activities yet.</p>}
            <button type="button" className="btn add" onClick={addRow}><Icon name="plus" />Add activity</button>
          </section>

          <section className="panel mat-panel">
            <div className="panel-head">
              <h2 className="panel-title">Materials used <em>(optional)</em></h2>
              {!editingKey && materialRows.length > 0 && <span className="muted small">{materialRows.length} entr{materialRows.length === 1 ? 'y' : 'ies'}</span>}
            </div>
            {editingKey ? (
              <p className="hint">Consumption entries aren’t changed when editing a report — log extra entries from the Materials tab.</p>
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
                {!materialRows.length && <p className="hint">Log consumption here, or later from the Materials tab. Site and date come from this report.</p>}
                <button type="button" className="btn add mat" onClick={addMaterial}><Icon name="plus" />Add material</button>
              </>
            )}
          </section>
        </div>

        <aside className="entry-preview" aria-label="Report preview">
          <div className="preview-head"><h2 className="panel-title">Live preview</h2><span className="tag">Draft</span></div>
          {preview
            ? <ExecutiveReport report={preview} />
            : <div className="report-empty"><b>The report builds here as you fill the form.</b><br />Choose a site and add activities to see it.</div>}
        </aside>
      </div>

      <div className="summary-bar" role="region" aria-label="Report summary">
        <div className="summary-inner">
          <div className="sum-total"><b>{totals.total}</b><span className="muted">workers</span></div>
          <div className="sum-split">
            <span>Skilled <b>{totals.skilled}</b></span>
            <span>Unskilled <b>{totals.unskilled}</b></span>
            <span>Activities <b>{totals.rows}</b></span>
            {totals.materials > 0 && <span>Materials <b>{totals.materials}</b></span>}
          </div>
          {draftSaved && <div className="draft-state"><Icon name="check" /><span>Draft saved on this device</span></div>}
          <div className="spacer" />
          <button type="button" className="btn primary lg" onClick={submit} disabled={saving}>
            <Icon name="check" />{saving ? 'Saving…' : editingKey ? 'Save changes' : 'Submit report'}
          </button>
        </div>
      </div>
    </>
  );
}
