// Material Consumption Report model — one site on one day, every
// consumption entry logged for it. Shared by the on-screen MaterialReport
// card and the JPG/PDF exporters (lib/report/exportReport.js), the same
// way lib/report/reportModel.js serves the DPR.
//
// Only Trust-owned entries count toward the totals; Contractor/Other rows
// are listed for reference (lib/materials/consumption.js).

import { formatDisplayDate, siteDisplayName, toYMD } from '../report/reportModel';
import { normalizeEntry, ownershipCounts, trustTotals, TRUST } from './consumption';

export const MATERIAL_REPORT_TITLE = 'Material Consumption Report';

// `MCR_[Site]_[Date]` — the report number and the export file base name.
export function materialReportNumber(site, date) {
  const cleanSite = String(site || '').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Site';
  return `MCR_${cleanSite}_${toYMD(date) || 'undated'}`;
}

const uniq = (xs) => [...new Set(xs.map(x => String(x || '').trim()).filter(Boolean))];

/**
 * @param {object} input
 * @param {string} input.date     YYYY-MM-DD
 * @param {string} input.site     project_name as stored on the entries
 * @param {Array}  input.entries  API logs ({material_name, qty, …, loggedBy, createdAt}) or form rows
 * @param {Array}  [input.projects] for "Parent › Sub" site names
 * @param {string} [input.loggedBy] fallback author for entries without one (just-saved form rows)
 */
export function buildMaterialReport({ date, site, entries, projects = [], loggedBy = '' }) {
  const rows = (entries || [])
    .map(e => ({ ...normalizeEntry(e), loggedBy: String(e.loggedBy || loggedBy || '').trim(), createdAt: e.createdAt || '' }))
    .filter(e => e.material && e.qty > 0);
  const counts = ownershipCounts(rows);
  const ymd = toYMD(date);
  const latest = rows.map(r => r.createdAt).filter(Boolean).sort().pop() || '';
  return {
    kind: 'material',
    title: MATERIAL_REPORT_TITLE,
    dprNo: materialReportNumber(site, ymd), // report number; named like the DPR's so the exporters treat both alike
    date: ymd,
    displayDate: formatDisplayDate(ymd),
    site: String(site || ''),
    siteDisplay: siteDisplayName(site, projects),
    loggedBy: uniq(rows.map(r => r.loggedBy)),
    entries: rows,
    trustTotals: trustTotals(rows),
    counts,
    totals: {
      entries: rows.length,
      trust: counts[TRUST],
      reference: counts.Contractor + counts.Other,
      materials: uniq(rows.map(r => r.material.toLowerCase())).length,
    },
    submittedAt: latest,
    draft: false,
    generatedAt: new Date().toISOString(),
  };
}

// Every entry for the same site + day as `log`, from the loaded log list.
export function entriesForSiteDay(logs, date, site) {
  const ymd = toYMD(date);
  const s = String(site || '').trim();
  return (logs || []).filter(l => toYMD(l.date) === ymd && String(l.site || '').trim() === s);
}
