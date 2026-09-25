'use client';

import { useState } from 'react';
import { useApp } from '../app/AppContext';
import Icon from './Icon';

// "Export: CSV · Excel · PDF" for a page's log. `formats` is a list of
// { kind, label, run } where run() does the download (sync or async);
// `count` is how many records the current filter covers.
export default function ExportButtons({ formats, count, noun, plural = `${noun}s` }) {
  const n = (c) => (c === 1 ? noun : plural);
  const { showToast } = useApp();
  const [busy, setBusy] = useState(null);

  const run = async (f) => {
    if (busy) return;
    if (!count) { showToast(`⚠️ No ${plural} to export`); return; }
    setBusy(f.kind);
    try {
      await f.run();
      showToast(`✅ ${f.label} exported (${count} ${n(count)})`);
    } catch (err) {
      showToast(`⚠️ ${f.label} export failed — ${err.message || 'try again'}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="row" role="group" aria-label={`Export ${noun} log`}>
      {formats.map(f => (
        <button key={f.kind} type="button" className="btn" onClick={() => run(f)} disabled={!!busy} title={`Export the ${count} ${n(count)} shown as ${f.label}`}>
          <Icon name={f.kind === 'pdf' ? 'pdf' : 'down'} />{busy === f.kind ? 'Exporting…' : f.label}
        </button>
      ))}
    </div>
  );
}
