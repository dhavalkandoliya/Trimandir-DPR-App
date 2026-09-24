// Client-side exporters for the Executive DPR report. Everything here is
// built from the report model (lib/report/reportModel.js) — the PDF is drawn
// as real vector text/tables and only the JPG rasterises the rendered
// ExecutiveReport component. Share hands either file to navigator.share().

import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import ExecutiveReport from '../../components/report/ExecutiveReport';
import { ORG_NAME, REPORT_TITLE } from './reportModel';
import { TRUST, formatOutput, formatQty } from '../materials/consumption';

const CAPTURE_WIDTH_PX = 820;
const JPG_MAX_SCALE = 3;
const JPG_MAX_PIXELS = 16_000_000; // stay under iOS Safari's canvas area limit

// Fixed "paper" palette — matches .exec-report in globals.css.
const C = {
  primary: [49, 46, 129],
  accent: [79, 70, 229],
  text: [30, 27, 46],
  muted: [107, 114, 128],
  border: [227, 229, 240],
  tint: [238, 242, 255],
  subtle: [245, 246, 251],
  groupRow: [241, 245, 249], // light slate — main-activity rows carrying group totals
  contractor: [180, 83, 9],   // amber — Contractor-owned (reference only)
  other: [107, 114, 128],
  white: [255, 255, 255],
};

let libsPromise = null;

// Loaded on demand (they're large) and warmed up when an action bar mounts,
// so the Share button can call navigator.share() while the click still
// counts as a user gesture.
export function preloadExportLibs() {
  if (!libsPromise) {
    libsPromise = Promise.all([import('html2canvas'), import('jspdf'), import('jspdf-autotable')])
      .then(([h, j, a]) => ({ html2canvas: h.default, jsPDF: j.jsPDF, autoTable: a.default }))
      .catch((err) => { libsPromise = null; throw err; });
  }
  return libsPromise;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// jsPDF's built-in Helvetica only covers WinAnsi (Latin-1 + a few symbols);
// anything else (emoji, non-Latin scripts) would print as garbage.
function pdfText(value) {
  return String(value ?? '')
    .replace(/[^\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u203A]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ── JPG ──────────────────────────────────────────────────────────────

export async function renderJpgBlob(report) {
  const { html2canvas } = await preloadExportLibs();
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;left:-10000px;top:0;width:${CAPTURE_WIDTH_PX}px;background:#ffffff;`;
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(ExecutiveReport, { report })));
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const node = host.firstElementChild;
    const area = node.offsetWidth * node.offsetHeight;
    const scale = Math.max(1, Math.min(JPG_MAX_SCALE, Math.sqrt(JPG_MAX_PIXELS / Math.max(1, area))));
    const canvas = await html2canvas(node, {
      scale,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: CAPTURE_WIDTH_PX,
      scrollX: 0,
      scrollY: 0,
    });
    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encoding failed'))), 'image/jpeg', 0.95);
    });
  } finally {
    root.unmount();
    host.remove();
  }
}

export async function exportJpg(report) {
  downloadBlob(await renderJpgBlob(report), `${report.dprNo}.jpg`);
}

// ── PDF (vector, A4 portrait) ────────────────────────────────────────

const PAGE_W = 210;
const MARGIN = 14;
const TOTAL_PAGES = '{total_pages}';

function drawHeader(doc, report) {
  doc.setFillColor(...C.primary);
  doc.rect(0, 0, PAGE_W, 27, 'F');
  doc.setTextColor(...C.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(pdfText(ORG_NAME.toUpperCase()), MARGIN, 11.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(pdfText(REPORT_TITLE), MARGIN, 18.5);

  doc.setFontSize(7.5);
  doc.text('DPR NO.', PAGE_W - MARGIN, 10, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(pdfText(report.dprNo), PAGE_W - MARGIN, 16, { align: 'right', maxWidth: 88 });
}

function drawMeta(doc, report) {
  const col2 = 112;
  const field = (label, value, x, y) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.muted);
    doc.text(label.toUpperCase(), x, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...C.text);
    doc.text(pdfText(value) || '-', x, y + 5.5, { maxWidth: col2 - MARGIN - 6 });
  };
  field('Project / Site', report.siteDisplay, MARGIN, 37);
  field('Date', report.displayDate, MARGIN, 51);
  field('Prepared by', report.preparedBy + (report.editedBy ? ` (edited by ${report.editedBy})` : ''), col2, 37);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...C.muted);
  doc.text('SITE CONDITION', col2, 51);
  if (report.condition) {
    const label = pdfText(report.condition);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    const w = doc.getTextWidth(label) + 8;
    doc.setFillColor(...C.tint);
    doc.setDrawColor(...C.accent);
    doc.setLineWidth(0.3);
    doc.roundedRect(col2, 52.8, w, 6.4, 3.2, 3.2, 'FD');
    doc.setTextColor(...C.accent);
    doc.text(label, col2 + 4, 57.2);
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.setTextColor(...C.muted);
    doc.text('Not recorded', col2, 56.5);
  }
}

