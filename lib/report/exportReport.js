// Client-side exporters for the Executive DPR report. Everything here is
// built from the report model (lib/report/reportModel.js) — the PDF is drawn
// as real vector text/tables and only the JPG rasterises the rendered
// ExecutiveReport component. Share hands either file to navigator.share().

import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import ExecutiveReport from '../../components/report/ExecutiveReport';
import { ORG_NAME, REPORT_TITLE, formatDateTime } from './reportModel';
import { TRUST, formatOutput, formatQty } from '../materials/consumption';

const CAPTURE_WIDTH_PX = 820;
const JPG_MAX_SCALE = 3;
const JPG_MAX_PIXELS = 16_000_000; // stay under iOS Safari's canvas area limit

// Fixed paper palette — matches .report in globals.css.
const C = {
  ink: [21, 33, 43],
  ink2: [59, 73, 85],
  muted: [104, 118, 128],
  line: [203, 211, 208],
  soft: [242, 245, 244],
  zebra: [248, 250, 249],
  footFill: [231, 236, 234],
  sideInk: [201, 211, 218],
  primary: [31, 78, 121],
  hivis: [245, 197, 24],
  white: [255, 255, 255],
};
const CONDITION_RGB = {
  Sunny: [214, 158, 11], Cloudy: [100, 116, 139], Rainy: [43, 108, 176], 'Site Closed': [192, 57, 43], Holiday: [124, 77, 191],
};
const OWNER_RGB = { Trust: C.primary, Contractor: [154, 98, 18], Other: C.ink2 };

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
      windowWidth: 1280, // desktop media queries: the card itself is fixed at CAPTURE_WIDTH_PX
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
//
// Mirrors the on-screen paper card: hazard stripe, dark letterhead with
// the report number, 2×2 meta grid, KPI strip, zebra manpower table with
// main-activity rows carrying their group totals, site notes, the
// consumption annex, sign-off lines and a footer on every page.

const PAGE_W = 210;
const MARGIN = 14;
const FOOT_SPACE = 18; // keep content clear of the per-page footer

function drawStripe(doc) {
  const h = 2.5, w = 3.175; // 45° bands, as .stripe
  doc.setFillColor(...C.hivis);
  doc.rect(0, 0, PAGE_W, h, 'F');
  doc.setFillColor(...C.ink);
  for (let x = -h; x < PAGE_W + w; x += w * 2) {
    doc.triangle(x, 0, x + w, 0, x - h, h, 'F');
    doc.triangle(x + w, 0, x + w - h, h, x - h, h, 'F');
  }
}

function drawHeader(doc, report) {
  drawStripe(doc);
  doc.setFillColor(...C.ink);
  doc.rect(0, 2.5, PAGE_W, 25, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...C.sideInk);
  doc.text(pdfText(ORG_NAME), MARGIN, 11.5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(...C.white);
  doc.text(pdfText(REPORT_TITLE), MARGIN, 21, { maxWidth: 118 });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...C.sideInk);
  doc.text('Report no.', PAGE_W - MARGIN, 12.5, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...C.white);
  doc.text(pdfText(report.dprNo), PAGE_W - MARGIN, 18.5, { align: 'right', maxWidth: 70 });
  if (report.draft) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.sideInk);
    doc.text('Draft preview', PAGE_W - MARGIN, 23.5, { align: 'right' });
  }
}

function drawMeta(doc, report) {
  const col2 = PAGE_W / 2 + 4;
  const maxW = col2 - MARGIN - 8;
  const label = (text, x, y) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    doc.text(text, x, y);
  };
  const value = (text, x, y) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...C.ink);
    doc.text(pdfText(text) || '-', x, y + 5.5, { maxWidth: maxW });
  };
  label('Date', MARGIN, 37); value(report.displayDate, MARGIN, 37);
  label('Site', col2, 37); value(report.siteDisplay, col2, 37);
  label('Prepared by', MARGIN, 50);
  value(report.preparedBy + (report.editedBy ? ` (edited by ${report.editedBy})` : ''), MARGIN, 50);
  label('Site condition', col2, 50);
  if (report.condition) {
    const rgb = CONDITION_RGB[report.condition] || C.primary;
    const text = pdfText(report.condition);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    const w = doc.getTextWidth(text) + 10;
    doc.setLineWidth(0.3);
    doc.setDrawColor(...rgb);
    doc.setFillColor(...rgb.map(c => Math.round(c * 0.12 + 255 * 0.88)));
    doc.roundedRect(col2, 51.8, w, 6, 3, 3, 'FD');
    doc.setFillColor(...rgb);
    doc.circle(col2 + 3.3, 54.8, 0.95, 'F');
    doc.setTextColor(...rgb.map(c => Math.round(c * 0.6)));
    doc.text(text, col2 + 6, 56.1);
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.setTextColor(...C.muted);
    doc.text('Not recorded', col2, 55.5);
  }
  doc.setDrawColor(...C.line);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, 62, PAGE_W - MARGIN, 62);
}

