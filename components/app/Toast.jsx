'use client';

import { useApp } from './AppContext';

// The app's single toast (#toast styles in globals.css). An action toast
// carries a button — e.g. "Edit existing DPR" on a duplicate save.
export default function Toast() {
  const { toast, hideToast } = useApp();
  const cls = `${toast ? 'show' : ''}${toast && toast.action ? ' with-action' : ''}`;
  return (
    <div id="toast" className={cls} role="status" aria-live="polite">
      {toast && <span>{toast.msg}</span>}
      {toast && toast.action && (
        <button type="button" className="toast-action-btn" onClick={() => { hideToast(); toast.action.onClick(); }}>
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
