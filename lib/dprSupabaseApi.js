// Supabase-backed implementations of the DPR/Projects/Activities/Materials
// actions that app/api/proxy/route.js used to forward to the Google Apps
// Script backend (Code.gs). Login/user-management actions are NOT covered
// here — the `users` table hasn't been populated by the migration yet, so
// those actions still forward to Apps Script (see route.js's action sets).
//
// Every function here mirrors the exact request/response shape its Code.gs
// counterpart used, so the client-side contract (lib/client/api.js →
// /api/proxy) stayed the same through the migration. Write actions
// take the signed-in `actor` (lib/session.js via route.js); authorship and
// edit permissions come from it, not from the request body.

import { randomUUID } from 'crypto';
import { getSupabaseAdmin } from './supabaseClient';
import { submissionAccess } from './materials/consumption';
import { inScope, scopeFor } from './sites';
import { USER_SITES_HINT, userSitesMissing } from './authSupabaseApi';

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
  'updateSortOrder', 'saveMaterialLog',
  'updateMaterialSubmission', 'deleteMaterialLog', 'requestMaterialLogChange', 'resolveMaterialLogRequest'
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

// ── Server-side identity & permissions ──────────────────────────────
// Same rules the UI shows (HistoryScreen editAction / AppContext canEdit),
// now enforced here: admins can edit any DPR; others only their own, within
// 15 minutes of submitting or once an admin has granted edit access.
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const sameUser = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const isAdmin = (actor) => !!actor && actor.role === 'admin';

// ── Site scope ───────────────────────────────────────────────────────
// Admins: null (every site). Supervisors: their user_sites assignments
// (lib/sites.js scopeFor) — they see and write only those sites' projects,
// DPRs and consumption entries. Read fresh on every request, so a changed
// assignment applies at once. Fails closed: if assignments can't be read,
// the request fails rather than showing every site.
export async function getSiteScope(actor) {
  if (isAdmin(actor)) return null;
  if (!actor || !actor.id) throw new Error('getSiteScope: no signed-in user id');
  const [{ data, error }, projects] = await Promise.all([
    getSupabaseAdmin().from('user_sites').select('project_id').eq('user_id', actor.id),
    getProjects(),
  ]);
  if (error) throw new Error(userSitesMissing(error) ? USER_SITES_HINT : error.message);
  return scopeFor(projects, (data || []).map(r => r.project_id));
}
const NOT_ASSIGNED = { error: 'You are not assigned to this site — ask an admin to add it to your account' };