function drawKpis(doc, report) {
  const t = report.totals;
  const cells = [['Total manpower', t.total, 1.4], ['Skilled', t.skilled, 1], ['Unskilled', t.unskilled, 1], ['Activities', t.activities, 1]];
  const y = 67, h = 17, width = PAGE_W - MARGIN * 2;
  const unit = width / cells.reduce((s, c) => s + c[2], 0);
  doc.setLineWidth(0.3);
  doc.setDrawColor(...C.line);
  let x = MARGIN;
  cells.forEach(([label, value, weight], i) => {
    const w = unit * weight;
    if (i === 0) { doc.setFillColor(...C.soft); doc.rect(x, y, w, h, 'F'); } else doc.line(x, y, x, y + h);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...C.muted);
    doc.text(label, x + 3.5, y + 5.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(i === 0 ? 17 : 14);
    doc.setTextColor(...C.ink);
    doc.text(String(value), x + 3.5, y + 13.5);
    x += w;
  });
  doc.roundedRect(MARGIN, y, width, h, 1.5, 1.5, 'S');
  return y + h;
}

function heading(doc, title, y) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(...C.ink);
  doc.text(title, MARGIN, y);
  return y + 2.5;
}

function manpowerBody(report) {
  const body = [];
  const group = { fillColor: C.soft, fontStyle: 'bold' };
  report.groups.forEach((g) => {
    if (g.collapsed) {
      const r = g.rows[0];
      body.push([pdfText(g.name), r.skilled, r.unskilled, r.total].map(content => ({ content, styles: group })));
      return;
    }
    body.push([pdfText(g.name), g.totals.skilled, g.totals.unskilled, g.totals.total].map(content => ({ content, styles: group })));
    g.rows.forEach((r, i) => {
      const alt = i % 2 ? { fillColor: C.zebra } : {};
      body.push([
        { content: pdfText(r.name), styles: { ...alt, textColor: r.isSub ? C.ink2 : C.ink, cellPadding: { top: 1.8, bottom: 1.8, right: 2.5, left: r.isSub ? 7.5 : 2.5 } } },
        { content: r.skilled, styles: alt },
        { content: r.unskilled, styles: alt },
        { content: r.total, styles: alt },
      ]);
    });
  });
  return body;
}

const TABLE = {
  theme: 'grid',
  margin: { left: MARGIN, right: MARGIN, top: 14, bottom: FOOT_SPACE },
  showHead: 'everyPage',
  styles: { font: 'helvetica', fontSize: 9, cellPadding: { top: 1.8, bottom: 1.8, left: 2.5, right: 2.5 }, textColor: C.ink, lineColor: C.line, lineWidth: 0.2, valign: 'middle', overflow: 'linebreak' },
  headStyles: { fillColor: C.ink, textColor: C.white, fontStyle: 'bold', fontSize: 8.5 },
};

