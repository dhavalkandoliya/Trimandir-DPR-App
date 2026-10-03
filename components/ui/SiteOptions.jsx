'use client';

import { useMemo } from 'react';
import { reportingSiteGroups } from '../../lib/sites';

// <option>s for a "pick the site you're reporting on" <select>: active
// reporting sites only, grouped under their parent. A parent with
// sub-sites is a heading, not a choice (see lib/sites.js). `current` is
// kept as an extra option if it isn't one of them — e.g. editing a report
// filed on a parent site before sub-sites existed.
export default function SiteOptions({ projects, current = '' }) {
  const groups = useMemo(() => reportingSiteGroups(projects), [projects]);
  const known = groups.some(g => g.options.some(o => o.value === current));
  const opt = (o) => <option key={o.value} value={o.value}>{o.label}</option>;
  return (
    <>
      <option value="">{groups.length ? 'Choose site' : 'No sites available'}</option>
      {groups.map(g => (g.group
        ? <optgroup key={g.group} label={g.group}>{g.options.map(opt)}</optgroup>
        : g.options.map(opt)))}
      {current && !known && <option value={current}>{current}</option>}
    </>
  );
}
