'use client';

// <option>s for a "filter by site" <select> in the DPR and Materials logs
// (lib/sites.js siteFilterOptions()): "All sites", the active sites, then
// archived (inactive) ones in their own group at the bottom — their
// reports stay findable. `extra` adds options for log rows that name no
// current site.
export default function SiteFilterOptions({ options, extra = [] }) {
  const opt = (o) => <option key={o.value} value={o.value}>{o.label}</option>;
  return (
    <>
      <option value="">All sites</option>
      {options.active.map(opt)}
      {options.archived.length > 0 && <optgroup label="Archived / Inactive">{options.archived.map(opt)}</optgroup>}
      {extra.length > 0 && <optgroup label="Not linked to a site">{extra.map(opt)}</optgroup>}
    </>
  );
}
