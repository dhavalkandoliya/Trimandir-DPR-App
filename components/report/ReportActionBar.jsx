'use client';

import { useEffect, useRef, useState } from 'react';
import {
  canShareFiles, prepareShareFiles, preloadExportLibs, REPORT_ACTIONS, runReportAction, SHARE_FORMATS,
} from '../../lib/report/exportReport';

const defaultToast = (msg) => window.showToast?.(msg);
const IDLE = { jpg: 'pending', pdf: 'pending' };

// [JPG (High-res)] [PDF] [Share ▾] — the single export surface for a report,
// used by the Entry preview and the History View modal. Share opens a small
// chooser (JPG or PDF) and hands the chosen file to the OS share sheet.
export default function ReportActionBar({ report, toast = defaultToast, autoOpenShare = false }) {
  const [busy, setBusy] = useState(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [fileState, setFileState] = useState(IDLE); // per format: 'pending' | 'ready' | 'error'
  const [shareSupported, setShareSupported] = useState(true);
  const wrapRef = useRef(null);
  const shareBtnRef = useRef(null);

  useEffect(() => {
    // Warm the export libraries; a failure here is retried on click.
    preloadExportLibs().catch(() => {});
    setShareSupported(canShareFiles());
  }, []);

  // Start rendering both files the moment the chooser opens, so whichever
  // the user picks is (usually) ready and navigator.share() still runs
  // inside the tap's user-gesture window.
  const openChooser = () => {
    setChooserOpen(true);
    setFileState(IDLE);
    const files = prepareShareFiles(report);
    SHARE_FORMATS.forEach(({ format }) => {
      files[format].then(
        () => setFileState(s => ({ ...s, [format]: 'ready' })),
        () => setFileState(s => ({ ...s, [format]: 'error' })),
      );
    });
  };

  const closeChooser = (restoreFocus) => {
    setChooserOpen(false);
    if (restoreFocus) shareBtnRef.current?.focus();
  };

  useEffect(() => {
    setChooserOpen(false);
    setFileState(IDLE);
    if (autoOpenShare) openChooser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, autoOpenShare]);

  useEffect(() => {
    if (!chooserOpen) return undefined;
    wrapRef.current?.querySelector('.share-chooser-option')?.focus();
    const onPointer = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) closeChooser(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [chooserOpen]);

  const run = async (kind) => {
    if (busy) return;
    setBusy(kind);
    try {
      await runReportAction(kind, report, toast);
    } finally {
      setBusy(null);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && chooserOpen) {
      e.stopPropagation(); // close just the chooser, not an enclosing modal
      closeChooser(true);
    }
  };

  const statusLabel = { pending: 'Preparing…', ready: 'Ready', error: 'Retry' };

  return (
    <div className="report-actions-wrap" ref={wrapRef} onKeyDown={onKeyDown}>
      <div className="report-actions" role="toolbar" aria-label="Export and share report">
        {REPORT_ACTIONS.map(a => {
          const isShare = a.kind === 'share';
          const isBusy = isShare ? !!busy && busy.startsWith('share-') : busy === a.kind;
          return (
            <button
              key={a.kind}
              ref={isShare ? shareBtnRef : undefined}
              type="button"
              className={`report-action is-${a.kind}`}
              onClick={isShare ? () => (chooserOpen ? closeChooser(false) : openChooser()) : () => run(a.kind)}
              disabled={!!busy}
              aria-busy={isBusy}
              {...(isShare ? { 'aria-haspopup': 'menu', 'aria-expanded': chooserOpen } : {})}
            >
              <span aria-hidden="true">{isBusy ? '⏳' : a.icon}</span> {a.label}{isShare ? ' ▾' : ''}
            </button>
          );
        })}
      </div>

      {chooserOpen && (
        <div className="share-chooser" role="menu" aria-label="Share report as">
          <div className="share-chooser-title">Share report as…</div>
          {SHARE_FORMATS.map(({ format, label, icon }) => (
            <button
              key={format}
              type="button"
              role="menuitem"
              className="share-chooser-option"
              onClick={() => { closeChooser(false); run(`share-${format}`); }}
            >
              <span aria-hidden="true">{icon}</span>
              <span className="share-chooser-label">{label}</span>
              <span className={`share-chooser-status is-${fileState[format]}`}>{statusLabel[fileState[format]]}</span>
            </button>
          ))}
          {!shareSupported && (
            <p className="share-chooser-note">This browser can&apos;t open the share sheet — the file will download instead.</p>
          )}
        </div>
      )}
    </div>
  );
}
