#!/usr/bin/env node
/**
 * One-off ETL: pulls every row out of the live Google Sheets backend (via
 * the already-deployed Apps Script web app's JSON endpoints — no separate
 * Google Sheets API credentials needed) and seeds it into Supabase. Safe to
 * re-run: projects/activities/materials/users/dpr_records upsert on their
 * natural key, and each dpr_record's manpower entries are fully replaced
 * (delete-then-insert) rather than duplicated.
 *
 * Run once against supabase/schema.sql before using this script.
 *
 * Required env vars (read from .env.local automatically, or export them
 * in the shell):
 *   GOOGLE_SCRIPT_URL          — the deployed Apps Script web app /exec URL
 *   NEXT_PUBLIC_SUPABASE_URL   — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — service-role key (bypasses RLS for the
 *                                bulk seed; never expose this to a browser)
 *
 * Optional:
 *   MIGRATION_EXPORT_SECRET    — required only to migrate user accounts.
 *                                Must match the Script Property of the
 *                                same name (Apps Script editor → Project
 *                                Settings → Script Properties) that gates
 *                                Code.gs's handleExportUsersForMigration.
 *                                Without it, user accounts are skipped —
 *                                everything else still migrates.
 *
 * Usage:
 *   node scripts/migrate-sheets-to-supabase.js
 */

loadDotEnvLocal();

const { createClient } = require('@supabase/supabase-js');

const GOOGLE_SCRIPT_URL         = process.env.GOOGLE_SCRIPT_URL;
const MIGRATION_EXPORT_SECRET   = process.env.MIGRATION_EXPORT_SECRET || '';
const SUPABASE_URL              = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BATCH_SIZE = 500;

function requireEnv(name, value) {
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
}
requireEnv('GOOGLE_SCRIPT_URL', GOOGLE_SCRIPT_URL);
requireEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL);
requireEnv('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function fetchJson(params) {
  const qs  = new URLSearchParams(params || {}).toString();
  const url = qs ? `${GOOGLE_SCRIPT_URL}?${qs}` : GOOGLE_SCRIPT_URL;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  const data = await res.json();
  if (data && data.error) throw new Error(`GET ${url}: ${data.error}`);
  return data;
}

async function upsertInBatches(table, rows, onConflict) {
  if (!rows.length) { console.log(`  ${table}: nothing to migrate`); return; }
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
  console.log(`  ${table}: migrated ${rows.length} row(s)`);
}

// The Sheets source isn't perfectly clean — a stray row with a blank/
// non-numeric id has shown up in practice. Rather than crash the whole
// migration on one bad row, skip it (with a loud warning naming the row)
// and keep going; a NaN id would otherwise serialize to JSON null and trip
// the table's not-null constraint.
function withValidId(rows, table) {
  const valid = [];
  rows.forEach((r, i) => {
    if (Number.isFinite(r.id)) { valid.push(r); return; }
    console.warn(`  ${table}: skipping row ${i} with invalid id — ${JSON.stringify(r)}`);
  });
  return valid;
}

// ── PROJECTS / ACTIVITIES ──────────────────────────────────────────
// The public getProjects/getActivities endpoints return an already-
// flattened { id, project_name/activity_name, parent_id, status,
// sort_order } shape. Re-derive which physical column (main vs sub) each
// name belongs to using the exact same rule Code.gs itself uses when
// writing new rows: no parent_id => a top-level/"main" row, a parent_id
// present => a "sub" row. This is a lossless round-trip, not a guess.

function toIdOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function migrateProjects() {
  const projects = await fetchJson({ action: 'getProjects' });
  if (!projects.length) { console.log('  projects: nothing to migrate'); return; }

  // The live Projects sheet has been observed with every row sharing the
  // same non-numeric id ("p1") — a data-entry bug in the source sheet
  // (Code.gs's own handleUpdateProject/handleDeleteProject match rows by
  // this same id, so it's already ambiguous there too, not just here).
  // Only take the fast id-preserving path when ids are actually usable:
  // every one numeric AND unique.
  const numericIds = projects.map(p => Number(p.id));
  const idsUsable = numericIds.every(Number.isFinite) && new Set(numericIds).size === projects.length;

  if (idsUsable) {
    const rows = withValidId(projects.map(p => ({
      id:                Number(p.id),
      main_project_name: p.parent_id ? null : (p.project_name || null),
      sub_project_name:  p.parent_id ? (p.project_name || null) : null,
      parent_id:         p.parent_id ? toIdOrNull(p.parent_id) : null,
      status:            p.status || 'active',
      sort_order:        Number(p.sort_order) || 0
    })), 'projects');
    await upsertInBatches('projects', rows, 'id');
    return;
  }

  console.warn('  projects: source ids are non-numeric and/or duplicated across rows (e.g. every row sharing "p1") — this is a data bug in the live Projects sheet, not something safely fixable here. Falling back to Supabase-assigned ids.');

  // NOT idempotent (no explicit id to upsert on) — only run this path
  // against an empty projects table. Bail out loudly rather than risk
  // silently duplicating rows on a second run.
  const { count: existing, error: countErr } = await supabase.from('projects').select('id', { count: 'exact', head: true });
  if (countErr) throw new Error(`projects existence check failed: ${countErr.message}`);
  if (existing > 0) {
    console.warn(`  projects: table already has ${existing} row(s) and the fallback path can't upsert — skipping to avoid duplicates. Truncate the table first if you want to re-run this.`);
    return;
  }

  const topLevel = projects.filter(p => !p.parent_id);
  const children  = projects.filter(p => p.parent_id);
  // Children's (broken) parent_id can only be resolved unambiguously when
  // there's exactly one top-level project for them to belong to. With more
  // than one, guessing which parent each child meant would be worse than
  // leaving them all top-level for you to re-parent by hand in Supabase.
  const singleParent = topLevel.length === 1;

  const topRows = topLevel.map(p => ({
    main_project_name: p.project_name || null,
    sub_project_name:  null,
    parent_id:         null,
    status:            p.status || 'active',
    sort_order:        Number(p.sort_order) || 0
  }));
  let newParentId = null;
  if (topRows.length) {
    const { data, error } = await supabase.from('projects').insert(topRows).select('id');
    if (error) throw new Error(`projects insert (top-level) failed: ${error.message}`);
    if (singleParent) newParentId = data[0].id;
  }

  const childRows = children.map(p => ({
    main_project_name: null,
    sub_project_name:  p.project_name || null,
    parent_id:         singleParent ? newParentId : null,
    status:            p.status || 'active',
    sort_order:        Number(p.sort_order) || 0
  }));
  if (childRows.length) {
    const { error } = await supabase.from('projects').insert(childRows);
    if (error) throw new Error(`projects insert (children) failed: ${error.message}`);
  }

  if (!singleParent && children.length) {
    console.warn(`  projects: ${children.length} child row(s) inserted as top-level (${topLevel.length} top-level projects found, so their real parent couldn't be determined) — re-parent them manually in Supabase.`);
  }
  console.log(`  projects: migrated ${topRows.length + childRows.length} row(s) via the fallback id-assignment path`);
}

async function migrateActivities() {
  const activities = await fetchJson({ action: 'getActivities' });
  // A parent_id pointing at an id that no longer exists in the source
  // (the parent was deleted from the sheet but its children's parent_id
  // wasn't cleared) would otherwise trip the activities_parent_id_fkey
  // constraint. main_category_name/sub_category_name still reflect the
  // original parent_id (it's still semantically a "sub" activity), but
  // the FK column itself falls back to null — an unresolvable reference
  // can't be preserved, only dropped or guessed, and dropping is safer.
  const knownIds = new Set(activities.map(a => Number(a.id)).filter(Number.isFinite));
  const rows = withValidId(activities.map(a => {
    const parentId = a.parent_id ? toIdOrNull(a.parent_id) : null;
    const parentExists = parentId !== null && knownIds.has(parentId);
    if (parentId !== null && !parentExists) {
      console.warn(`  activities: id ${a.id} ("${a.activity_name}") references parent_id ${parentId}, which doesn't exist in the source — migrating it as top-level instead`);
    }
    return {
      id:                  Number(a.id),
      main_category_name:  a.parent_id ? null : (a.activity_name || null),
      sub_category_name:   a.parent_id ? (a.activity_name || null) : null,
      parent_id:           parentExists ? parentId : null,
      status:              a.status || 'active',
      sort_order:          Number(a.sort_order) || 0
    };
  }), 'activities');
  await upsertInBatches('activities', rows, 'id');
}

// ── MATERIALS ───────────────────────────────────────────────────────