function buildPdf(report, { jsPDF, autoTable }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: report.dprNo, subject: REPORT_TITLE, author: ORG_NAME, creator: 'Trimandir DPR' });
  const pageH = doc.internal.pageSize.getHeight();
  const t = report.totals;
  let y;
  const ensure = (need) => { if (y + need > pageH - FOOT_SPACE) { doc.addPage(); y = 16; } };
  const afterTable = (gap = 9) => { y = doc.lastAutoTable.finalY + gap; };

  drawHeader(doc, report);
  drawMeta(doc, report);
  y = drawKpis(doc, report) + 9;

  // ── Manpower deployment ──
  y = heading(doc, 'Manpower deployment', y);
  const body = manpowerBody(report);
  const nonWorking = report.condition === 'Site Closed' || report.condition === 'Holiday';
  autoTable(doc, {
    ...TABLE,
    startY: y,
    head: [['Activity', 'Skilled', 'Unskilled', 'Total']],
    body: body.length ? body : [[{
      content: nonWorking ? `No manpower deployed - ${report.condition.toLowerCase()}.` : 'No manpower recorded for this report.',
      colSpan: 4, styles: { halign: 'center', textColor: C.muted, fontStyle: 'italic' },
    }]],
    foot: body.length ? [['Total manpower', t.skilled, t.unskilled, t.total]] : undefined,
    showFoot: 'lastPage',
    footStyles: { fillColor: C.footFill, textColor: C.ink, fontStyle: 'bold', fontSize: 9.5 },
    columnStyles: { 1: { halign: 'right', cellWidth: 24 }, 2: { halign: 'right', cellWidth: 26 }, 3: { halign: 'right', cellWidth: 22 } },
    didParseCell: (d) => { if ((d.section === 'head' || d.section === 'foot') && d.column.index > 0) d.cell.styles.halign = 'right'; },
    didDrawCell: (d) => {
      // The grand-total row sits under a heavy ink rule, as on screen.
      if (d.section === 'foot' && d.column.index === 0) {
        doc.setDrawColor(...C.ink);
        doc.setLineWidth(0.6);
        doc.line(MARGIN, d.cell.y, PAGE_W - MARGIN, d.cell.y);
      }
    },
  });
  afterTable();

  // ── Site notes ──
  const notes = [];
  report.groups.forEach(g => g.rows.forEach(r => { if (r.note) notes.push(`${r.isSub ? `${g.name} / ${r.name}` : g.name}: ${r.note}`); }));
  if (notes.length) {
    ensure(16);
    y = heading(doc, 'Site notes', y) + 3.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    notes.forEach(n => {
      const lines = doc.splitTextToSize(pdfText(n), PAGE_W - MARGIN * 2 - 5);
      const h = lines.length * 4.2;
      ensure(h + 2);
      doc.setFillColor(...C.line);
      doc.rect(MARGIN, y - 3.2, 0.9, h, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...C.ink2);
      doc.text(lines, MARGIN + 3.5, y);
      y += h + 2;
    });
    y += 4;
  }

  // ── Annex: material consumption ──
  const c = report.consumption;
  if (c && c.entries.length) {
    ensure(28);
    y = heading(doc, 'Annex: material consumption', y);
    autoTable(doc, {
      ...TABLE,
      startY: y,
      styles: { ...TABLE.styles, fontSize: 8 },
      headStyles: { ...TABLE.headStyles, fontSize: 7.5 },
      head: [['Material', 'Qty', 'Unit', 'Ownership', 'Contractor', 'Output', 'Remarks']],
      body: c.entries.map((e, i) => {
        const ref = e.ownership !== TRUST;
        const row = { ...(i % 2 ? { fillColor: C.zebra } : {}), ...(ref ? { textColor: C.muted } : {}) };
        return [
          { content: pdfText(e.material), styles: { ...row, fontStyle: 'bold' } },
          { content: formatQty(e.qty), styles: row },
          { content: pdfText(e.unit), styles: row },
          { content: e.ownership, styles: { ...row, fontStyle: 'bold', textColor: OWNER_RGB[e.ownership] || C.primary } },
          { content: pdfText(e.contractor), styles: row },
          { content: pdfText(formatOutput(e.outputQty, e.outputUnit)), styles: row },
          { content: pdfText(e.remarks), styles: row },
        ];
      }),
      columnStyles: { 0: { cellWidth: 34 }, 1: { cellWidth: 14, halign: 'right' }, 2: { cellWidth: 14 }, 3: { cellWidth: 21 }, 4: { cellWidth: 28 }, 5: { cellWidth: 22 } },
      didParseCell: (d) => { if (d.section === 'head' && d.column.index === 1) d.cell.styles.halign = 'right'; },
    });
    afterTable(8);

    ensure(20);
    y = heading(doc, 'Trust material total', y);
    if (c.trustTotals.length) {
      autoTable(doc, {
        ...TABLE,
        startY: y,
        tableWidth: 110,
        head: [['Material', 'Quantity', 'Unit']],
        body: c.trustTotals.map((tt, i) => {
          const alt = i % 2 ? { fillColor: C.zebra } : {};
          return [{ content: pdfText(tt.material), styles: alt }, { content: formatQty(tt.qty), styles: { ...alt, fontStyle: 'bold' } }, { content: pdfText(tt.unit), styles: alt }];
        }),
        columnStyles: { 1: { halign: 'right', cellWidth: 26 }, 2: { halign: 'right', cellWidth: 22 } },
        didParseCell: (d) => { if (d.section === 'head' && d.column.index > 0) d.cell.styles.halign = 'right'; },
      });
      afterTable(5);
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(...C.muted);
      doc.text('No Trust-supplied material in this report.', MARGIN, y + 4);
      y += 9;
    }
    const excluded = c.counts.Contractor + c.counts.Other;
    if (excluded > 0) {
      ensure(6);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(...C.muted);
      doc.text(`${excluded} Contractor/Other entr${excluded === 1 ? 'y is' : 'ies are'} listed for reference and excluded from the Trust total.`, MARGIN, y + 1);
      y += 6;
    }
  }

  // ── Sign-off lines, low on the last page ──
  ensure(26);
  y = Math.max(y + 16, pageH - FOOT_SPACE - 14);
  const signW = 70;
  doc.setDrawColor(...C.ink2);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, MARGIN + signW, y);
  doc.line(PAGE_W - MARGIN - signW, y, PAGE_W - MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...C.muted);
  doc.text(`Prepared by - ${pdfText(report.preparedBy) || '-'}`, MARGIN, y + 4.5, { maxWidth: signW });
  doc.text('Reviewed by - Project Manager', PAGE_W - MARGIN - signW, y + 4.5);

  // ── Footer on every page, with the real page count ──
  const submitted = report.draft ? 'Not submitted yet' : (formatDateTime(report.submittedAt) || '-');
  const footer = `${report.dprNo}  |  Submitted: ${submitted}  |  Generated ${formatDateTime(report.generatedAt)}`;
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, pageH - 11, PAGE_W - MARGIN, pageH - 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.muted);
    doc.text(pdfText(footer), MARGIN, pageH - 6.5, { maxWidth: PAGE_W - MARGIN * 2 - 28 });
    doc.text(`Page ${i} of ${pages}`, PAGE_W - MARGIN, pageH - 6.5, { align: 'right' });
  }
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
// to any installed app); false on most desktop browsers, where Share downloads.
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
