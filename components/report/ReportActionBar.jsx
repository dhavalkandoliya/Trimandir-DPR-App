'use client';

import { useEffect, useState } from 'react';
import { preloadExportLibs, REPORT_ACTIONS, runReportAction } from '../../lib/report/exportReport';

const defaultToast = (msg) => window.showToast?.(msg);

// [JPG (High-res)] [PDF] [WhatsApp] [Share] — the single export surface for
// a report, used by the Entry preview and the History View modal.
export default function ReportActionBar({ report, toast = defaultToast }) {
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    // Warm the export libraries so Share can open the OS sheet while the
    // click is still a user gesture. Failure here is retried on click.
    preloadExportLibs().catch(() => {});
  }, []);

  const run = async (kind) => {
    if (busy) return;
    setBusy(kind);
    try {
      await runReportAction(kind, report, toast);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="report-actions" role="toolbar" aria-label="Export and share report">
      {REPORT_ACTIONS.map(a => (
        <button
          key={a.kind}
          type="button"
          className={`report-action is-${a.kind}`}
          onClick={() => run(a.kind)}
          disabled={!!busy}
          aria-busy={busy === a.kind}
        >
          <span aria-hidden="true">{busy === a.kind ? '⏳' : a.icon}</span> {a.label}
        </button>
      ))}
    </div>
  );
}