export async function saveDPR(body, actor, scope) {
  const supabase = getSupabaseAdmin();
  const d = normDate(body.date);
  const s = String(body.site || '').trim();
  if (!d || !s) return { error: 'Missing date or site' };
  if (!inScope(scope, s)) return NOT_ASSIGNED;

  const { data: existing, error: existErr } = await supabase
    .from('dpr_records').select('id').eq('report_date', d).eq('site', s).maybeSingle();
  if (existErr) return { error: existErr.message };
  if (existing) return { status: 'duplicate' };

  const acts = Array.isArray(body.activities) ? body.activities : [];
  const { activityDetails, totalManpower } = summarizeActivities(acts);

  const { data: rec, error: insErr } = await supabase.from('dpr_records').insert({
    report_date:      d,
    site:              s,
    prepared_by:       actor.username, // the signed-in user, never the client's claim
    activity_details:  activityDetails,
    total_manpower:    totalManpower,
    submitted_at:      new Date().toISOString(), // server time: the edit window is measured from this
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

export async function editDPR(body, actor, scope) {
  const supabase = getSupabaseAdmin();
  const d = normDate(body.date);
  const s = String(body.site || '').trim();
  if (!d || !s) return { error: 'Missing date or site' };
  if (!inScope(scope, s)) return NOT_ASSIGNED;

  const { data: existing, error: findErr } = await supabase
    .from('dpr_records').select('*').eq('report_date', d).eq('site', s).maybeSingle();
  if (findErr) return { error: findErr.message };
  if (!existing) return { error: 'Record not found' };

  const own = sameUser(existing.prepared_by, actor.username);
  if (!isAdmin(actor)) {
    if (!own) return { error: 'You can only edit your own DPRs' };
    const submitted = Date.parse(existing.submitted_at || '') || 0;
    const withinWindow = submitted && (Date.now() - submitted) < EDIT_WINDOW_MS;
    if (!withinWindow && existing.edit_permission !== 'granted') return { error: 'Edit window expired — request edit permission first' };
  }
  // Preparer stays as-is; an edit by someone else records who edited it.
  const editedBy = own ? '' : actor.username;
  const prepBy   = '';
  const acts     = Array.isArray(body.activities) ? body.activities : [];
  const { activityDetails, totalManpower } = summarizeActivities(acts);

  const { error: updErr } = await supabase.from('dpr_records').update({
    prepared_by:      prepBy || existing.prepared_by,
    activity_details: activityDetails,
    total_manpower:   totalManpower,
    edited_by:        editedBy || existing.edited_by,
    submitted_at:     existing.submitted_at, // edits never move the original submission time (or the edit window)
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

export async function requestEditDPR(body, actor, scope) {
  const supabase = getSupabaseAdmin();
  const parts = String(body.key || '').split('||');
  const d = parts[0], s = parts.slice(1).join('||');
  if (!inScope(scope, s)) return NOT_ASSIGNED;
  const { data: rec, error: findErr } = await supabase.from('dpr_records').select('prepared_by').eq('report_date', d).eq('site', s).maybeSingle();
  if (findErr) return { error: findErr.message };
  if (!rec) return { error: 'Not found' };
  if (!sameUser(rec.prepared_by, actor.username) && !isAdmin(actor)) return { error: 'You can only request edits on your own DPRs' };
  const { error, count } = await supabase
    .from('dpr_records')
    .update({ edit_permission: 'pending', requested_by: actor.username }, { count: 'exact' })
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
  const { data, error } = await supabase.from('materials').select('id, material_name, unit, status').order('material_name', { ascending: true });
  if (error) throw new Error(error.message);
  return data.map(m => ({
    id:            m.id,
    material_name: m.material_name,
    unit:          m.unit || '',
    status:        m.status || 'active'
  }));
}

export async function addMaterial(body) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('materials').insert({
    material_name: body.material_name || '',
    unit:          body.unit || null,
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

// ── MATERIAL LOGS (consumption entries) ──────────────────────────────
// Each row: material, qty + unit, ownership (Trust/Contractor/Other),
// contractor, output / work done (qty + unit) and remarks. Only Trust rows
// count toward the Trust's material totals — that's computed client-side
// (lib/materials/consumption.js); the API stores and returns every row.

const OWNERSHIP = ['Trust', 'Contractor', 'Other'];
const normOwnership = (v) => OWNERSHIP.find(o => o.toLowerCase() === String(v || '').trim().toLowerCase()) || 'Trust';
const optText = (v) => { const s = String(v ?? '').trim(); return s || null; };
const optNum = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };

// Postgres "undefined column" — migrations/002_consumption_entries.sql not applied yet.
function consumptionColumnsMissing(error) {
  return error && (error.code === '42703' || error.code === 'PGRST204' || /ownership|output_qty|output_unit|remarks|contractor/.test(error.message || ''));
}
// migrations/005_material_log_batches.sql not applied yet.
const batchColumnsMissing = (error) => (error.code === '42703' || error.code === 'PGRST204') && /batch_/.test(error.message || '');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIGRATION_HINT = 'Database is missing the consumption-entry columns — apply supabase/migrations/002_consumption_entries.sql in the Supabase SQL editor.';

function cleanEntry(it) {
  return {
    name:       String(it.material_name || it.name || '').trim(),
    qty:        Number(it.qty) || 0,
    unit:       optText(it.unit),
    ownership:  normOwnership(it.ownership),
    contractor: optText(it.contractor),
    outputQty:  optNum(it.output_qty ?? it.outputQty),
    outputUnit: optText(it.output_unit ?? it.outputUnit),
    remarks:    optText(it.remarks)
  };
}

// Request state from the migration-004 columns: a grant wins over the
// request it answered; a request with no grant yet is pending.
function requestStatusOf(l) {
  if (l.edit_granted_to) return 'granted';
  if (l.edit_requested_by) return 'pending';
  return '';
}
const CLEARED_REQUEST = { edit_requested_by: null, edit_requested_at: null, edit_request_type: null, edit_granted_to: null, edit_granted_at: null };

export async function getMaterialLogs() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from('material_logs').select('*').order('log_date', { ascending: false });
  if (error) throw new Error(error.message);
  return data.map(l => ({
    id:            l.id,
    date:          l.log_date,
    site:          l.site,
    material_name: l.material_name,
    qty:           Number(l.quantity) || 0,
    unit:          l.unit || '',
    ownership:     normOwnership(l.ownership),
    contractor:    l.contractor || '',
    outputQty:     l.output_qty === null || l.output_qty === undefined ? null : Number(l.output_qty),
    outputUnit:    l.output_unit || '',
    remarks:       l.remarks || '',
    loggedBy:      l.logged_by || '',
    createdAt:     l.created_at || '',
    requestStatus: requestStatusOf(l),
    requestType:   l.edit_request_type || '',
    requestedBy:   l.edit_requested_by || '',
    requestedAt:   l.edit_requested_at || '',
    editedBy:      l.edited_by || '',
    editedAt:      l.edited_at || '',
    batchId:       l.batch_id || '',
    batchLine:     l.batch_line === null || l.batch_line === undefined ? null : Number(l.batch_line)
  }));
}

export async function saveMaterialLog(body, actor, scope) {
  const supabase = getSupabaseAdmin();
  const d = normDate(body.date);
  const s = String(body.site || '').trim();
  if (!d || !s) return { error: 'Missing date or site' };
  if (!inScope(scope, s)) return NOT_ASSIGNED;

  const items = Array.isArray(body.materialsUsed) ? body.materialsUsed : [];
  const clean = items.map(cleanEntry).filter(it => it.name && it.qty > 0);
  if (!clean.length) return { error: 'No valid material rows' };
  const noContractor = clean.find(it => it.ownership === 'Contractor' && !it.contractor);
  if (noContractor) return { error: `Contractor name is required for contractor-owned ${noContractor.name}` };

  const [{ data: mats }, { data: recRow }] = await Promise.all([
    supabase.from('materials').select('id, material_name, unit'),
    supabase.from('dpr_records').select('id').eq('report_date', d).eq('site', s).maybeSingle()
  ]);
  const byName = new Map((mats || []).map(m => [String(m.material_name || '').trim().toLowerCase(), m]));
  const loggedBy = actor.username;
  // One submission = one batch: every row saved here shares batch_id, so
  // the Material Consumption Report covers them together. The client may
  // send its own (an offline save reports under it before it syncs).
  const batchId = UUID_RE.test(String(body.batchId || '')) ? String(body.batchId) : randomUUID();

  const rows = clean.map((it, i) => {
    const m = byName.get(it.name.toLowerCase());
    return {
      log_date:      d,
      site:          s,
      dpr_record_id: recRow ? recRow.id : null,
      material_id:   m ? m.id : null,
      material_name: it.name,
      quantity:      it.qty,
      unit:          it.unit || (m ? (m.unit || null) : null),
      ownership:     it.ownership,
      contractor:    it.contractor,
      output_qty:    it.outputQty,
      output_unit:   it.outputQty === null ? null : it.outputUnit,
      remarks:       it.remarks,
      logged_by:     loggedBy,
      batch_id:      batchId,
      batch_line:    i
    };
  });
  // Return the new rows (in submission order) so the client can show the
  // report for exactly what was just saved, with its entry references.
  const insert = (rs) => supabase.from('material_logs').insert(rs).select('id, material_name, created_at');
  let { data: saved, error } = await insert(rows);
  let savedBatch = batchId;
  if (error && batchColumnsMissing(error)) {
    // migrations/005 not applied yet: save un-batched. The rows still share
    // created_at, which the client groups on (consumption.js batchKey()).
    ({ data: saved, error } = await insert(rows.map(({ batch_id, batch_line, ...r }) => r)));
    savedBatch = '';
  }
  if (error) return { error: consumptionColumnsMissing(error) ? MIGRATION_HINT : error.message };
  return { status: 'ok', inserted: rows.length, batchId: savedBatch, entries: (saved || []).map(r => ({ id: r.id, material_name: r.material_name, createdAt: r.created_at })) };
}

// ── Consumption entry edit / delete lifecycle ────────────────────────
// Who may do what is lib/materials/consumption.js submissionAccess():
// admins always; the logger directly for 24 h, then via an admin-approved
// request. Measured from each row's server-set created_at.

const REQUEST_HINT = 'Database is missing the edit-request columns — apply supabase/migrations/004_material_log_requests.sql in the Supabase SQL editor.';
const requestColumnsMissing = (error) => error && (error.code === '42703' || error.code === 'PGRST204' || /edit_request|edit_granted|edited_by|edited_at/.test(error.message || ''));
const writeError = (error) => ({ error: requestColumnsMissing(error) ? REQUEST_HINT : error.message });

// Every action here works on a whole submission (lib/materials/
// consumption.js groupSubmissions()): the client sends the ids of its rows
// and the server widens them to the full batch, so a stale page can never
// act on part of one.

const toAccessShape = (r) => ({
  loggedBy: r.logged_by, createdAt: r.created_at, requestStatus: requestStatusOf(r), requestType: r.edit_request_type || '',
});
const idsOf = (body) => (Array.isArray(body.ids) ? body.ids : [body.id]).map(x => String(x || '')).filter(Boolean);

async function findSubmission(body, scope) {
  const ids = idsOf(body);
  if (!ids.length) return { error: 'No consumption entry given' };
  const supabase = getSupabaseAdmin();
  const { data: picked, error } = await supabase.from('material_logs').select('*').in('id', ids);
  if (error) return { error: error.message };
  if (!picked || !picked.length) return { error: 'Consumption entry not found — it may have been deleted' };
  const batches = [...new Set(picked.map(r => r.batch_id || ''))];
  if (batches.length > 1) return { error: 'These entries belong to different submissions' };
  if (!picked.every(r => inScope(scope, r.site))) return NOT_ASSIGNED;
  let rows = picked;
  if (batches[0]) {
    const { data: all, error: e2 } = await supabase.from('material_logs').select('*').eq('batch_id', batches[0]);
    if (e2) return { error: e2.message };
    if (all && all.length) rows = all;
  }
  rows = rows.slice().sort((a, b) => (a.batch_line ?? 0) - (b.batch_line ?? 0));
  return { rows, batchId: batches[0] || null, access: (actor) => submissionAccess(rows.map(toAccessShape), actor) };
}

function deniedMsg(access, verb) {
  if (access === 'none') return `You can only ${verb} your own consumption entries`;
  if (access === 'pending') return 'A request for this submission is waiting for an admin';
  return `The 24-hour window has passed — request ${verb === 'edit' ? 'an edit' : 'deletion'} from an admin`;
}

// Edit one submission: body.entries in form order. An entry with an id
// updates that row, one without is added to the submission, and a row of
// body.ids left out is removed. Date, site and logger stay as logged.
export async function updateMaterialSubmission(body, actor, scope) {
  const found = await findSubmission(body, scope);
  if (found.error) return found;
  const access = found.access(actor).edit;
  if (access !== 'direct') return { error: deniedMsg(access, 'edit') };

  const items = (Array.isArray(body.entries) ? body.entries : []).map(e => ({ ...cleanEntry(e), id: e.id ? String(e.id) : '' }));
  const valid = items.filter(it => it.name && it.qty > 0);
  if (!valid.length) return { error: 'Keep at least one material — to remove the whole submission, delete it instead' };
  const noContractor = valid.find(it => it.ownership === 'Contractor' && !it.contractor);
  if (noContractor) return { error: `Contractor name is required for contractor-owned ${noContractor.name}` };

  const rows = found.rows;
  const byId = new Map(rows.map(r => [r.id, r]));
  if (valid.some(it => it.id && !byId.has(it.id))) return { error: 'This submission changed meanwhile — refresh and try again' };

  const supabase = getSupabaseAdmin();
  const { data: mats } = await supabase.from('materials').select('id, material_name, unit');
  const matOf = (name) => (mats || []).find(m => String(m.material_name || '').trim().toLowerCase() === name.toLowerCase());
  const first = rows[0];
  const now = new Date().toISOString();
  const editedBy = sameUser(first.logged_by, actor.username) ? ((rows.find(r => r.edited_by) || {}).edited_by || null) : actor.username;
  const fields = (it, i) => {
    const mat = matOf(it.name);
    return {
      material_id:   mat ? mat.id : null,
      material_name: it.name,
      quantity:      it.qty,
      unit:          it.unit || (mat ? (mat.unit || null) : null),
      ownership:     it.ownership,
      contractor:    it.contractor,
      output_qty:    it.outputQty,
      output_unit:   it.outputQty === null ? null : it.outputUnit,
      remarks:       it.remarks,
      edited_by:     editedBy,
      edited_at:     now,
      ...CLEARED_REQUEST, // an approved edit request is used up by the edit it allowed
      ...(found.batchId ? { batch_line: i } : {}),
    };
  };

  const kept = new Set(valid.filter(it => it.id).map(it => it.id));
  const listed = new Set(idsOf(body));
  const removed = rows.filter(r => listed.has(r.id) && !kept.has(r.id)).map(r => r.id);

  for (const [i, it] of valid.entries()) {
    if (!it.id) continue;
    const { error } = await supabase.from('material_logs').update(fields(it, i)).eq('id', it.id);
    if (error) return writeError(error);
  }
  const added = valid.map((it, i) => [it, i]).filter(([it]) => !it.id).map(([it, i]) => ({
    ...fields(it, i),
    log_date:      first.log_date,
    site:          first.site,
    dpr_record_id: first.dpr_record_id,
    logged_by:     first.logged_by,
    ...(found.batchId ? { batch_id: found.batchId } : {}),
  }));
  if (added.length) {
    const { error } = await supabase.from('material_logs').insert(added);
    if (error) return writeError(error);
  }
  if (removed.length) {
    const { error } = await supabase.from('material_logs').delete().in('id', removed);
    if (error) return { error: error.message };
  }
  return { status: 'ok' };
}

export async function deleteMaterialLog(body, actor, scope) {
  const found = await findSubmission(body, scope);
  if (found.error) return found;
  const access = found.access(actor).delete;
  if (access !== 'direct') return { error: deniedMsg(access, 'delete') };
  const { error } = await getSupabaseAdmin().from('material_logs').delete().in('id', found.rows.map(r => r.id));
  if (error) return { error: error.message };
  return { status: 'ok', deleted: found.rows.length };
}

export async function requestMaterialLogChange(body, actor, scope) {
  const type = body.type === 'delete' ? 'delete' : 'edit';
  const found = await findSubmission(body, scope);
  if (found.error) return found;
  const access = found.access(actor)[type];
  if (access === 'none') return { error: 'You can only request changes to your own consumption entries' };
  if (access === 'pending') return { error: 'A request for this submission is already waiting for an admin' };
  if (access === 'direct') return { error: `You can still ${type} this submission directly` };
  const { error } = await getSupabaseAdmin().from('material_logs').update({
    ...CLEARED_REQUEST, edit_request_type: type, edit_requested_by: actor.username, edit_requested_at: new Date().toISOString(),
  }).in('id', found.rows.map(r => r.id));
  if (error) return writeError(error);
  return { status: 'ok' };
}

// Admin only (ADMIN_POST_ACTIONS). Approve: an edit becomes 'granted' (the
// requester may edit the submission once); a delete removes the whole
// submission. Decline clears it.
export async function resolveMaterialLogRequest(body) {
  const found = await findSubmission(body);
  if (found.error) return found;
  const req = found.rows.find(r => requestStatusOf(r) === 'pending');
  if (!req) return { error: 'This request was already handled' };
  const ids = found.rows.map(r => r.id);
  const supabase = getSupabaseAdmin();
  if (body.approve && req.edit_request_type === 'delete') {
    const { error } = await supabase.from('material_logs').delete().in('id', ids);
    if (error) return { error: error.message };
    return { status: 'ok', result: 'deleted' };
  }
  const { error } = await supabase.from('material_logs')
    .update(body.approve
      ? { edit_request_type: 'edit', edit_requested_by: req.edit_requested_by, edit_requested_at: req.edit_requested_at, edit_granted_to: req.edit_requested_by, edit_granted_at: new Date().toISOString() }
      : CLEARED_REQUEST)
    .in('id', ids);
  if (error) return writeError(error);
  return { status: 'ok', result: body.approve ? 'granted' : 'declined' };
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

  // Read the current positions once and only write rows whose position
  // changed — a single ↑/↓ move touches ~2 rows instead of all of them.
  const { data: current, error: readErr } = await supabase.from(table).select('id, sort_order');
  if (readErr) return { error: readErr.message };
  const currentOrder = new Map((current || []).map(r => [Number(r.id), r.sort_order]));

  const unmatched = [];
  let updated = 0;
  for (let i = 0; i < orderedIds.length; i++) {
    const id = Number(orderedIds[i]);
    if (!Number.isFinite(id) || !currentOrder.has(id)) { unmatched.push(orderedIds[i]); continue; }
    if (currentOrder.get(id) === i + 1) continue;
    const { error } = await supabase.from(table).update({ sort_order: i + 1 }).eq('id', id);
    if (error) return { error: error.message };
    updated += 1;
  }
  return { success: true, message: 'Sort order committed successfully', type, count: orderedIds.length, updated, unmatched };
}

// ── BOOTSTRAP ────────────────────────────────────────────────────────
// Supabase reads are fast (indexed Postgres queries, not an Apps Script
// cold start), so there's no need to replicate Code.gs's dataVersion
// short-circuit here — this always computes a fresh payload. `dataVersion`
// stays in the response shape purely so the frontend's existing caching
// code doesn't need to change; it just always sees "changed".
const BOOTSTRAP_RECENT_WINDOW_DAYS = 45;

// allSettled, not all: one failing table shouldn't blank the whole app.
// A field whose query failed is simply omitted — the client (AppContext
// reloadMaster) keeps its previous list for any field that isn't an array. Only when EVERY query fails (Supabase unreachable) does
// this throw, so the client keeps its IndexedDB cache instead.
export async function getSupabaseBootstrap(scope = null) {
  const parts = {
    projects:     scope ? Promise.resolve(scope.projects) : getProjects(),
    activities:   getActivities(),
    materials:    getMaterials(),
    dprs:         getDprList(),
    materialLogs: getMaterialLogs()
  };
  const names = Object.keys(parts);
  const settled = await Promise.allSettled(Object.values(parts));

  const ok = {};
  const failed = {};
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') ok[names[i]] = r.value;
    else failed[names[i]] = r.reason?.message || String(r.reason);
  });
  if (!Object.keys(ok).length) {
    throw new Error(`Supabase bootstrap failed: ${settled[0].reason?.message || settled[0].reason}`);
  }
  if (Object.keys(failed).length) {
    console.error('Supabase bootstrap partially failed:', failed);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - BOOTSTRAP_RECENT_WINDOW_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const payload = { dataVersion: String(Date.now()) };
  if (ok.projects)     payload.projects   = ok.projects;
  if (ok.activities)   payload.activities = ok.activities;
  if (ok.materials)    payload.materials  = ok.materials;
  if (ok.dprs)         payload.recentDprs = ok.dprs.filter(d => d.date >= cutoffStr && inScope(scope, d.site));
  if (ok.materialLogs) payload.recentMaterialLogs = ok.materialLogs.filter(l => l.date >= cutoffStr && inScope(scope, l.site));
  if (Object.keys(failed).length) payload.partialErrors = failed;
  // `users` is intentionally absent — route.js merges it in from the
  // Apps Script forward, since Users hasn't been migrated to Supabase.
  return payload;
}

// ── DISPATCH ─────────────────────────────────────────────────────────

// Every read is scoped to the actor's sites (null scope = admin, all).
export async function runSupabaseGetAction(action, actor) {
  const scope = await getSiteScope(actor);
  const scoped = (rows) => (scope ? rows.filter(r => inScope(scope, r.site)) : rows);
  switch (action) {
    case '':                 return scoped(await getDprList());
    case 'getBootstrapData':  return getSupabaseBootstrap(scope);
    case 'getProjects':      return scope ? scope.projects : getProjects();
    case 'getActivities':    return getActivities();
    case 'getMaterials':     return getMaterials();
    case 'getMaterialLogs':  return scoped(await getMaterialLogs());
    default:
      throw new Error(`runSupabaseGetAction: unhandled action "${action}"`);
  }
}

// Actions only an admin may perform (enforced in route.js before dispatch).
export const ADMIN_POST_ACTIONS = new Set([
  'delete', 'approveEditDPR',
  'addProject', 'updateProject', 'deleteProject',
  'addActivity', 'updateActivity', 'deleteActivity',
  'addMaterial', 'updateMaterial', 'deleteMaterial',
  'updateSortOrder', 'resolveMaterialLogRequest'
]);

export async function runSupabasePostAction(action, body, actor) {
  if (!actor) throw new Error('runSupabasePostAction: no signed-in user');
  const scope = ADMIN_POST_ACTIONS.has(action) ? null : await getSiteScope(actor);
  switch (action) {
    case 'saveDPR':          return saveDPR(body, actor, scope);
    case 'editDPR':          return editDPR(body, actor, scope);
    case 'delete':           return deleteDPR(body);
    case 'requestEditDPR':   return requestEditDPR(body, actor, scope);
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
    case 'saveMaterialLog':  return saveMaterialLog(body, actor, scope);
    case 'updateMaterialSubmission':         return updateMaterialSubmission(body, actor, scope);
    case 'deleteMaterialLog':         return deleteMaterialLog(body, actor, scope);
    case 'requestMaterialLogChange':  return requestMaterialLogChange(body, actor, scope);
    case 'resolveMaterialLogRequest': return resolveMaterialLogRequest(body);
    default:
      throw new Error(`runSupabasePostAction: unhandled action "${action}"`);
  }
}
