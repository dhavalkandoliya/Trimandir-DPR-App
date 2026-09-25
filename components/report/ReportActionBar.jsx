'use client';

import { useEffect, useRef, useState } from 'react';
import {
  canShareFiles, prepareShareFiles, preloadExportLibs, runReportAction, SHARE_FORMATS,
} from '../../lib/report/exportReport';
import { useApp } from '../app/AppContext';
import Icon from '../ui/Icon';

const IDLE = { jpg: 'pending', pdf: 'pending' };
const FORMAT_ICON = { jpg: 'image', pdf: 'pdf' };

// Download image · Download PDF · Share ▾ — the single export surface for a
// report (Entry success view, History viewer). Share opens a small chooser
// (JPG or PDF) and hands the chosen file to the OS share sheet.
//
// layout="list" stacks full-width buttons (success view side panel);
// layout="row" lays them out inline (dialog footer).
export default function ReportActionBar({ report, toast: toastProp, autoOpenShare = false, layout = 'row' }) {
  const { showToast } = useApp();
  const toast = toastProp || showToast;
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
    wrapRef.current?.querySelector('.share-menu button')?.focus();
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
      e.stopPropagation(); // close just the chooser, not an enclosing dialog
      closeChooser(true);
    }
  };

  const status = {
    pending: <span className="tag">Preparing…</span>,
    ready: <span className="tag ok">Ready</span>,
    error: <span className="tag danger">Retry</span>,
  };
  const list = layout === 'list';
  const sharing = !!busy && busy.startsWith('share-');

  const share = (
    <div className="share-wrap" ref={wrapRef} onKeyDown={onKeyDown}>
      <button
        ref={shareBtnRef}
        type="button"
        className={`btn primary${list ? ' block' : ''}`}
        onClick={() => (chooserOpen ? closeChooser(false) : openChooser())}
        disabled={!!busy}
        aria-busy={sharing}
        aria-haspopup="menu"
        aria-expanded={chooserOpen}
      >
        <Icon name="share" />{sharing ? 'Sharing…' : list ? 'Share report' : 'Share'}
      </button>
      {chooserOpen && (
        <div className="share-menu" role="menu" aria-label="Share report as">
          <div className="mhead">Share report as…</div>
          {SHARE_FORMATS.map(({ format, label }) => (
            <button key={format} type="button" role="menuitem" onClick={() => { closeChooser(false); run(`share-${format}`); }}>
              <Icon name={FORMAT_ICON[format]} />
              <span>{label}</span>
              {status[fileState[format]]}
            </button>
          ))}
          {!shareSupported && <p>This browser can&apos;t open the share sheet — the file will download instead.</p>}
        </div>
      )}
    </div>
  );

  const pdf = (
    <button type="button" className="btn" onClick={() => run('pdf')} disabled={!!busy} aria-busy={busy === 'pdf'}>
      <Icon name="pdf" />{busy === 'pdf' ? 'Building PDF…' : list ? 'Download PDF (A4)' : 'PDF'}
    </button>
  );
  const jpg = (
    <button type="button" className="btn" onClick={() => run('jpg')} disabled={!!busy} aria-busy={busy === 'jpg'}>
      <Icon name="image" />{busy === 'jpg' ? 'Rendering…' : list ? 'Download image (JPG)' : 'Image'}
    </button>
  );

  return list
    ? <div className="action-list" role="toolbar" aria-label="Export and share report">{share}{pdf}{jpg}</div>
    : <div className="report-actions" role="toolbar" aria-label="Export and share report">{jpg}{pdf}{share}</div>;
}
