// Supabase-backed implementations of the DPR/Projects/Activities/Materials
// actions that app/api/proxy/route.js used to forward to the Google Apps
// Script backend (Code.gs). Login/user-management actions are NOT covered
// here — the `users` table hasn't been populated by the migration yet, so
// those actions still forward to Apps Script (see route.js's action sets).
//
// Every function here mirrors the exact request/response shape its Code.gs
// counterpart used, so index.html's apiFetch/apiPost call sites don't need
// to change at all — only what's behind /api/proxy changed.

import { getSupabaseAdmin } from './supabaseClient';

// ── Action routing tables — consulted by route.js to decide Supabase vs
// Apps Script forwarding ──────────────────────────────────────────────
export const SUPABASE_GET_ACTIONS = new Set([
  '', 'getBootstrapData', 'getProjects', 'getActivities', 'getMaterials', 'getMaterialLogs'
]);

export const SUPABASE_POST_ACTIONS = new Set([
  'saveDPR', 'editDPR', 'delete', 'requestEditDPR', 'approveEditDPR',
  'addProject', 'updateProject', 'deleteProject',
  'addActivity', 'updateActivity', 'deleteActivity',
  'addMaterial', 'updateMaterial', 'deleteMaterial',
  'updateSortOrder', 'saveMaterialLog'
]);

// ── Small helpers ──────────────────────────────────────────────────────

// Only handles the shapes the frontend's <input type="date"> and JS Date
// serialization actually produce — not the Excel-serial/DD-MM-YYYY cases
// normDate() in Code.gs had to handle for raw Sheets cell values, which
// don't apply to a Postgres `date` column.
function normDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(s)) {
    const p = s.split(/[-/]/);
    return `${p[2]}-${String(p[1]).padStart(2, '0')}-${String(p[0]).padStart(2, '0')}`;
  }
  return s;
}

function toIsoOrNow(v) {
  if (!v) return new Date().toISOString();
  const t = Date.parse(v);
  return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
}

// Display-only reconstruction of the old Sheets "Last Updated" cell text
// (e.g. "Fri Jul 03 2026 18:40:19 ... (by editor)") — nothing in the
// frontend parses this field, it's just shown as-is.
function formatLastUpdated(record) {
  const base = record.updated_at ? new Date(record.updated_at).toString() : '';
  return record.edited_by ? `${base} (by ${record.edited_by})` : base;
}

function entryToActivity(e) {
  return {
    activity:      e.activity,
    main_activity: e.main_activity || e.activity,
    skilled:       Number(e.skilled) || 0,
    unskilled:     Number(e.unskilled) || 0,
    total:         (Number(e.skilled) || 0) + (Number(e.unskilled) || 0),
    note:          e.note || '',
    plannedQty:    Number(e.planned_qty) || 0
  };
}

// ── DPR RECORDS ──────────────────────────────────────────────────────

export async function getDprList() {
  const supabase = getSupabaseAdmin();
  const { data: records, error } = await supabase.from('dpr_records').select('*').order('report_date', { ascending: false });
  if (error) throw new Error(error.message);
  if (!records.length) return [];

  const { data: entries, error: entErr } = await supabase
    .from('dpr_manpower_entries').select('*').in('dpr_record_id', records.map(r => r.id));
  if (entErr) throw new Error(entErr.message);

  const byRecord = new Map();
  (entries || []).forEach(e => {
    if (!byRecord.has(e.dpr_record_id)) byRecord.set(e.dpr_record_id, []);
    byRecord.get(e.dpr_record_id).push(e);
  });

  return records.map(r => {
    const ents = byRecord.get(r.id) || [];
    return {
      date:               r.report_date,
      site:               r.site,
      by:                 r.prepared_by || '',
      activityDetails:    r.activity_details || '',
      total:              Number(r.total_manpower) || 0,
      lastUpdated:        formatLastUpdated(r),
      submittedAt:        r.submitted_at || '',
      editPermission:     r.edit_permission || '',
      requestedBy:        r.requested_by || '',
      editedBy:           r.edited_by || '',
      civilActivities:    ents.filter(e => (e.section || 'Civil') !== 'Interior').map(entryToActivity),
      interiorActivities: ents.filter(e => e.section === 'Interior').map(entryToActivity),
      siteCondition:      r.site_condition || '',
      materialsUsed:      [], // tracked via material_logs now, not a JSON blob on the record
      details: ents.map(e => ({
        section:    e.section || 'Civil',
        activity:   e.activity,
        skilled:    Number(e.skilled) || 0,
        unskilled:  Number(e.unskilled) || 0,
        total:      (Number(e.skilled) || 0) + (Number(e.unskilled) || 0),
        note:       e.note || '',
        preparedBy: r.prepared_by || '',
        plannedQty: Number(e.planned_qty) || 0
      }))
    };
  });
}

