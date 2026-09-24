// Pure report model shared by the on-screen ExecutiveReport, the JPG/PDF
// exporters and the WhatsApp/Web Share text. Both the Entry form (just
// generated) and History (saved records) funnel through buildReport(), so
// every surface shows the same numbers, grouping and DPR number.
//
// There is deliberately no Civil/Interior split: every activity row goes
// into one table, grouped only by its main activity.

export const ORG_NAME = 'Trimandir Construction Project';
export const REPORT_TITLE = 'Daily Progress Report — Manpower';

export const CONDITION_EMOJI = { Sunny: '☀️', Rainy: '🌧️', Cloudy: '☁️', 'Site Closed': '🚧', Holiday: '🎉' };

const toNum = (v) => Math.max(0, Number(v) || 0);

export function toYMD(v) {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.substring(0, 10);
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }
  return s;
}

export function formatDisplayDate(ymd) {
  const y = toYMD(ymd);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(y)) return y || '—';
  const [yr, mo, da] = y.split('-');
  const weekday = new Date(Number(yr), Number(mo) - 1, Number(da)).toLocaleDateString('en-GB', { weekday: 'short' });
  return `${da}-${mo}-${yr} (${weekday})`;
}

export function toTitleCase(str) {
  if (!str) return '';
  return String(str).replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
    .toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bRcc\b/g, 'RCC').replace(/\bHvac\b/g, 'HVAC').replace(/\bCctv\b/g, 'CCTV')
    .replace(/\bAc\b/g, 'AC').replace(/\bDpr\b/g, 'DPR').replace(/\bMep\b/g, 'MEP');
}

export function siteDisplayName(siteName, projects = []) {
  if (!siteName) return '—';
  const norm = (v) => String(v).trim().toLowerCase();
  const proj = projects.find(p => norm(p.project_name) === norm(siteName));
  if (proj && proj.parent_id && String(proj.parent_id).trim() !== '') {
    const parent = projects.find(p => String(p.id).trim() === String(proj.parent_id).trim());
    if (parent) return `${parent.project_name} › ${proj.project_name}`;
  }
  return String(siteName);
}

// `DPR_[Site]_[Date]` — used as the DPR No. and as the export file base name.
export function dprNumber(site, date) {
  const cleanSite = String(site || '').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Site';
  return `DPR_${cleanSite}_${toYMD(date) || 'undated'}`;
}

// All activity rows of a saved History record, regardless of which storage
// bucket they came back in (civilActivities/interiorActivities are just a
// storage artefact of the API response; `details` is the oldest fallback).
export function recordActivities(item) {
  const a = Array.isArray(item.civilActivities) ? item.civilActivities : [];
  const b = Array.isArray(item.interiorActivities) ? item.interiorActivities : [];
  if (a.length || b.length) return [...a, ...b];
  return Array.isArray(item.details) ? item.details : [];
}

const LEADING_MARKS = /^[↳\s\-➔›]+/;

// Accepts both shapes: the Entry form's {main_activity, sub_activity} and a
// saved record's {main_activity, activity} (where `activity` holds the
// sub-activity name when one was chosen).
function normalizeActivity(a) {
  const main = String(a.main_activity || a.activity || 'General').trim();
  let sub = String(a.sub_activity || (a.main_activity && a.activity && a.activity !== a.main_activity ? a.activity : '')).trim();
  sub = sub.replace(LEADING_MARKS, '').trim();
  const mainLower = main.toLowerCase();
  // Old Sheets-era rows stored "RCC Work ↳ Steel" as the sub name — drop the
  // repeated main prefix, but only at a word boundary ("Plaster" must not
  // turn "Plastering" into "ing").
  if (sub.toLowerCase().startsWith(mainLower) && /^[\s↳\-➔›:]/.test(sub.substring(main.length))) {
    sub = sub.substring(main.length).replace(LEADING_MARKS, '').trim();
  }
  if (sub.toLowerCase() === mainLower) sub = '';
  const skilled = toNum(a.skilled);
  const unskilled = toNum(a.unskilled);
  return { main, sub, skilled, unskilled, total: skilled + unskilled, note: String(a.note || '').trim() };
}

