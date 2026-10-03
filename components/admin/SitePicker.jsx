'use client';

import { useState } from 'react';
import { childrenOf, isTopLevel } from '../../lib/sites';

// Tick the sites something covers: a supervisor (user_sites) or a
// contractor (site_contractors). A ticked parent covers all of its
// sub-sites, so they show as included.
export default function SitePicker({ selected = [], projects, busy, onSave, onCancel }) {
  const [picked, setPicked] = useState(() => new Set(selected.map(String)));
  const toggle = (id) => setPicked(cur => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const box = (p, inherited) => {
    const id = String(p.id);
    return (
      <label key={id} className={`site-pick${isTopLevel(p) ? '' : ' sub'}`}>
        <input type="checkbox" checked={inherited || picked.has(id)} disabled={inherited} onChange={() => toggle(id)} />
        <span>{p.project_name}{p.status === 'inactive' ? ' (inactive)' : ''}{inherited ? <em> — included</em> : null}</span>
      </label>
    );
  };
  const tops = projects.filter(isTopLevel);
  return (
    <div className="stack">
      <div className="site-picker">
        {!tops.length && <p className="muted">No sites yet — add them under Sites.</p>}
        {tops.map(top => {
          const covered = picked.has(String(top.id));
          return (
            <div key={top.id}>
              {box(top, false)}
              {childrenOf(top, projects).map(s => box(s, covered))}
            </div>
          );
        })}
      </div>
      <div className="row">
        <button type="button" className="btn sm primary" onClick={() => onSave([...picked].map(Number))} disabled={busy}>Save sites</button>
        <button type="button" className="btn sm ghost" onClick={onCancel}>Cancel</button>
        <span className="hint">Ticking a parent site covers all of its sub-sites.</span>
      </div>
    </div>
  );
}

// "Dahod_Trimandir › Mandir, Vasad Trimandir (all)" for a list of project ids.
export function siteNames(ids, projects) {
  const byId = new Map(projects.map(p => [String(p.id), p]));
  return (ids || []).map(id => byId.get(String(id))).filter(Boolean).map(p => {
    const parent = byId.get(String(p.parent_id || ''));
    return parent ? `${parent.project_name} › ${p.project_name}` : (childrenOf(p, projects).length ? `${p.project_name} (all)` : p.project_name);
  });
}