function buildManpowerEntryRows(dprRecordId, acts) {
  return acts
    .filter(a => a.main_activity || a.activity)
    .map(a => {
      const actName = (a.sub_activity && a.sub_activity.trim()) ? a.sub_activity : (a.main_activity || a.activity);
      return {
        dpr_record_id: dprRecordId,
        section:       a.section || 'Civil',
        main_activity: a.main_activity || null,
        activity:      String(actName),
        skilled:       Number(a.skilled) || 0,
        unskilled:     Number(a.unskilled) || 0,
        note:          a.note || '',
        planned_qty:   Number(a.plannedQty) || 0
      };
    });
}

function summarizeActivities(acts) {
  const activityDetails = [...new Set(acts.map(a => a.main_activity || a.activity).filter(Boolean))].join(' | ');
  const totalManpower = acts.reduce((sum, a) => sum + (Number(a.skilled) || 0) + (Number(a.unskilled) || 0), 0);
  return { activityDetails, totalManpower };
}

export async function saveDPR(body) {
  const supabase = getSupabaseAdmin();
  const d = normDate(body.date);
  const s = String(body.site || '').trim();
  if (!d || !s) return { error: 'Missing date or site' };

  const { data: existing, error: existErr } = await supabase
    .from('dpr_records').select('id').eq('report_date', d).eq('site', s).maybeSingle();
  if (existErr) return { error: existErr.message };
  if (existing) return { status: 'duplicate' };

  const acts = Array.isArray(body.activities) ? body.activities : [];
  const { activityDetails, totalManpower } = summarizeActivities(acts);

  const { data: rec, error: insErr } = await supabase.from('dpr_records').insert({
    report_date:      d,
    site:              s,
    prepared_by:       String(body.by || '').trim(),
    activity_details:  activityDetails,
    total_manpower:    totalManpower,
    submitted_at:      toIsoOrNow(body.submittedAt),
    edit_permission:   '',
    requested_by:      '',
    site_condition:    String(body.siteCondition || '')
  }).select('id').single();

  if (insErr) {
    if (insErr.code === '23505') return { status: 'duplicate' }; // race with the pre-check above — the unique constraint is the real guard
    return { error: insErr.message };
  }

  const entryRows = buildManpowerEntryRows(rec.id, acts);
  if (entryRows.length) {
    const { error: entErr } = await supabase.from('dpr_manpower_entries').insert(entryRows);
    if (entErr) return { error: entErr.message };
  }
  return { status: 'ok' };
}

export async function editDPR(body) {
  const supabase = getSupabaseAdmin();
  const d = normDate(body.date);
  const s = String(body.site || '').trim();
  if (!d || !s) return { error: 'Missing date or site' };

  const { data: existing, error: findErr } = await supabase
    .from('dpr_records').select('*').eq('report_date', d).eq('site', s).maybeSingle();
  if (findErr) return { error: findErr.message };
  if (!existing) return { error: 'Record not found' };

  const editedBy = String(body.editedBy || '').trim();
  const prepBy   = String(body.by || '').trim();
  const acts     = Array.isArray(body.activities) ? body.activities : [];
  const { activityDetails, totalManpower } = summarizeActivities(acts);

  const { error: updErr } = await supabase.from('dpr_records').update({
    prepared_by:      prepBy || existing.prepared_by,
    activity_details: activityDetails,
    total_manpower:   totalManpower,
    edited_by:        editedBy || existing.edited_by,
    submitted_at:     body.submittedAt ? toIsoOrNow(body.submittedAt) : existing.submitted_at,
    edit_permission:  '',
    site_condition:   body.siteCondition || existing.site_condition || ''
  }).eq('id', existing.id);
  if (updErr) return { error: updErr.message };

  const { error: delErr } = await supabase.from('dpr_manpower_entries').delete().eq('dpr_record_id', existing.id);
  if (delErr) return { error: delErr.message };

  const entryRows = buildManpowerEntryRows(existing.id, acts);
  if (entryRows.length) {
    const { error: entErr } = await supabase.from('dpr_manpower_entries').insert(entryRows);
    if (entErr) return { error: entErr.message };
  }
  return { status: 'ok' };
}

