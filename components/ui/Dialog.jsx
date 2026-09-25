'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

// Modal dialog (.scrim/.dialog in globals.css): portalled to <body>,
// Escape / backdrop click to close, Tab kept inside, focus returned to
// the trigger on close. `paper` gives the body the grey report backdrop.
export default function Dialog({ title, onClose, footer, paper = false, narrow = false, children }) {
  const boxRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const trigger = document.activeElement;
    const box = boxRef.current;
    (box?.querySelector('input, select, textarea') || box?.querySelector('[data-close]'))?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') { closeRef.current(); return; }
      if (e.key !== 'Tab' || !box) return;
      const focusables = box.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (trigger && document.body.contains(trigger)) trigger.focus();
    };
  }, []);

  return createPortal(
    <div className="scrim" role="presentation" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dialog${paper ? ' paper' : ''}${narrow ? ' narrow' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={boxRef}>
        <div className="dialog-head">
          <h2 className="panel-title">{title}</h2>
          <button type="button" className="icon-btn" data-close aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
