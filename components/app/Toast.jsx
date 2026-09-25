'use client';

import { useApp } from './AppContext';

// Warnings and failures ("⚠️ …", "❌ …") get the red toast.
const isError = (msg) => /^\s*(⚠️|❌|🔒)/u.test(String(msg || ''));

// The app's single toast. An action toast carries a button — e.g.
// "Edit existing DPR" on a duplicate save.
export default function Toast() {
  const { toast, hideToast } = useApp();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className={`toast${isError(toast.msg) ? ' err' : ''}`}>
          <span>{toast.msg}</span>
          {toast.action && (
            <button type="button" onClick={() => { hideToast(); toast.action.onClick(); }}>
              {toast.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