export async function deleteDPR(body) {
  const supabase = getSupabaseAdmin();
  const parts = String(body.id || '').split('||');
  const d = parts[0];
  const s = parts.slice(1).join('||');
  // dpr_manpower_entries cascade-deletes via its FK's ON DELETE CASCADE
  const { error } = await supabase.from('dpr_records').delete().eq('report_date', d).eq('site', s);
  if (error) return { error: error.message };
  return { status: 'ok' };
}

export async function requestEditDPR(body) {
  const supabase = getSupabaseAdmin();
  const parts = String(body.key || '').split('||');
  const d = parts[0], s = parts.slice(1).join('||');
  const { error, count } = await supabase
    .from('dpr_records')
    .update({ edit_permission: 'pending', requested_by: body.requestedBy || '' }, { count: 'exact' })
    .eq('report_date', d).eq('site', s);
  if (error) return { error: error.message };
  if (!count) return { error: 'Not found' };
  return { status: 'ok' };
}

export async function approveEditDPR(body) {
  const supabase = getSupabaseAdmin();
  const parts = String(body.key || '').split('||');
  const d = parts[0], s = parts.slice(1).join('||');
  const { error, count } = await supabase
    .from('dpr_records')
    .update({ edit_permission: 'granted' }, { count: 'exact' })
    .eq('report_date', d).eq('site', s);
  if (error) return { error: error.message };
  if (!count) return { error: 'Not found' };
  return { status: 'ok' };
}

// ── PROJECTS ─────────────────────────────────────────────────────────

export async function getProjects() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('projects').select('*').order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return data.map(p => ({
    id:           p.id,
    project_name: p.sub_project_name || p.main_project_name,
    parent_id:    p.parent_id || '',
    status:       p.status || 'active',
    sort_order:   p.sort_order ?? 9999
  }));
}

export async function addProject(body) {
  const supabase = getSupabaseAdmin();
  const isSub = !!(body.parent_id && String(body.parent_id).trim() !== '');
  const { data: maxRow } = await supabase.from('projects').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();
  const nextSort = (maxRow?.sort_order ?? 0) + 1;
  const { data, error } = await supabase.from('projects').insert({
    main_project_name: isSub ? null : (body.project_name || body.main_project_name || null),
    sub_project_name:  isSub ? (body.project_name || body.sub_project_name || null) : null,
    parent_id:         isSub ? Number(body.parent_id) : null,
    status:            'active',
    sort_order:        nextSort
  }).select('id').single();
  if (error) return { error: error.message };
  return { status: 'ok', id: data.id };
}

export async function updateProject(body) {
  const supabase = getSupabaseAdmin();
  const { data: existing, error: findErr } = await supabase.from('projects').select('*').eq('id', body.id).maybeSingle();
  if (findErr) return { error: findErr.message };
  if (!existing) return { error: 'Not found' };
  const isSub = !!existing.parent_id;
  const patch = {};
  if (body.project_name) { if (isSub) patch.sub_project_name = body.project_name; else patch.main_project_name = body.project_name; }
  if (body.main_project_name !== undefined) patch.main_project_name = body.main_project_name;
  if (body.sub_project_name  !== undefined) patch.sub_project_name  = body.sub_project_name;
  if (body.parent_id         !== undefined) patch.parent_id = body.parent_id ? Number(body.parent_id) : null;
  if (body.status            !== undefined) patch.status = body.status;
  const { error } = await supabase.from('projects').update(patch).eq('id', body.id);
  if (error) return { error: error.message };
  return { status: 'ok' };
}

export async function deleteProject(body) {
  const supabase = getSupabaseAdmin();
  const id = Number(body.id);
  const { error } = await supabase.from('projects').delete().or(`id.eq.${id},parent_id.eq.${id}`);
  if (error) return { error: error.message };
  return { status: 'ok' };
}

// ── ACTIVITIES ───────────────────────────────────────────────────────

export async function getActivities() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('activities').select('*').order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return data.map(a => ({
    id:            a.id,
    activity_name: a.sub_category_name || a.main_category_name,
    parent_id:     a.parent_id || '',
    status:        a.status || 'active',
    sort_order:    a.sort_order ?? 9999
  }));
}

