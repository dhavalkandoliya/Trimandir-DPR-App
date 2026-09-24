'use client';

import { AppProvider } from '../components/app/AppContext';
import AppShell from '../components/app/AppShell';

// The whole DPR app is React now — the legacy index.html script that used
// to be injected here (via generate_final.ps1) is gone.
export default function Page() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
