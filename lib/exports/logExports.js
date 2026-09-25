// Log exports for the History (DPR) and Materials pages. Each exports the
// records passed in — the page's current filtered list.
//
//   DPR log:      every DPR flattened to one row per activity line, as CSV,
//                 Excel (plus a per-site summary sheet) or a landscape PDF.
//   Material log: one row per consumption entry, as CSV or Excel (plus a
//                 Trust-only totals sheet).

import { recordActivities, toYMD } from '../report/reportModel';
import { normalizeEntry, trustTotals } from '../materials/consumption';

// ── DPR log ───────────────────────────────────────────────────────────

const DPR_HEADERS = [
  'Date', 'Site', 'Supervisor (Created By)', 'Last Edited By', 'Submitted At', 'Site Condition',
  'Total DPR Manpower', 'Activity Category (Main)', 'Sub-Activity',
  'Skilled Workers', 'Unskilled Workers', 'Activity Total', 'Note',
];

export function buildDprLogRows(history) {
  const rows = [DPR_HEADERS];
  (history || []).forEach(item => {
    const base = [toYMD(item.date), item.site || '', item.by || '', item.editedBy || '', item.submittedAt || '', item.siteCondition || '', Number(item.total) || 0];
    const acts = recordActivities(item);
    if (!acts.length) { rows.push([...base, '', '', 0, 0, 0, '']); return; }
    acts.forEach(a => {
      const main = a.main_activity || a.activity || '';
      // Saved rows carry the sub-activity name in `activity` when one was chosen.
      const sub = a.sub_activity || (a.main_activity && a.activity && a.activity !== a.main_activity ? a.activity : '');
      const sk = Number(a.skilled) || 0, un = Number(a.unskilled) || 0;
      rows.push([...base, main, sub, sk, un, sk + un, a.note || '']);
    });
  });
  return rows;
}

export function buildSiteSummaryRows(history) {
  const bySite = new Map();
  (history || []).forEach(item => {
    const site = item.site || 'Unknown';
    const cur = bySite.get(site) || { workers: 0, dprs: 0 };
    cur.workers += Number(item.total) || 0;
    cur.dprs += 1;
    bySite.set(site, cur);
  });
  return [
    ['Site', 'Total Workers', 'Total DPRs', 'Avg Workers / DPR'],
    ...[...bySite.entries()]
      .sort((a, b) => b[1].workers - a[1].workers)
      .map(([site, d]) => [site, d.workers, d.dprs, d.dprs ? Math.round(d.workers / d.dprs) : 0]),
  ];
}

// ── Material consumption log ──────────────────────────────────────────

const MATERIAL_HEADERS = [
  'Date', 'Site', 'Material', 'Quantity', 'Unit', 'Ownership', 'Contractor',
  'Output Qty', 'Output Unit', 'Remarks', 'Logged By', 'Logged At', 'Edited By',
];

export function buildMaterialLogRows(logs) {
  return [
    MATERIAL_HEADERS,
    ...(logs || []).map(l => {
      const e = normalizeEntry(l);
      return [
        toYMD(l.date), l.site || '', e.material, e.qty, e.unit, e.ownership, e.contractor,
        e.outputQty === null ? '' : e.outputQty, e.outputQty === null ? '' : e.outputUnit, e.remarks,
        l.loggedBy || '', l.createdAt || '', l.editedBy || '',
      ];
    }),
  ];
}

export function buildTrustTotalRows(logs) {
  return [
    ['Material', 'Total Quantity (Trust only)', 'Unit', 'Entries'],
    ...trustTotals(logs).map(t => [t.material, t.qty, t.unit, t.entries]),
  ];
}

// ── Shared file helpers ───────────────────────────────────────────────

export function toCsv(rows) {
  return rows.map(r => r.map(v => {
    const s = String(v === null || v === undefined ? '' : v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const DPR_BASE = () => `TPD_DPR_Log_${today()}`;
const MATERIAL_BASE = () => `TPD_Material_Log_${today()}`;

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// BOM so Excel opens UTF-8 (Gujarati site/user names) correctly.
const downloadCsv = (rows, base) => download(new Blob(['\uFEFF' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }), `${base}.csv`);

// SheetJS isn't on npm in a current version, so it's loaded from its own
// CDN on first use.
const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js';
let sheetJsPromise = null;
function loadSheetJs() {
  if (typeof window !== 'undefined' && window.XLSX) return Promise.resolve(window.XLSX);
  if (!sheetJsPromise) {
    sheetJsPromise = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = SHEETJS_URL;
      el.async = true;
      el.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('Excel library failed to initialise')));
      el.onerror = () => { sheetJsPromise = null; reject(new Error('Could not load the Excel library — check your connection')); };
      document.head.appendChild(el);
    });
  }
  return sheetJsPromise;
}

async function downloadWorkbook(sheets, base) {
  const XLSX = await loadSheetJs();
  const wb = XLSX.utils.book_new();
  sheets.forEach(([name, rows]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name));
  XLSX.writeFile(wb, `${base}.xlsx`);
}

// ── Public exporters ──────────────────────────────────────────────────

export const exportDprLogCsv = (history) => downloadCsv(buildDprLogRows(history), DPR_BASE());

export const exportDprLogExcel = (history) => downloadWorkbook([
  ['DPR Log', buildDprLogRows(history)],
  ['Site Summary', buildSiteSummaryRows(history)],
], DPR_BASE());

export async function exportDprLogPdf(history) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const rows = buildDprLogRows(history);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(21, 33, 43);
  doc.text('Trimandir Construction Project — DPR Log', 40, 32);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(104, 118, 128);
  doc.text(`${history.length} report${history.length === 1 ? '' : 's'} · exported ${today()}`, 40, 46);
  autoTable(doc, {
    head: [rows[0]],
    body: rows.slice(1),
    startY: 56,
    margin: { top: 40 },
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 3, lineColor: [203, 211, 208], lineWidth: 0.4, textColor: [21, 33, 43] },
    headStyles: { fillColor: [21, 33, 43], textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 249] },
    didDrawPage: () => {
      doc.setFontSize(8);
      doc.setTextColor(104, 118, 128);
      doc.text(`Page ${doc.internal.getNumberOfPages()}`, 40, doc.internal.pageSize.getHeight() - 14);
    },
  });
  doc.save(`${DPR_BASE()}.pdf`);
}

export const exportMaterialLogCsv = (logs) => downloadCsv(buildMaterialLogRows(logs), MATERIAL_BASE());

export const exportMaterialLogExcel = (logs) => downloadWorkbook([
  ['Consumption Log', buildMaterialLogRows(logs)],
  ['Trust Totals', buildTrustTotalRows(logs)],
], MATERIAL_BASE());