export async function addActivity(body) {
  const supabase = getSupabaseAdmin();
  const parentId     = body.parent_id || '';
  const activityName = body.activity_name || '';
  const { data: maxRow } = await supabase.from('activities').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();
  const nextSort = (maxRow?.sort_order ?? 0) + 1;
  const { data, error } = await supabase.from('activities').insert({
    main_category_name: body.main_category_name || (parentId === '' ? activityName : null) || null,
    sub_category_name:  body.sub_category_name  || (parentId !== '' ? activityName : null) || null,
    parent_id:           parentId ? Number(parentId) : null,
    status:              'active',
    sort_order:          nextSort
  }).select('id').single();
  if (error) return { error: error.message };
  return { status: 'ok', id: data.id };
}

export async function updateActivity(body) {
  const supabase = getSupabaseAdmin();
  const { data: existing, error: findErr } = await supabase.from('activities').select('*').eq('id', body.id).maybeSingle();
  if (findErr) return { error: findErr.message };
  if (!existing) return { error: 'Not found' };
  const isSub = !!existing.parent_id;
  const patch = {};
  if (body.activity_name) { if (isSub) patch.sub_category_name = body.activity_name; else patch.main_category_name = body.activity_name; }
  if (body.status !== undefined) patch.status = body.status;
  const { error } = await supabase.from('activities').update(patch).eq('id', body.id);
  if (error) return { error: error.message };
  return { status: 'ok' };
}

export async function deleteActivity(body) {
  const supabase = getSupabaseAdmin();
  const id = Number(body.id);
  const { error } = await supabase.from('activities').delete().or(`id.eq.${id},parent_id.eq.${id}`);
  if (error) return { error: error.message };
  return { status: 'ok' };
}

// ── MATERIALS ────────────────────────────────────────────────────────

export async function getMaterials() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('materials').select('*').order('material_name', { ascending: true });
  if (error) throw new Error(error.message);
  return data.map(m => ({
    id:            m.id,
    material_name: m.material_name,
    unit:          m.unit || '',
    budget_qty:    Number(m.budget_qty) || 0,
    status:        m.status || 'active'
  }));
}

export async function addMaterial(body) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('materials').insert({
    material_name: body.material_name || '',
    unit:          body.unit || null,
    budget_qty:    Number(body.budget_qty) || 0,
    status:        'active'
  }).select('id').single();
  if (error) return { error: error.message };
  return { status: 'ok', id: data.id };
}

export async function updateMaterial(body) {
  const supabase = getSupabaseAdmin();
  const patch = {};
  if (body.material_name !== undefined) patch.material_name = body.material_name;
  if (body.unit          !== undefined) patch.unit = body.unit;
  if (body.budget_qty    !== undefined) patch.budget_qty = Number(body.budget_qty) || 0;
  if (body.status        !== undefined) patch.status = body.status;
  const { error, count } = await supabase.from('materials').update(patch, { count: 'exact' }).eq('id', body.id);
  if (error) return { error: error.message };
  if (!count) return { error: 'Not found' };
  return { status: 'ok' };
}

export async function deleteMaterial(body) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from('materials').delete().eq('id', Number(body.id));
  if (error) return { error: error.message };
  return { status: 'ok' };
}

// ── MATERIAL LOGS ────────────────────────────────────────────────────

export async function getMaterialLogs() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('material_logs').select('*').order('log_date', { ascending: false });
  if (error) throw new Error(error.message);
  return data.map(l => ({
    date:          l.log_date,
    site:          l.site,
    material_name: l.material_name,
    qty:           Number(l.quantity) || 0,
    unit:          l.unit || '',
    loggedBy:      l.logged_by || '',
    createdAt:     l.created_at || ''
  }));
}

export async function saveMaterialLog(body) {
  const supabase = getSupabaseAdmin();
  const d = normDate(body.date);
  const s = String(body.site || '').trim();
  if (!d || !s) return { error: 'Missing date or site' };

  const items = Array.isArray(body.materialsUsed) ? body.materialsUsed : [];
  const clean = items
    .map(it => ({ name: String(it.material_name || it.name || '').trim(), qty: Number(it.qty) || 0 }))
    .filter(it => it.name && it.qty > 0);
  if (!clean.length) return { error: 'No valid material rows' };

  const [{ data: mats }, { data: recRow }] = await Promise.all([
    supabase.from('materials').select('id, material_name, unit'),
    supabase.from('dpr_records').select('id').eq('report_date', d).eq('site', s).maybeSingle()
  ]);
  const byName = new Map((mats || []).map(m => [String(m.material_name || '').trim().toLowerCase(), m]));
  const loggedBy = String(body.by || body.editedBy || '').trim();

  const rows = clean.map(it => {
    const m = byName.get(it.name.toLowerCase());
    return {
      log_date:      d,
      site:          s,
      dpr_record_id: recRow ? recRow.id : null,
      material_id:   m ? m.id : null,
      material_name: it.name,
      quantity:      it.qty,
      unit:          m ? (m.unit || null) : null,
      logged_by:     loggedBy
    };
  });
  const { error } = await supabase.from('material_logs').insert(rows);
  if (error) return { error: error.message };
  return { status: 'ok', inserted: rows.length };
}

