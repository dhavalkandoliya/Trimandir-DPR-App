'use client';

import { useCallback, useState } from 'react';
import { apiMutate } from '../../lib/client/api';
import { useApp } from '../app/AppContext';

// Every admin write goes through here: one in-flight action at a time,
// success toast only when the server actually said ok, the error message
// when it didn't, and a master-data refresh afterwards. (The old panel
// toasted success for most actions without checking the response.)
export function useAdminAction() {
  const { showToast, reloadMaster } = useApp();
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (body, { success, pending = '⏳ Saving...', refresh = true } = {}) => {
    if (busy) return false;
    setBusy(true);
    showToast(pending);
    try {
      const res = await apiMutate(body);
      if (refresh) await reloadMaster();
      if (success) showToast(success);
      return res || true;
    } catch (err) {
      showToast(`⚠️ ${err.message || 'Action failed'}`);
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, showToast, reloadMaster]);

  return { run, busy };
}
