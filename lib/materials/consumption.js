// Pure "Consumption Entries" logic shared by the Materials screen, the
// Entry form's materials section and the Executive Report.
//
// An entry is one material used on a site/day:
//   material, qty + unit, ownership (Trust | Contractor | Other),
//   contractor, output / work done (qty + unit) and remarks.
//
// Only Trust-owned (company-supplied) entries count toward the Trust's
// material totals. Contractor/Other entries are listed for reference and
// excluded from every total.

import { siteKey } from '../sites';

export const OWNERSHIP_OPTIONS = ['Trust', 'Contractor', 'Other'];
export const TRUST = 'Trust';

// Suggestions only — both unit fields accept free text.
export const QTY_UNIT_SUGGESTIONS = ['Bags', 'Nos', 'Brass', 'Kg', 'Ton', 'Cu.m', 'Cft', 'Ltr', 'Rft', 'Sq.ft', 'Bundle', 'Box'];
export const OUTPUT_UNIT_SUGGESTIONS = ['Rft', 'Sq.ft', 'Cu.m', 'Cft', 'Rmt', 'Sq.m', 'Nos', 'Kg'];

export function normalizeOwnership(v) {
  const s = String(v || '').trim().toLowerCase();
  return OWNERSHIP_OPTIONS.find(o => o.toLowerCase() === s) || TRUST; // rows logged before ownership existed were Trust's
}

export const isTrust = (entry) => normalizeOwnership(entry.ownership) === TRUST;

// ── Edit / delete lifecycle ───────────────────────────────────────────
// Admins: edit or delete any entry, any time. The user who logged an
// entry: their own, any time. On an archived (inactive) site entries are
// read-only: nobody edits them, and only an admin may delete them.
// Shared by the server (which enforces it) and the UI (which only picks
// the buttons).

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

/**
 * @param {{loggedBy}} entry
 * @param {{username, role}} user
 * @param {{archived?: boolean}} [opts] the entry's site is inactive (lib/sites.js isArchivedSite)
 * @returns {{ edit: Access, delete: Access }} Access is 'direct' (do it) or 'none'.
 */
export function consumptionAccess(entry, user, { archived = false } = {}) {
  if (!user) return { edit: 'none', delete: 'none' };
  const isAdmin = user.role === 'admin';
  if (archived) return { edit: 'none', delete: isAdmin ? 'direct' : 'none' };
  if (isAdmin || sameName(entry.loggedBy, user.username)) return { edit: 'direct', delete: 'direct' };
  return { edit: 'none', delete: 'none' };
}