// ── SORT ORDER ───────────────────────────────────────────────────────
// Postgres gives us real indexed per-row UPDATEs, so — unlike the Sheets
// version, which had to read/rewrite an entire column in one batch to
// avoid N slow Sheets API round-trips — a plain loop of small UPDATEs is
// fine here: this isn't a hot path, and each one is a cheap, correct,
// independently-committed write.

export async function updateSortOrder(body) {
  const supabase = getSupabaseAdmin();
  const { type, orderedIds } = body;
  if (!orderedIds || !Array.isArray(orderedIds) || !orderedIds.length) {
    return { error: 'Missing or invalid orderedIds' };
  }
  const table = type === 'projects' ? 'projects' : type === 'activities' ? 'activities' : null;
  if (!table) return { error: 'Invalid type: ' + type };

  const unmatched = [];
  for (let i = 0; i < orderedIds.length; i++) {
    const id = Number(orderedIds[i]);
    if (!Number.isFinite(id)) { unmatched.push(orderedIds[i]); continue; }
    const { error, count } = await supabase.from(table).update({ sort_order: i + 1 }, { count: 'exact' }).eq('id', id);
    if (error) return { error: error.message };
    if (!count) unmatched.push(orderedIds[i]);
  }
  return { success: true, message: 'Sort order committed successfully', type, count: orderedIds.length, unmatched };
}

// ── BOOTSTRAP ────────────────────────────────────────────────────────
// Supabase reads are fast (indexed Postgres queries, not an Apps Script
// cold start), so there's no need to replicate Code.gs's dataVersion
// short-circuit here — this always computes a fresh payload. `dataVersion`
// stays in the response shape purely so the frontend's existing caching
// code doesn't need to change; it just always sees "changed".
const BOOTSTRAP_RECENT_WINDOW_DAYS = 45;

export async function getSupabaseBootstrap() {
  const [projects, activities, materials, dprs, materialLogs] = await Promise.all([
    getProjects(), getActivities(), getMaterials(), getDprList(), getMaterialLogs()
  ]);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - BOOTSTRAP_RECENT_WINDOW_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return {
    dataVersion: String(Date.now()),
    projects,
    activities,
    materials,
    recentDprs:         dprs.filter(d => d.date >= cutoffStr),
    recentMaterialLogs: materialLogs.filter(l => l.date >= cutoffStr)
    // `users` is intentionally absent — route.js merges it in from the
    // Apps Script forward, since Users hasn't been migrated to Supabase.
  };
}

// ── DISPATCH ─────────────────────────────────────────────────────────

export async function runSupabaseGetAction(action) {
  switch (action) {
    case '':                 return getDprList();
    case 'getBootstrapData':  return getSupabaseBootstrap();
    case 'getProjects':      return getProjects();
    case 'getActivities':    return getActivities();
    case 'getMaterials':     return getMaterials();
    case 'getMaterialLogs':  return getMaterialLogs();
    default:
      throw new Error(`runSupabaseGetAction: unhandled action "${action}"`);
  }
}

export async function runSupabasePostAction(action, body) {
  switch (action) {
    case 'saveDPR':          return saveDPR(body);
    case 'editDPR':          return editDPR(body);
    case 'delete':           return deleteDPR(body);
    case 'requestEditDPR':   return requestEditDPR(body);
    case 'approveEditDPR':   return approveEditDPR(body);
    case 'addProject':       return addProject(body);
    case 'updateProject':    return updateProject(body);
    case 'deleteProject':    return deleteProject(body);
    case 'addActivity':      return addActivity(body);
    case 'updateActivity':   return updateActivity(body);
    case 'deleteActivity':   return deleteActivity(body);
    case 'addMaterial':      return addMaterial(body);
    case 'updateMaterial':   return updateMaterial(body);
    case 'deleteMaterial':   return deleteMaterial(body);
    case 'updateSortOrder':  return updateSortOrder(body);
    case 'saveMaterialLog':  return saveMaterialLog(body);
    default:
      throw new Error(`runSupabasePostAction: unhandled action "${action}"`);
  }
}