function drawKpis(doc, report) {
  const t = report.totals;
  const tiles = [
    ['Total Manpower', t.total, true],
    ['Skilled', t.skilled, false],
    ['Unskilled', t.unskilled, false],
    ['Total Activities', t.activities, false],
  ];
  const gap = 4;
  const w = (PAGE_W - MARGIN * 2 - gap * 3) / 4;
  const y = 66;
  const h = 20;
  tiles.forEach(([label, value, primary], i) => {
    const x = MARGIN + i * (w + gap);
    doc.setLineWidth(0.3);
    doc.setDrawColor(...(primary ? C.primary : C.border));
    doc.setFillColor(...(primary ? C.primary : C.subtle));
    doc.roundedRect(x, y, w, h, 2.5, 2.5, 'FD');
    doc.setTextColor(...(primary ? C.white : C.primary));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.text(String(value), x + w / 2, y + 10.5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...(primary ? C.white : C.muted));
    doc.text(label.toUpperCase(), x + w / 2, y + 16, { align: 'center' });
  });
  return y + h;
}

function tableBody(report) {
  const body = [];
  let seq = 0;
  const pad = { top: 2.2, bottom: 2.2, right: 2.2 };
  // The main-activity row carries the group's aggregate totals (there is no
  // separate subtotal row); its sub-activities are indented underneath.
  const groupStyle = { fillColor: C.groupRow, textColor: C.primary, fontStyle: 'bold' };
  report.groups.forEach((g) => {
    if (g.collapsed) {
      const r = g.rows[0];
      seq += 1;
      body.push([
        seq,
        { content: pdfText(g.name), styles: { fontStyle: 'bold' } },
        r.skilled, r.unskilled,
        { content: r.total, styles: { fontStyle: 'bold' } },
        pdfText(r.note),
      ]);
      return;
    }
    body.push([
      { content: '', styles: groupStyle },
      { content: pdfText(g.name), styles: groupStyle },
      { content: g.totals.skilled, styles: groupStyle },
      { content: g.totals.unskilled, styles: groupStyle },
      { content: g.totals.total, styles: groupStyle },
      { content: '', styles: groupStyle },
    ]);
    g.rows.forEach((r) => {
      seq += 1;
      body.push([
        seq,
        { content: pdfText(r.name), styles: { cellPadding: { ...pad, left: r.isSub ? 7 : 2.2 } } },
        r.skilled, r.unskilled,
        r.total,
        pdfText(r.note),
      ]);
    });
  });
  if (!body.length) {
    body.push([{ content: 'No manpower recorded for this DPR.', colSpan: 6, styles: { halign: 'center', textColor: C.muted, fontStyle: 'italic' } }]);
  }
  return body;
}

// Starts a titled section at the current Y (after the previous table),
// moving to a new page if the heading + a few rows wouldn't fit.
function sectionStart(doc, title, minSpace) {
  const pageH = doc.internal.pageSize.getHeight();
  let y = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 100) + 10;
  if (y > pageH - minSpace) { doc.addPage(); y = 20; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...C.primary);
  doc.text(title.toUpperCase(), MARGIN, y);
  return y + 3;
}

const TABLE_STYLES = { font: 'helvetica', fontSize: 8, cellPadding: 1.8, textColor: C.text, lineColor: C.border, lineWidth: 0.2, valign: 'middle', overflow: 'linebreak' };

