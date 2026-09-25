// Material Consumption Report model — one consumption entry (the log row
// viewed from the Consumption Log), or the entries of one submission (the
// "Save consumption" that just happened). Never an aggregate of the day:
// the table and every total cover exactly the entries passed in. Shared by
// the on-screen MaterialReport card and the JPG/PDF exporters
// (lib/report/exportReport.js), the same way lib/report/reportModel.js
// serves the DPR.
//
// Only Trust-owned entries count toward the Trust total; Contractor/Other
// rows are listed for reference (lib/materials/consumption.js).

import { formatDateTime, formatDisplayDate, siteDisplayName, toYMD } from '../report/reportModel';
import { formatOutput, formatQty, normalizeEntry, ownershipCounts, trustTotals, TRUST } from './consumption';

export const MATERIAL_REPORT_TITLE = 'Material Consumption Report';

// Short, stable reference for a log row: the first 8 hex digits of its id.
export const entryRef = (id) => String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();

// `MCR_[Site]_[Date]_[Ref]` — the report number and the export file base
// name. Ref is the (first) entry's reference, so each entry's report gets
// its own number and file name.
export function materialReportNumber(site, date, ref) {
  const cleanSite = String(site || '').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Site';
  return `MCR_${cleanSite}_${toYMD(date) || 'undated'}${ref ? `_${ref}` : ''}`;
}

const uniq = (xs) => [...new Set(xs.map(x => String(x || '').trim()).filter(Boolean))];

/**
 * @param {object} input
 * @param {string} input.date     YYYY-MM-DD
 * @param {string} input.site     project_name as stored on the entries
 * @param {Array}  input.entries  the entries to report — API logs ({id, material_name, qty, …, loggedBy, createdAt}) or just-saved rows
 * @param {Array}  [input.projects] for "Parent › Sub" site names
 * @param {string} [input.loggedBy] fallback author for entries without one (just-saved rows)
 */
export function buildMaterialReport({ date, site, entries, projects = [], loggedBy = '' }) {
  const rows = (entries || [])
    .map(e => ({
      ...normalizeEntry(e),
      ref: entryRef(e.id),
      loggedBy: String(e.loggedBy || loggedBy || '').trim(),
      createdAt: e.createdAt || '',
    }))
    .filter(e => e.material && e.qty > 0);
  const counts = ownershipCounts(rows);
  const ymd = toYMD(date);
  const refs = rows.map(r => r.ref).filter(Boolean);
  const latest = rows.map(r => r.createdAt).filter(Boolean).sort().pop() || '';
  const single = rows.length === 1 ? rows[0] : null;
  const totals = {
    entries: rows.length,
    trust: counts[TRUST],
    reference: counts.Contractor + counts.Other,
    materials: uniq(rows.map(r => r.material.toLowerCase())).length,
  };

  return {
    kind: 'material',
    title: MATERIAL_REPORT_TITLE,
    dprNo: materialReportNumber(site, ymd, refs[0]), // report number; named like the DPR's so the exporters treat both alike
    date: ymd,
    displayDate: formatDisplayDate(ymd),
    site: String(site || ''),
    siteDisplay: siteDisplayName(site, projects),
    loggedBy: uniq(rows.map(r => r.loggedBy)),
    entries: rows,
    trustTotals: trustTotals(rows),
    counts,
    totals,
    // Meta grid (2×2) and KPI strip, as [label, value] pairs — the card
    // and the PDF render these as given.
    meta: [
      ['Date', formatDisplayDate(ymd)],
      ['Site', siteDisplayName(site, projects)],
      ['Logged by', uniq(rows.map(r => r.loggedBy)).join(', ') || '—'],
      [refs.length > 1 ? 'Entry refs' : 'Entry ref', refs.length ? refs.join(', ') : 'Pending sync'],
    ],
    kpis: single
      ? [
        ['Quantity', `${formatQty(single.qty)} ${single.unit}`.trim()],
        ['Ownership', single.ownership],
        ['Output', formatOutput(single.outputQty, single.outputUnit) || '—'],
        ['Contractor', single.contractor || '—'],
      ]
      : [
        ['Consumption entries', totals.entries],
        ['Trust', totals.trust],
        ['Contractor / other', totals.reference],
        ['Materials', totals.materials],
      ],
    loggedAt: formatDateTime(latest),
    submittedAt: latest,
    draft: false,
    generatedAt: new Date().toISOString(),
  };
}