async function migrateMaterials() {
  const materials = await fetchJson({ action: 'getMaterials' });
  const rows = withValidId(materials.map(m => ({
    id:            Number(m.id),
    material_name: m.material_name,
    unit:          m.unit || null,
    budget_qty:    Number(m.budget_qty) || 0,
    status:        m.status || 'active'
  })), 'materials');
  await upsertInBatches('materials', rows, 'id');

  const idByName = new Map();
  rows.forEach(r => idByName.set(String(r.material_name || '').trim().toLowerCase(), r.id));
  return idByName;
}

// ── USERS ─────────────────────────────────────────────────────────
// Requires MIGRATION_EXPORT_SECRET — see file header. Skipped (with a
// warning, not a hard failure) if it isn't set, so the rest of the
// migration can still run.

async function migrateUsers() {
  if (!MIGRATION_EXPORT_SECRET) {
    console.warn('  users: skipped — set MIGRATION_EXPORT_SECRET to migrate accounts (see script header comment)');
    return;
  }
  const users = await fetchJson({ action: 'exportUsersForMigration', secret: MIGRATION_EXPORT_SECRET });
  const rows = users.map(u => ({
    username:      u.username,
    display_name:  u.displayName || u.username,
    password_hash: u.passwordHash || '',
    role:          u.role || 'user'
  }));
  await upsertInBatches('users', rows, 'username');
}

// ── DPR_RECORDS + DPR_MANPOWER_ENTRIES ──────────────────────────────
// dpr_records upserts on (report_date, site) — its existing duplicate-DPR
// natural key — and deliberately never sends an `id` column, so a re-run
// updates the header fields in place without reassigning a fresh uuid
// (which would orphan any already-migrated manpower_entries/material_logs
// rows pointing at the old id). project_id is left NULL: resolving a
// historical site-name string to a project id isn't safe to guess (see
// supabase/schema.sql notes) and is left for a manual/future backfill.