function drawConsumption(doc, report, autoTable, drawFooter) {
  const c = report.consumption;
  if (!c || !c.entries.length) return;

  let y = sectionStart(doc, 'Consumption Entries', 60);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, top: 16, bottom: 16 },
    theme: 'grid',
    head: [['#', 'Material', 'Qty', 'Unit', 'Ownership', 'Contractor', 'Output / Work Done', 'Remarks']],
    body: c.entries.map((e, i) => {
      const ref = e.ownership !== TRUST;
      const ownColor = e.ownership === 'Contractor' ? C.contractor : e.ownership === 'Other' ? C.other : C.primary;
      return [
        i + 1,
        { content: pdfText(e.material), styles: { fontStyle: 'bold' } },
        formatQty(e.qty),
        pdfText(e.unit),
        { content: e.ownership, styles: { textColor: ownColor, fontStyle: 'bold' } },
        pdfText(e.contractor),
        pdfText(formatOutput(e.outputQty, e.outputUnit)),
        { content: pdfText(e.remarks), styles: ref ? { textColor: C.muted } : {} },
      ];
    }),
    showHead: 'everyPage',
    styles: TABLE_STYLES,
    headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 7, halign: 'center', textColor: C.muted },
      1: { cellWidth: 30 },
      2: { cellWidth: 13, halign: 'right' },
      3: { cellWidth: 13 },
      4: { cellWidth: 20 },
      5: { cellWidth: 27 },
      6: { cellWidth: 25 },
      7: { textColor: C.muted },
    },
    didParseCell: (data) => {
      if (data.section === 'head' && data.column.index === 2) data.cell.styles.halign = 'right';
      // Reference-only rows get a faint tint so they read as "not ours".
      if (data.section === 'body' && c.entries[data.row.index] && c.entries[data.row.index].ownership !== TRUST) {
        data.cell.styles.fillColor = C.subtle;
      }
    },
    didDrawPage: drawFooter,
  });

  y = sectionStart(doc, 'Trust Material Total', 40);
  if (c.trustTotals.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN, top: 16, bottom: 16 },
      tableWidth: 110,
      theme: 'grid',
      head: [['Material', 'Total Qty', 'Unit']],
      body: c.trustTotals.map(t => [pdfText(t.material), { content: formatQty(t.qty), styles: { fontStyle: 'bold' } }, pdfText(t.unit)]),
      styles: { ...TABLE_STYLES, fontSize: 8.5 },
      headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: { 1: { halign: 'right', cellWidth: 26 }, 2: { cellWidth: 22 } },
      didParseCell: (data) => { if (data.section === 'head' && data.column.index === 1) data.cell.styles.halign = 'right'; },
      didDrawPage: drawFooter,
    });
    y = doc.lastAutoTable.finalY + 5;
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(...C.muted);
    doc.text('No Trust-supplied material in this DPR.', MARGIN, y + 5);
    y += 10;
  }

  const excluded = c.counts.Contractor + c.counts.Other;
  if (excluded > 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    doc.text(`${excluded} Contractor/Other entr${excluded === 1 ? 'y is' : 'ies are'} listed for reference and excluded from the Trust total.`, MARGIN, y + 1);
  }
}

function buildPdf(report, { jsPDF, autoTable }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: report.dprNo, subject: REPORT_TITLE, author: ORG_NAME, creator: 'Trimandir DPR' });

  drawHeader(doc, report);
  drawMeta(doc, report);
  const kpiBottom = drawKpis(doc, report);
  const t = report.totals;
  const generated = new Date(report.generatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const drawFooter = () => {
    const pageH = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...C.border);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, pageH - 11, PAGE_W - MARGIN, pageH - 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.muted);
    doc.text(pdfText(report.dprNo), MARGIN, pageH - 6.5);
    doc.text(`Generated ${pdfText(generated)}`, PAGE_W / 2, pageH - 6.5, { align: 'center' });
    doc.text(`Page ${doc.internal.getNumberOfPages()} of ${TOTAL_PAGES}`, PAGE_W - MARGIN, pageH - 6.5, { align: 'right' });
  };

  autoTable(doc, {
    startY: kpiBottom + 7,
    margin: { left: MARGIN, right: MARGIN, top: 16, bottom: 16 },
    theme: 'grid',
    head: [['#', 'Activity', 'Skilled', 'Unskilled', 'Total', 'Remarks']],
    body: tableBody(report),
    foot: [['', 'Grand Total', t.skilled, t.unskilled, t.total, '']],
    showHead: 'everyPage',
    showFoot: 'lastPage',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.2, textColor: C.text, lineColor: C.border, lineWidth: 0.2, valign: 'middle', overflow: 'linebreak' },
    headStyles: { fillColor: C.primary, textColor: C.white, fontStyle: 'bold', fontSize: 8.5 },
    footStyles: { fillColor: C.primary, textColor: C.white, fontStyle: 'bold', fontSize: 10 },
    columnStyles: {
      0: { cellWidth: 9, halign: 'center', textColor: C.muted },
      2: { cellWidth: 18, halign: 'right' },
      3: { cellWidth: 20, halign: 'right' },
      4: { cellWidth: 17, halign: 'right' },
      5: { cellWidth: 50, fontSize: 8, textColor: C.muted },
    },
    didParseCell: (data) => {
      // Right-align the numeric header/footer cells to match their columns.
      if ((data.section === 'head' || data.section === 'foot') && [2, 3, 4].includes(data.column.index)) {
        data.cell.styles.halign = 'right';
      }
    },
    didDrawPage: drawFooter,
  });

  drawConsumption(doc, report, autoTable, drawFooter);

  if (typeof doc.putTotalPages === 'function') doc.putTotalPages(TOTAL_PAGES);
  return doc;
}

