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
 * Cumulative Trust consumption per material + unit (units can differ per
 * entry now, and bags can't be added to kg). Non-Trust entries are skipped.
 */
export function trustTotals(entries) {
  const map = new Map();
  (entries || []).map(normalizeEntry).forEach(e => {
    if (e.ownership !== TRUST || !e.material || e.qty <= 0) return;
    const k = `${e.material.toLowerCase()}|${e.unit.toLowerCase()}`;
    if (!map.has(k)) map.set(k, { material: e.material, unit: e.unit, qty: 0, entries: 0 });
    const row = map.get(k);
    row.qty += e.qty;
    row.entries += 1;
  });
  return [...map.values()].sort((a, b) => a.material.localeCompare(b.material) || a.unit.localeCompare(b.unit));
}

export function ownershipCounts(entries) {
  const counts = { Trust: 0, Contractor: 0, Other: 0 };
  (entries || []).forEach(e => { counts[normalizeOwnership(e.ownership)] += 1; });
  return counts;
}

export function filterLogs(logs, { start = '', end = '', site = '', material = '', ownership = '' } = {}) {
  return (logs || []).filter(l => {
    if (start && l.date < start) return false;
    if (end && l.date > end) return false;
    if (site && String(l.site || '').trim() !== site) return false;
    if (material && String(l.material_name || '').trim() !== material) return false;
    if (ownership && normalizeOwnership(l.ownership) !== ownership) return false;
    return true;
  });
}

export function sortLogsNewestFirst(logs) {
  return (logs || []).slice().sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
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