function toIsoOrNull(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// dpr_records has a unique (report_date, site) constraint — the same
// natural key handleSaveDPR_ uses for its duplicate-DPR guard — but a
// single multi-row upsert statement errors ("ON CONFLICT DO UPDATE
// command cannot affect row a second time") if two rows in the SAME
// batch share that key. The live sheet has a handful of legacy
// duplicates predating that guard, so collapse to one row per key here,
// keeping the later occurrence (computeDPRList() sorts newest-date-first,
// so for a same-date collision the "later" array entry is whichever the
// sheet itself lists second — typically the more recently appended row).
function dedupeByDateSite(rows, label) {
  const byKey = new Map();
  rows.forEach(r => {
    const key = `${r.report_date}||${r.site}`;
    if (byKey.has(key)) console.warn(`  ${label}: duplicate (date, site) ${key} in the source — keeping the later entry`);
    byKey.set(key, r);
  });
  return Array.from(byKey.values());
}

async function migrateDprRecordsAndEntries() {
  const dprs = await fetchJson({});
  const headerRows = dedupeByDateSite(dprs.map(d => ({
    report_date:      d.date,
    site:             d.site,
    prepared_by:      d.by || '',
    activity_details: d.activityDetails || '',
    total_manpower:   Number(d.total) || 0,
    submitted_at:     toIsoOrNull(d.submittedAt),
    edit_permission:  d.editPermission || '',
    requested_by:     d.requestedBy || '',
    site_condition:   d.siteCondition || ''
  })), 'dpr_records');

  const recordIdByKey = new Map();
  for (let i = 0; i < headerRows.length; i += BATCH_SIZE) {
    const batch = headerRows.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from('dpr_records')
      .upsert(batch, { onConflict: 'report_date,site' })
      .select('id, report_date, site');
    if (error) throw new Error(`dpr_records upsert failed: ${error.message}`);
    data.forEach(r => recordIdByKey.set(`${r.report_date}||${r.site}`, r.id));
  }
  console.log(`  dpr_records: migrated ${headerRows.length} row(s)`);

  // Manpower line items — replace-in-full per record, matching how the
  // Sheets backend itself treats DPR_Detail rows on every edit
  // (deleteDetailRowsByKey then reinsert).
  let entryCount = 0;
  for (const d of dprs) {
    const recordId = recordIdByKey.get(`${d.date}||${d.site}`);
    if (!recordId) continue;

    // Mirrors the frontend's own poolRecordActivities(): civilActivities/
    // interiorActivities are preferred because they carry main_activity
    // (e.g. "Rcc" for "Rcc ↳ Formwork") — the field the report groups by —
    // which the flatter DPR_Detail-derived `details` array never had.
    // `details` is only a fallback for the (presumably rare/legacy) case
    // where both are empty, and its entries end up with no main_activity.
    const civilArr    = Array.isArray(d.civilActivities)    ? d.civilActivities    : [];
    const interiorArr = Array.isArray(d.interiorActivities) ? d.interiorActivities : [];
    const source = (civilArr.length || interiorArr.length)
      ? [...civilArr.map(a => ({ ...a, section: 'Civil' })), ...interiorArr.map(a => ({ ...a, section: 'Interior' }))]
      : (Array.isArray(d.details) ? d.details : []);
    const items = source.filter(a => (Number(a.skilled) || 0) > 0 || (Number(a.unskilled) || 0) > 0);

    const { error: delErr } = await supabase.from('dpr_manpower_entries').delete().eq('dpr_record_id', recordId);
    if (delErr) throw new Error(`dpr_manpower_entries delete failed for ${d.date}||${d.site}: ${delErr.message}`);
    if (!items.length) continue;

    const entryRows = items.map(a => ({
      dpr_record_id: recordId,
      section:       a.section || 'Civil',
      main_activity: a.main_activity || null,
      activity:      a.activity || a.main_activity || '',
      skilled:       Number(a.skilled) || 0,
      unskilled:     Number(a.unskilled) || 0,
      note:          a.note || '',
      planned_qty:   Number(a.plannedQty) || 0
    }));
    const { error: insErr } = await supabase.from('dpr_manpower_entries').insert(entryRows);
    if (insErr) throw new Error(`dpr_manpower_entries insert failed for ${d.date}||${d.site}: ${insErr.message}`);
    entryCount += entryRows.length;
  }
  console.log(`  dpr_manpower_entries: migrated ${entryCount} row(s)`);

  return recordIdByKey;
}

// ── MATERIAL_LOGS ────────────────────────────────────────────────────
// The source Material_Logs sheet has no natural unique key per row, so
// this is a plain insert rather than an upsert — run this once against an
// empty material_logs table (or truncate it first) to avoid duplicating
// rows on a re-run.

async function migrateMaterialLogs(recordIdByKey, materialIdByName) {
  const logs = await fetchJson({ action: 'getMaterialLogs' });
  const rows = logs.map(l => ({
    log_date:      l.date,
    site:          l.site,
    dpr_record_id: recordIdByKey.get(`${l.date}||${l.site}`) || null,
    material_id:   materialIdByName.get(String(l.material_name || '').trim().toLowerCase()) || null,
    material_name: l.material_name,
    quantity:      Number(l.qty) || 0,
    unit:          l.unit || null,
    logged_by:     l.loggedBy || '',
    created_at:    toIsoOrNull(l.createdAt) || new Date(`${l.date}T00:00:00Z`).toISOString()
  }));

  if (!rows.length) { console.log('  material_logs: nothing to migrate'); return; }
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const { error } = await supabase.from('material_logs').insert(rows.slice(i, i + BATCH_SIZE));
    if (error) throw new Error(`material_logs insert failed: ${error.message}`);
  }
  console.log(`  material_logs: migrated ${rows.length} row(s)`);
}

// ── .env.local loader (no dotenv dependency needed) ─────────────────

function loadDotEnvLocal() {
  const fs   = require('fs');
  const path = require('path');
  const envPath = path.resolve(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  });
}

// ── MAIN ─────────────────────────────────────────────────────────────

async function main() {
  console.log('Migrating Google Sheets -> Supabase...');
  await migrateProjects();
  await migrateActivities();
  const materialIdByName = await migrateMaterials();
  await migrateUsers();
  const recordIdByKey = await migrateDprRecordsAndEntries();
  await migrateMaterialLogs(recordIdByKey, materialIdByName);
  console.log('Done.');
  console.log('');
  console.log('IMPORTANT — one-time follow-up: projects/activities/materials.id are');
  console.log('"generated by default as identity" so this script could preserve the');
  console.log("exact Sheets ids, but that means each table's auto-increment sequence");
  console.log('has no idea those ids now exist. Run this once in the Supabase SQL');
  console.log('Editor before creating any NEW project/activity/material by hand:');
  console.log('');
  console.log("  select setval(pg_get_serial_sequence('projects','id'),   coalesce((select max(id) from projects),   1));");
  console.log("  select setval(pg_get_serial_sequence('activities','id'), coalesce((select max(id) from activities), 1));");
  console.log("  select setval(pg_get_serial_sequence('materials','id'),  coalesce((select max(id) from materials),  1));");
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