export async function buildPdfBlob(report) {
  return buildPdf(report, await preloadExportLibs()).output('blob');
}

export async function exportPdf(report) {
  const libs = await preloadExportLibs();
  buildPdf(report, libs).save(`${report.dprNo}.pdf`);
}

// ── Native share sheet (file-based) ──────────────────────────────────
//
// Both files start rendering when the Share chooser opens, so by the time
// the user picks one it's usually ready and navigator.share() runs while
// the pick still counts as a user gesture — iOS Safari rejects share()
// once that window has passed, and a high-res JPG render can outlast it.

const shareFileCache = new WeakMap();

export function prepareShareFiles(report) {
  let entry = shareFileCache.get(report);
  if (!entry) {
    const forget = () => shareFileCache.delete(report); // never cache a failed render
    entry = {
      jpg: renderJpgBlob(report).then(b => new File([b], `${report.dprNo}.jpg`, { type: 'image/jpeg' })),
      pdf: buildPdfBlob(report).then(b => new File([b], `${report.dprNo}.pdf`, { type: 'application/pdf' })),
    };
    entry.jpg.catch(forget);
    entry.pdf.catch(forget);
    shareFileCache.set(report, entry);
  }
  return entry;
}

// True when this browser can hand a file to the OS share sheet (and so on
// to WhatsApp etc.); false on most desktop browsers, where Share downloads.
export function canShareFiles() {
  try {
    return typeof navigator !== 'undefined' && !!navigator.share && !!navigator.canShare &&
      navigator.canShare({ files: [new File(['x'], 'check.pdf', { type: 'application/pdf' })] });
  } catch (e) {
    return false;
  }
}

// Returns 'shared' | 'downloaded' | 'cancelled'.
export async function shareReportFile(report, format) {
  const file = await prepareShareFiles(report)[format];
  if (!canShareFiles() || !navigator.canShare({ files: [file] })) {
    downloadBlob(file, file.name);
    return 'downloaded';
  }
  try {
    await navigator.share({
      files: [file],
      title: `${report.dprNo} — ${report.displayDate}`,
      text: `${REPORT_TITLE} · ${report.siteDisplay} · ${report.displayDate}`,
    });
    return 'shared';
  } catch (err) {
    if (err && err.name === 'AbortError') return 'cancelled';
    // NotAllowedError (gesture expired) / payload rejected — still give them the file.
    downloadBlob(file, file.name);
    return 'downloaded';
  }
}

// ── One entry point for every action button / menu item ─────────────

export const REPORT_ACTIONS = [
  { kind: 'jpg', label: 'JPG (High-res)', icon: '🖼️' },
  { kind: 'pdf', label: 'PDF', icon: '📄' },
  { kind: 'share', label: 'Share', icon: '📤' },
];

export const SHARE_FORMATS = [
  { format: 'jpg', label: 'Share as JPG (High-res)', icon: '🖼️' },
  { format: 'pdf', label: 'Share as PDF', icon: '📄' },
];

// kind: 'jpg' | 'pdf' (download) or 'share-jpg' | 'share-pdf'. The bare
// 'share' action is the format chooser, handled by ReportActionBar.
export async function runReportAction(kind, report, toast = () => {}) {
  try {
    if (kind === 'jpg') {
      toast('⏳ Rendering high-res JPG...');
      await exportJpg(report);
      toast(`🖼️ ${report.dprNo}.jpg downloaded`);
    } else if (kind === 'pdf') {
      toast('⏳ Building PDF...');
      await exportPdf(report);
      toast(`📄 ${report.dprNo}.pdf downloaded`);
    } else if (kind === 'share-jpg' || kind === 'share-pdf') {
      const format = kind.slice('share-'.length);
      const result = await shareReportFile(report, format);
      if (result === 'downloaded') toast(`📥 Sharing isn't available here — ${report.dprNo}.${format} downloaded instead`);
      else if (result === 'shared') toast('📤 Shared');
    }
  } catch (err) {
    console.error(`Report action "${kind}" failed:`, err);
    const label = kind.startsWith('share-')
      ? `Share (${kind.slice('share-'.length).toUpperCase()})`
      : ((REPORT_ACTIONS.find(a => a.kind === kind) || {}).label || kind);
    toast(`⚠️ ${label} failed — ${err && err.message ? err.message : 'try again'}`);
  }
}
