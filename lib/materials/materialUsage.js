// Pure material-consumption maths for the Materials screen: usage totals,
// budget status (remaining / progress / over-budget) and log filtering.
//
// Budgets are whole-project figures (Admin → Manage Materials: "flags any
// material whose total usage across DPRs exceeds its budget"), so budget
// status is always computed from ALL logs. Filters only narrow the log list
// and the separate "in selected period" figure — a one-week filter must
// never make an over-budget material look under budget.

export const WARN_RATIO = 0.8; // "near limit" from 80% of budget

const key = (name) => String(name || '').trim().toLowerCase();

export function formatQty(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export function budgetStatus(used, budget) {
  const b = Number(budget) || 0;
  const u = Number(used) || 0;
  if (b <= 0) return { level: 'none', ratio: null, pct: null, remaining: null };
  const ratio = u / b;
  return {
    level: ratio > 1 ? 'over' : ratio >= WARN_RATIO ? 'warn' : 'ok',
    ratio,
    pct: Math.round(ratio * 100),
    remaining: b - u, // negative when over budget
  };
}

// lowercase material name -> total qty
export function usageTotals(logs) {
  const totals = new Map();
  (logs || []).forEach(l => {
    const k = key(l.material_name);
    if (!k) return;
    totals.set(k, (totals.get(k) || 0) + (Number(l.qty) || 0));
  });
  return totals;
}

export function filterLogs(logs, { start = '', end = '', site = '', material = '' } = {}) {
  return (logs || []).filter(l => {
    if (start && l.date < start) return false;
    if (end && l.date > end) return false;
    if (site && String(l.site || '').trim() !== site) return false;
    if (material && String(l.material_name || '').trim() !== material) return false;
    return true;
  });
}

export function sortLogsNewestFirst(logs) {
  return (logs || []).slice().sort((a, b) =>
    String(b.date).localeCompare(String(a.date)) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

const LEVEL_ORDER = { over: 0, warn: 1, ok: 2, none: 3 };

/**
 * One row per material worth showing: every active material with a budget
 * or any usage, plus inactive/deleted materials that still have usage (the
 * old view silently dropped those).
 */
export function buildBudgetRows(materials, allLogs, periodLogs) {
  const all = usageTotals(allLogs);
  const period = periodLogs ? usageTotals(periodLogs) : null;
  const seen = new Set();
  const rows = [];

  (materials || []).forEach(m => {
    const k = key(m.material_name);
    if (!k || seen.has(k)) return;
    seen.add(k);
    const used = all.get(k) || 0;
    const budget = Number(m.budget_qty) || 0;
    const inactive = m.status === 'inactive';
    if (!used && (!budget || inactive)) return;
    rows.push({ name: m.material_name, unit: m.unit || '', budget, used, periodUsed: period ? (period.get(k) || 0) : null, inactive, untracked: false, status: budgetStatus(used, budget) });
  });

  // Logged under a name that's no longer in the material list.
  (allLogs || []).forEach(l => {
    const k = key(l.material_name);
    if (!k || seen.has(k)) return;
    seen.add(k);
    const used = all.get(k) || 0;
    rows.push({ name: String(l.material_name).trim(), unit: l.unit || '', budget: 0, used, periodUsed: period ? (period.get(k) || 0) : null, inactive: false, untracked: true, status: budgetStatus(used, 0) });
  });

  return rows.sort((a, b) =>
    LEVEL_ORDER[a.status.level] - LEVEL_ORDER[b.status.level] ||
    (b.status.ratio || 0) - (a.status.ratio || 0) ||
    b.used - a.used ||
    a.name.localeCompare(b.name));
}