export function formatQty(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export function formatOutput(qty, unit) {
  if (qty === null || qty === undefined || qty === '' || !Number.isFinite(Number(qty))) return '';
  return `${formatQty(qty)}${unit ? ` ${unit}` : ''}`;
}

const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// One shape for everything downstream, from either the API
// (outputQty/outputUnit) or a form/draft row (output_qty/output_unit).
// Idempotent: an already-normalized entry ({ material, ... }) maps to itself,
// so trustTotals()/ownershipCounts() accept either.
export function normalizeEntry(e) {
  return {
    material: String(e.material_name || e.name || e.material || '').trim(),
    qty: Math.max(0, Number(e.qty) || 0),
    unit: String(e.unit || '').trim(),
    ownership: normalizeOwnership(e.ownership),
    contractor: String(e.contractor || '').trim(),
    outputQty: numOrNull(e.outputQty ?? e.output_qty),
    outputUnit: String(e.outputUnit ?? e.output_unit ?? '').trim(),
    remarks: String(e.remarks || '').trim(),
  };
}

/**
 * Cumulative consumption per material + unit (units can differ per entry
 * now, and bags can't be added to kg). `ownership` keeps only one of
 * OWNERSHIP_OPTIONS; '' keeps every entry. Each row also carries `sites`:
 * the same total split per log site, largest first ({ site, qty, entries }).
 */
export function materialTotals(entries, { ownership = TRUST } = {}) {
  const map = new Map();
  (entries || []).forEach(raw => {
    const e = normalizeEntry(raw);
    if ((ownership && e.ownership !== ownership) || !e.material || e.qty <= 0) return;
    const k = `${e.material.toLowerCase()}|${e.unit.toLowerCase()}`;
    if (!map.has(k)) map.set(k, { material: e.material, unit: e.unit, qty: 0, entries: 0, bySite: new Map() });
    const row = map.get(k);
    row.qty += e.qty;
    row.entries += 1;
    const site = String(raw.site || '').trim();
    if (!row.bySite.has(site)) row.bySite.set(site, { site, qty: 0, entries: 0 });
    const s = row.bySite.get(site);
    s.qty += e.qty;
    s.entries += 1;
  });
  return [...map.values()]
    .map(({ bySite, ...row }) => ({ ...row, sites: [...bySite.values()].sort((a, b) => b.qty - a.qty || a.site.localeCompare(b.site)) }))
    .sort((a, b) => a.material.localeCompare(b.material) || a.unit.localeCompare(b.unit));
}

// Trust-only totals — the only ones the reports and exports count.
export function trustTotals(entries) {
  return materialTotals(entries, { ownership: TRUST });
}

export function ownershipCounts(entries) {
  const counts = { Trust: 0, Contractor: 0, Other: 0 };
  (entries || []).forEach(e => { counts[normalizeOwnership(e.ownership)] += 1; });
  return counts;
}

// Sites are full paths (lib/sites.js). sitePaths (a Set of siteKey()s,
// lib/sites.js siteFilterPaths()) also matches a parent site's sub-sites;
// when given it replaces the exact `site` path.
export function filterLogs(logs, { start = '', end = '', site = '', sitePaths = null, material = '', ownership = '', contractor = '' } = {}) {
  return (logs || []).filter(l => {
    if (start && l.date < start) return false;
    if (end && l.date > end) return false;
    if (sitePaths) { if (!sitePaths.has(siteKey(l.site))) return false; }
    else if (site && siteKey(l.site) !== siteKey(site)) return false;
    if (material && String(l.material_name || '').trim() !== material) return false;
    if (ownership && normalizeOwnership(l.ownership) !== ownership) return false;
    if (contractor && !sameName(l.contractor, contractor)) return false;
    return true;
  });
}

// Date-range presets for log filters: key → { start, end } (YYYY-MM-DD,
// local time; weeks start on Monday). 'all' is the empty range.
export const DATE_PRESETS = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All time']];

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function presetRange(key, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  if (key === 'today') return { start: ymd(now), end: ymd(now) };
  if (key === 'week') {
    const mon = d - ((now.getDay() + 6) % 7);
    return { start: ymd(new Date(y, m, mon)), end: ymd(new Date(y, m, mon + 6)) };
  }
  if (key === 'month') return { start: ymd(new Date(y, m, 1)), end: ymd(new Date(y, m + 1, 0)) };
  return { start: '', end: '' };
}

// The preset a { start, end } range is exactly, or 'custom'.
export function activePreset({ start = '', end = '' }, now = new Date()) {
  const hit = DATE_PRESETS.find(([k]) => { const r = presetRange(k, now); return r.start === start && r.end === end; });
  return hit ? hit[0] : 'custom';
}

export function sortLogsNewestFirst(logs) {
  return (logs || []).slice().sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

// ── Submission batches ────────────────────────────────────────────────
// Rows saved by one submission share batchId (migrations/005). Rows saved
// before that column existed group on what one insert has in common —
// date, site, logger and the identical, per-transaction created_at.
export function batchKey(log) {
  if (log.batchId) return `b:${log.batchId}`;
  return `t:${log.date}|${String(log.site || '').trim()}|${String(log.loggedBy || '').trim().toLowerCase()}|${log.createdAt || ''}`;
}

// Every log row in the same submission as `log` (itself included), in form
// order where it was recorded.
export function batchEntries(logs, log) {
  const key = batchKey(log);
  return (logs || []).filter(l => batchKey(l) === key).sort(byBatchLine);
}

const byBatchLine = (a, b) => (a.batchLine ?? 0) - (b.batchLine ?? 0);

/**
 * Log rows → one item per submission, in the order the logs came in (sort
 * them first). Each: { key, entries (form order), date, site, loggedBy,
 * createdAt (earliest), editedBy }.
 */
export function groupSubmissions(logs) {
  const map = new Map();
  (logs || []).forEach(l => {
    const k = batchKey(l);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(l);
  });
  return [...map.entries()].map(([key, rows]) => {
    const entries = rows.slice().sort(byBatchLine);
    const first = entries[0];
    return {
      key,
      entries,
      date: first.date,
      site: first.site,
      loggedBy: first.loggedBy,
      createdAt: entries.map(e => e.createdAt).filter(Boolean).sort()[0] || '',
      editedBy: (entries.find(e => e.editedBy) || {}).editedBy || '',    };
  });
}

/**
 * A submission's quantity per material + unit, all ownerships, in form
 * order — the Consumption Log's one-line-per-material summary (the report
 * and the edit dialog keep the individual entries). `trust` is true when
 * any of the material's entries is Trust-owned.
 */
export function submissionMaterialTotals(entries) {
  const map = new Map();
  (entries || []).forEach(raw => {
    const e = normalizeEntry(raw);
    if (!e.material) return;
    const k = `${e.material.toLowerCase()}|${e.unit.toLowerCase()}`;
    if (!map.has(k)) map.set(k, { key: k, material: e.material, unit: e.unit, qty: 0, trust: false });
    const row = map.get(k);
    row.qty += e.qty;
    if (e.ownership === TRUST) row.trust = true;
  });
  return [...map.values()];
}

/**
 * consumptionAccess() for a whole submission: direct only when every
 * entry allows it directly. Shared by the server (which enforces it) and
 * the UI.
 */
export function submissionAccess(entries, user, opts) {
  const each = (entries || []).map(e => consumptionAccess(e, user, opts));
  const combine = (kind) => {
    const xs = each.map(a => a[kind]);
    return xs.length && xs.every(x => x === 'direct') ? 'direct' : 'none';
  };
  return { edit: combine('edit'), delete: combine('delete') };
}

// ── Form rows (Materials screen + Entry form) ─────────────────────────

let _seq = 0;
export function emptyEntryRow(defaults = {}) {
  return { key: `ce${++_seq}`, name: '', qty: '', unit: '', ownership: TRUST, contractor: '', outputQty: '', outputUnit: '', remarks: '', ...defaults };
}

export function entryRowFrom(saved) {
  const e = normalizeEntry(saved);
  return emptyEntryRow({
    name: e.material,
    qty: e.qty ? String(e.qty) : '',
    unit: e.unit,
    ownership: e.ownership,
    contractor: e.contractor,
    outputQty: e.outputQty === null ? '' : String(e.outputQty),
    outputUnit: e.outputUnit,
    remarks: e.remarks,
  });
}

const rowHasContent = (r) => !!(r.name || String(r.qty).trim() || r.contractor || String(r.outputQty).trim() || r.remarks);

// Returns an error message for the first invalid row, or null.
export function validateEntryRows(rows) {
  for (const r of rows) {
    if (!rowHasContent(r)) continue;
    const qty = Number(r.qty) || 0;
    if (!r.name) return '⚠️ Select a material for each consumption entry';
    if (qty <= 0) return `⚠️ Enter a quantity for ${r.name}`;
    if (!String(r.unit).trim()) return `⚠️ Enter a unit for ${r.name}`;
    if (normalizeOwnership(r.ownership) === 'Contractor' && !String(r.contractor).trim()) return `⚠️ Enter the contractor for ${r.name}`;
    const out = String(r.outputQty).trim();
    if (out && !(Number(out) >= 0)) return `⚠️ Output / work done for ${r.name} must be a number`;
    if (out && !String(r.outputUnit).trim()) return `⚠️ Enter the output unit for ${r.name} (e.g. Rft, Sq.ft)`;
  }
  return null;
}

// Form row → saveMaterialLog payload item (lib/dprSupabaseApi.js).
export function serializeEntryRows(rows) {
  return rows.filter(r => r.name && (Number(r.qty) || 0) > 0).map(r => ({
    material_name: r.name,
    qty: Number(r.qty) || 0,
    unit: String(r.unit).trim(),
    ownership: normalizeOwnership(r.ownership),
    contractor: String(r.contractor).trim(),
    output_qty: String(r.outputQty).trim() === '' ? null : Number(r.outputQty),
    output_unit: String(r.outputQty).trim() === '' ? '' : String(r.outputUnit).trim(),
    remarks: String(r.remarks).trim(),
  }));
}

export function entryRowHasContent(r) {
  return rowHasContent(r);
}
