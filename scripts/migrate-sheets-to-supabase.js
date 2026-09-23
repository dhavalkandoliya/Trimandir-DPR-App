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

// ── PROJECTS / ACTIVITIES ──────────────────────────────────────────
// The public getProjects/getActivities endpoints return an already-
// flattened { id, project_name/activity_name, parent_id, status,
// sort_order } shape. Re-derive which physical column (main vs sub) each
// name belongs to using the exact same rule Code.gs itself uses when
// writing new rows: no parent_id => a top-level/"main" row, a parent_id
// present => a "sub" row. This is a lossless round-trip, not a guess.

async function migrateProjects() {
  const projects = await fetchJson({ action: 'getProjects' });
  const rows = projects.map(p => ({
    id:                Number(p.id),
    main_project_name: p.parent_id ? null : (p.project_name || null),
    sub_project_name:  p.parent_id ? (p.project_name || null) : null,
    parent_id:         p.parent_id ? Number(p.parent_id) : null,
    status:            p.status || 'active',
    sort_order:        Number(p.sort_order) || 0
  }));
  await upsertInBatches('projects', rows, 'id');
}

async function migrateActivities() {
  const activities = await fetchJson({ action: 'getActivities' });
  const rows = activities.map(a => ({
    id:                  Number(a.id),
    main_category_name:  a.parent_id ? null : (a.activity_name || null),
    sub_category_name:   a.parent_id ? (a.activity_name || null) : null,
    parent_id:           a.parent_id ? Number(a.parent_id) : null,
    status:              a.status || 'active',
    sort_order:          Number(a.sort_order) || 0
  }));
  await upsertInBatches('activities', rows, 'id');
}

// ── MATERIALS ───────────────────────────────────────────────────────

async function migrateMaterials() {
  const materials = await fetchJson({ action: 'getMaterials' });
  const rows = materials.map(m => ({
    id:            Number(m.id),
    material_name: m.material_name,
    unit:          m.unit || null,
    budget_qty:    Number(m.budget_qty) || 0,
    status:        m.status || 'active'
  }));
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

async function migrateDprRecordsAndEntries() {
  const dprs = await fetchJson({});
  const headerRows = dprs.map(d => ({
    report_date:      d.date,
    site:             d.site,
    prepared_by:      d.by || '',
    activity_details: d.activityDetails || '',
    total_manpower:   Number(d.total) || 0,
    submitted_at:     toIsoOrNull(d.submittedAt),
    edit_permission:  d.editPermission || '',
    requested_by:     d.requestedBy || '',
    site_condition:   d.siteCondition || ''
  }));

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

    const source = (Array.isArray(d.details) && d.details.length) ? d.details
                 : (Array.isArray(d.civilActivities) ? d.civilActivities : []);
    const items = source.filter(a => (Number(a.skilled) || 0) > 0 || (Number(a.unskilled) || 0) > 0);

    const { error: delErr } = await supabase.from('dpr_manpower_entries').delete().eq('dpr_record_id', recordId);
    if (delErr) throw new Error(`dpr_manpower_entries delete failed for ${d.date}||${d.site}: ${delErr.message}`);
    if (!items.length) continue;

    const entryRows = items.map(a => ({
      dpr_record_id: recordId,
      section:       a.section || 'Civil',
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
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
