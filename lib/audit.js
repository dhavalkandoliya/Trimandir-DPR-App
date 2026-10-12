// Change history (dpr_audit_logs, migrations/012): report snapshots and
// readable Old → New summaries. Pure — used by the server when it logs an
// edit or delete (lib/dprSupabaseApi.js) and by the client to find a
// report's history.
//
// A snapshot is the report as people see it: a DPR with all its manpower
// lines, or a consumption submission with all its materials. The summary
// is one change per line, e.g.
//   Site condition: Sunny → Rainy
//   Rcc › Formwork: skilled 5 → 7
//   Added: Plaster › Internal — 3 skilled, 2 unskilled
//   Cement: quantity 10 Bags → 12 Bags

import { taskName } from './activities';

const num = (v) => Math.round((Number(v) || 0) * 100) / 100;
const txt = (v) => String(v ?? '').trim();
const show = (v) => (txt(v) === '' ? '—' : txt(v));

// ── DPR ─────────────────────────────────────────────────────────────

// record: a dpr_records row; entries: its dpr_manpower_entries rows.
export function dprSnapshot(record, entries) {
  return {
    date: record.report_date,
    site: record.site,
    preparedBy: record.prepared_by || '',
    siteCondition: record.site_condition || '',
    remarks: txt(record.remarks),
    totalManpower: num(record.total_manpower),
    activities: (entries || []).map(e => ({
      section: e.section || 'Civil',
      mainActivity: e.main_activity || e.activity,
      activity: e.activity,
      skilled: num(e.skilled),
      unskilled: num(e.unskilled),
      note: txt(e.note),
      plannedQty: num(e.planned_qty),
      contractor: txt(e.contractor),
    })),
  };
}

const activityLabel = (a) => {
  const task = taskName(a.activity, a.mainActivity);
  const base = a.mainActivity && task !== a.mainActivity ? `${a.mainActivity} › ${task}` : task;
  return (a.section && a.section !== 'Civil' ? `${a.section}: ` : '') + base + (a.contractor ? ` [${a.contractor}]` : '');
};
const workers = (a) => `${a.skilled} skilled, ${a.unskilled} unskilled`;

// Lines of a list that appear on both sides, matched by key (in order,
// so repeated keys pair up one by one): [{ before, after }], plus the
// unmatched removed / added ones.
function matchLines(before, after, keyOf) {
  const pool = new Map();
  before.forEach(b => { const k = keyOf(b); pool.set(k, [...(pool.get(k) || []), b]); });
  const pairs = [], added = [];
  after.forEach(a => {
    const list = pool.get(keyOf(a));
    if (list && list.length) pairs.push({ before: list.shift(), after: a });
    else added.push(a);
  });
  const removed = [...pool.values()].flat();
  return { pairs, added, removed };
}

export function diffDpr(before, after) {
  const lines = [];
  if (!after) return ['Report deleted'];
  if (txt(before.siteCondition) !== txt(after.siteCondition)) lines.push(`Site condition: ${show(before.siteCondition)} → ${show(after.siteCondition)}`);
  if (txt(before.remarks) !== txt(after.remarks)) lines.push(`Remarks: "${show(before.remarks)}" → "${show(after.remarks)}"`);
  const { pairs, added, removed } = matchLines(before.activities || [], after.activities || [],
    a => `${a.section}|${a.mainActivity}|${a.activity}|${a.contractor}`.toLowerCase());
  pairs.forEach(({ before: b, after: a }) => {
    const changes = [];
    if (b.skilled !== a.skilled) changes.push(`skilled ${b.skilled} → ${a.skilled}`);
    if (b.unskilled !== a.unskilled) changes.push(`unskilled ${b.unskilled} → ${a.unskilled}`);
    if (b.plannedQty !== a.plannedQty) changes.push(`planned ${b.plannedQty} → ${a.plannedQty}`);
    if (b.note !== a.note) changes.push(`note "${show(b.note)}" → "${show(a.note)}"`);
    if (changes.length) lines.push(`${activityLabel(a)}: ${changes.join(', ')}`);
  });
  removed.forEach(b => lines.push(`Removed: ${activityLabel(b)} — ${workers(b)}`));
  added.forEach(a => lines.push(`Added: ${activityLabel(a)} — ${workers(a)}`));
  if (before.totalManpower !== after.totalManpower) lines.push(`Total manpower: ${before.totalManpower} → ${after.totalManpower}`);
  return lines;
}

// ── Consumption submission ──────────────────────────────────────────

// rows: material_logs rows (snake_case, as stored) or cleaned entries
// ({ id, name, qty, unit, ownership, contractor, outputQty, outputUnit, remarks }).
export function materialSnapshot({ date, site, loggedBy }, rows) {
  return {
    date, site, loggedBy: loggedBy || '',
    entries: (rows || []).map(r => ({
      id: r.id || '',
      material: txt(r.material_name ?? r.name),
      qty: num(r.quantity ?? r.qty),
      unit: txt(r.unit),
      ownership: txt(r.ownership) || 'Trust',
      contractor: txt(r.contractor),
      outputQty: (r.output_qty ?? r.outputQty) === null || (r.output_qty ?? r.outputQty) === undefined ? null : num(r.output_qty ?? r.outputQty),
      outputUnit: txt(r.output_unit ?? r.outputUnit),
      remarks: txt(r.remarks),
    })),
  };
}

const qtyText = (q, unit) => `${q} ${unit}`.trim();
const outputText = (e) => (e.outputQty === null ? '—' : qtyText(e.outputQty, e.outputUnit));

export function diffMaterialSubmission(before, after) {
  if (!after) return ['Submission deleted'];
  const lines = [];
  // Saved entries keep their id across an edit; new ones have none yet, so
  // never match a saved one.
  const { pairs, added, removed } = matchLines(before.entries || [], after.entries || [], e => e.id);
  pairs.forEach(({ before: b, after: a }) => {
    const changes = [];
    if (b.material !== a.material) changes.push(`material ${b.material} → ${a.material}`);
    if (b.qty !== a.qty || b.unit !== a.unit) changes.push(`quantity ${qtyText(b.qty, b.unit)} → ${qtyText(a.qty, a.unit)}`);
    if (b.ownership !== a.ownership) changes.push(`ownership ${b.ownership} → ${a.ownership}`);
    if (b.contractor !== a.contractor) changes.push(`contractor ${show(b.contractor)} → ${show(a.contractor)}`);
    if (outputText(b) !== outputText(a)) changes.push(`work done ${outputText(b)} → ${outputText(a)}`);
    if (b.remarks !== a.remarks) changes.push(`remarks "${show(b.remarks)}" → "${show(a.remarks)}"`);
    if (changes.length) lines.push(`${b.material}: ${changes.join(', ')}`);
  });
  removed.forEach(b => lines.push(`Removed: ${b.material} ${qtyText(b.qty, b.unit)} (${b.ownership})`));
  added.forEach(a => lines.push(`Added: ${a.material} ${qtyText(a.qty, a.unit)} (${a.ownership})`));
  return lines;
}

// The audit record id of a consumption submission: its batch id, or for
// rows saved before batches existed, its lowest entry id. entries:
// [{ id, batchId | batch_id }].
export function submissionAuditId(entries) {
  const list = entries || [];
  const batch = list.map(e => e.batchId || e.batch_id).find(Boolean);
  return batch || list.map(e => String(e.id || '')).filter(Boolean).sort()[0] || '';
}