function sumRows(rows) {
  return rows.reduce((t, r) => ({
    skilled: t.skilled + r.skilled,
    unskilled: t.unskilled + r.unskilled,
    total: t.total + r.total,
  }), { skilled: 0, unskilled: 0, total: 0 });
}

/**
 * @param {object} input
 * @param {string} input.date       YYYY-MM-DD (or anything toYMD understands)
 * @param {string} input.site       project_name as stored on the record
 * @param {Array}  input.activities rows in either shape (see normalizeActivity)
 * @param {string} [input.preparedBy]
 * @param {string} [input.editedBy]
 * @param {string} [input.condition]
 * @param {Array}  [input.projects] for "Parent › Sub" site display names
 */
export function buildReport({ date, site, activities, preparedBy = '', editedBy = '', condition = '', projects = [] }) {
  const rows = (activities || []).map(normalizeActivity).filter(r => r.total > 0);

  const groupMap = new Map();
  rows.forEach(r => {
    const key = r.main.toLowerCase();
    if (!groupMap.has(key)) groupMap.set(key, { name: toTitleCase(r.main), rows: [] });
    groupMap.get(key).rows.push({ name: r.sub || toTitleCase(r.main), isSub: !!r.sub, skilled: r.skilled, unskilled: r.unskilled, total: r.total, note: r.note });
  });
  const groups = [...groupMap.values()].map(g => ({
    ...g,
    subtotal: sumRows(g.rows),
    // A main activity logged on its own (no sub-activities) reads as one row;
    // a header + subtotal around a single row would only repeat it.
    collapsed: g.rows.length === 1 && !g.rows[0].isSub,
  }));

  const ymd = toYMD(date);
  return {
    dprNo: dprNumber(site, ymd),
    date: ymd,
    displayDate: formatDisplayDate(ymd),
    site: String(site || ''),
    siteDisplay: siteDisplayName(site, projects),
    preparedBy: String(preparedBy || ''),
    editedBy: editedBy && editedBy !== preparedBy ? String(editedBy) : '',
    condition: String(condition || ''),
    groups,
    totals: { ...sumRows(rows), activities: rows.length },
    generatedAt: new Date().toISOString(),
  };
}

export function reportFromRecord(item, projects) {
  return buildReport({
    date: item.date,
    site: item.site,
    activities: recordActivities(item),
    preparedBy: item.by,
    editedBy: item.editedBy,
    condition: item.siteCondition,
    projects,
  });
}

// WhatsApp-flavoured markdown (*bold*, _italic_). Built from the model,
// never scraped from the DOM.
export function buildWhatsAppText(report) {
  const t = report.totals;
  const lines = [
    `*${REPORT_TITLE}*`,
    `_${ORG_NAME}_`,
    '',
    `🆔 ${report.dprNo}`,
    `📅 ${report.displayDate}`,
    `📍 ${report.siteDisplay}`,
  ];
  if (report.condition) lines.push(`${CONDITION_EMOJI[report.condition] || '🌤️'} ${report.condition}`);
  if (report.preparedBy) lines.push(`👤 ${report.preparedBy}${report.editedBy ? ` (edited by ${report.editedBy})` : ''}`);
  lines.push('', `👷 *Total: ${t.total}*  (Skilled ${t.skilled} · Unskilled ${t.unskilled} · ${t.activities} activit${t.activities === 1 ? 'y' : 'ies'})`, '');

  report.groups.forEach(g => {
    if (g.collapsed) {
      const r = g.rows[0];
      lines.push(`*${g.name}* — ${r.total} (S ${r.skilled} / U ${r.unskilled})`);
      if (r.note) lines.push(`   _${r.note}_`);
      return;
    }
    lines.push(`*${g.name}* — ${g.subtotal.total}`);
    g.rows.forEach(r => {
      lines.push(`  • ${r.name}: ${r.total} (S ${r.skilled} / U ${r.unskilled})`);
      if (r.note) lines.push(`     _${r.note}_`);
    });
  });

  lines.push('', `*Grand Total: ${t.total}*`);
  return lines.join('\n');
}
