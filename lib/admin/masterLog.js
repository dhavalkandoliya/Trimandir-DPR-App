// Master Log exports (Admin → Analytics): every DPR flattened to one row
// per activity line, as CSV, Excel (with a per-site summary sheet) or a
// landscape vector PDF. Ported from index.html's exportMasterLog* helpers.

import { recordActivities, toYMD } from '../report/reportModel';

const MASTER_HEADERS = [
  'Date', 'Site', 'Supervisor (Created By)', 'Last Edited By', 'Submitted At',
  'Total DPR Manpower', 'Activity Category (Main)', 'Sub-Activity',
  'Skilled Workers', 'Unskilled Workers', 'Activity Total', 'Note',
];

export function buildMasterLogRows(history) {
  const rows = [MASTER_HEADERS];
  (history || []).forEach(item => {
    const base = [toYMD(item.date), item.site || '', item.by || '', item.editedBy || '', item.submittedAt || '', Number(item.total) || 0];
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
    ['Site', 'Total Workers (All Time)', 'Total DPRs', 'Avg Workers / DPR'],
    ...[...bySite.entries()]
      .sort((a, b) => b[1].workers - a[1].workers)
      .map(([site, d]) => [site, d.workers, d.dprs, d.dprs ? Math.round(d.workers / d.dprs) : 0]),
  ];
}

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
const baseName = () => `TPD_DPR_Master_Log_${today()}`;

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

// BOM so Excel opens UTF-8 (Gujarati site/user names) correctly. The old
// data: URL version also truncated the file at the first '#' in any note.
export function exportMasterLogCsv(history) {
  download(new Blob(['\uFEFF' + toCsv(buildMasterLogRows(history))], { type: 'text/csv;charset=utf-8' }), `${baseName()}.csv`);
}

// SheetJS isn't on npm in a current version, so it's loaded from its own CDN
// on first use, as before — just lazily now instead of on every page load.
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

export async function exportMasterLogExcel(history) {
  const XLSX = await loadSheetJs();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildMasterLogRows(history)), 'Master Log');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildSiteSummaryRows(history)), 'Site Summary');
  XLSX.writeFile(wb, `${baseName()}.xlsx`);
}

export async function exportMasterLogPdf(history) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const rows = buildMasterLogRows(history);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFontSize(14);
  doc.text('Trimandir Construction Project — DPR Master Log', 40, 30);
  autoTable(doc, {
    head: [rows[0]],
    body: rows.slice(1),
    startY: 45,
    margin: { top: 45 },
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [49, 46, 129] },
    didDrawPage: (data) => {
      doc.setFontSize(8);
      doc.text(`Page ${doc.internal.getNumberOfPages()}`, data.settings.margin.left, doc.internal.pageSize.getHeight() - 10);
    },
  });
  doc.save(`${baseName()}.pdf`);
}
