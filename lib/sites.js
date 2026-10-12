// Site hierarchy rules shared by the server (scoping) and every screen
// (dashboard, site dropdowns, filters), so they all agree on what a
// "site" is.
//
// Projects form a parent → sub-site tree (getProjects() rows: id,
// project_name, parent_id, status). A project with sub-sites is a
// container: work is reported on its sub-sites, never on the parent, so
// it is not a reporting site. A project without sub-sites is one.
//
// IDENTITY: a site is identified by its PATH — every ancestor's name and
// its own, joined by " › " ("Vasad_Trimandir › Temple"; a top-level site's
// path is just its name). Sub-site names repeat across projects (Surat and
// Vasad both have "Temple"), so a bare project_name is NEVER used to find,
// match or filter a site. The path is what dpr_records.site and
// material_logs.site store (migrations/009), what every dropdown option's
// value is, and what every filter compares. Sibling names are unique
// (server addProject/updateProject + the 009 index), so paths are too.

export const SITE_SEP = ' › ';

const idOf = (v) => String(v ?? '').trim();
const nameOf = (p) => String(p.project_name ?? '').trim();
// Comparison key for a stored/selected site path.
export const siteKey = (v) => String(v ?? '').trim().toLowerCase();
export const isTopLevel = (p) => !idOf(p.parent_id);

export function childrenOf(project, projects) {
  const id = idOf(project.id);
  return projects.filter(p => idOf(p.parent_id) === id);
}

// Any sub-site, active or not, makes a project a container.
export function isContainer(project, projects) {
  const id = idOf(project.id);
  return projects.some(p => idOf(p.parent_id) === id);
}

// Map of project id → canonical path, for the whole list.
export function sitePaths(projects) {
  const byId = new Map(projects.map(p => [idOf(p.id), p]));
  const paths = new Map();
  const pathOf = (p) => {
    const id = idOf(p.id);
    if (paths.has(id)) return paths.get(id);
    paths.set(id, nameOf(p)); // cycle guard
    const parent = byId.get(idOf(p.parent_id));
    const path = parent && parent !== p ? pathOf(parent) + SITE_SEP + nameOf(p) : nameOf(p);
    paths.set(id, path);
    return path;
  };
  projects.forEach(pathOf);
  return paths;
}

export const sitePath = (project, projects) => sitePaths(projects).get(idOf(project.id)) || nameOf(project);

// The project a stored/selected path names — exact path only, never a bare
// sub-site name. null when nothing matches.
export function projectByPath(path, projects) {
  const key = siteKey(path);
  if (!key) return null;
  const paths = sitePaths(projects);
  return projects.find(p => siteKey(paths.get(idOf(p.id))) === key) || null;
}

// Reporting sites in the list's tree order: { value, label, name, project }.
// value and label are the path; name is the project's own name.
export function reportingSites(projects, { activeOnly = true } = {}) {
  const byId = new Map(projects.map(p => [idOf(p.id), p]));
  const paths = sitePaths(projects);
  const ordered = [];
  const seen = new Set();
  const visit = (p) => {
    if (seen.has(idOf(p.id))) return;
    seen.add(idOf(p.id));
    ordered.push(p);
    childrenOf(p, projects).forEach(visit);
  };
  projects.filter(p => isTopLevel(p) || !byId.has(idOf(p.parent_id))).forEach(visit);
  return ordered
    .filter(p => !isContainer(p, projects) && (!activeOnly || p.status === 'active'))
    .map(p => ({ value: paths.get(idOf(p.id)), label: paths.get(idOf(p.id)), name: nameOf(p), project: p }));
}

// Reporting sites grouped under their parent, for <optgroup> dropdowns:
// [{ group: 'Parent path' | '', groupId, options: [{ value: path, label: name }] }].
export function reportingSiteGroups(projects, opts) {
  const paths = sitePaths(projects);
  const groups = [];
  reportingSites(projects, opts).forEach(({ value, name, project }) => {
    const groupId = idOf(project.parent_id) && paths.has(idOf(project.parent_id)) ? idOf(project.parent_id) : '';
    let g = groups[groups.length - 1];
    if (!g || g.groupId !== groupId) groups.push(g = { group: groupId ? paths.get(groupId) : '', groupId, options: [] });
    g.options.push({ value, label: groupId ? name : value });
  });
  return groups;
}

// Site paths a filter on `path` should match (lowercased, siteKey()): the
// site itself, plus every descendant when it is a container. A path that
// names no project matches only itself (e.g. a legacy row's text).
export function siteFilterPaths(path, projects) {
  const keys = new Set([siteKey(path)]);
  const proj = projectByPath(path, projects);
  if (proj) {
    const paths = sitePaths(projects);
    const stack = [proj];
    while (stack.length) {
      childrenOf(stack.pop(), projects).forEach(c => { keys.add(siteKey(paths.get(idOf(c.id)))); stack.push(c); });
    }
  }
  return keys;
}

// <option>s for a "filter by site" <select> ({ value: path, label }): every
// top-level project, then its sub-sites indented under it. A parent
// filters to all of its sub-sites (siteFilterPaths()).
export function siteFilterOptions(projects) {
  const paths = sitePaths(projects);
  const tops = projects.filter(isTopLevel);
  return tops.flatMap(top => [
    { value: paths.get(idOf(top.id)), label: nameOf(top) + (isContainer(top, projects) ? ' — all sub-sites' : '') + (top.status === 'inactive' ? ' (inactive)' : '') },
    ...childrenOf(top, projects)
      .map(s => ({ value: paths.get(idOf(s.id)), label: `  ↳ ${nameOf(s)}${s.status === 'inactive' ? ' (inactive)' : ''}` })),
  ]);
}

// A user's scope from their assigned project ids: an assigned project
// covers itself and everything under it. Returns
//   projects  — what the user may see: covered projects plus their
//               ancestors (so "Parent › Sub-site" labels still resolve;
//               an ancestor always keeps a child in the list, so it stays
//               a container and is never offered as a site)
//   sitePaths — siteKey()s of covered projects' paths; DPRs and material
//               logs are matched against these
export function scopeFor(projects, assignedIds) {
  const byId = new Map(projects.map(p => [idOf(p.id), p]));
  const covered = new Set();
  const stack = [...assignedIds].map(idOf).filter(id => byId.has(id));
  while (stack.length) {
    const id = stack.pop();
    if (covered.has(id)) continue;
    covered.add(id);
    projects.forEach(p => { if (idOf(p.parent_id) === id) stack.push(idOf(p.id)); });
  }
  const visible = new Set(covered);
  covered.forEach(id => {
    let p = byId.get(id);
    const guard = new Set();
    while (p && idOf(p.parent_id) && !guard.has(idOf(p.id))) {
      guard.add(idOf(p.id));
      visible.add(idOf(p.parent_id));
      p = byId.get(idOf(p.parent_id));
    }
  });
  const paths = sitePaths(projects);
  return {
    projects: projects.filter(p => visible.has(idOf(p.id))),
    sitePaths: new Set([...covered].map(id => siteKey(paths.get(id)))),
  };
}

export const inScope = (scope, site) => !scope || scope.sitePaths.has(siteKey(site));

// Active contractors working on the site at `path`: allocated to the site
// itself or to any of its parents (an allocated parent covers its
// sub-sites). contractors: [{ id, name, status, sites: [projectId] }],
// sorted by name.
export function contractorsForSite(contractors, projects, path) {
  const proj = projectByPath(path, projects);
  if (!proj) return [];
  const byId = new Map(projects.map(p => [idOf(p.id), p]));
  const lineage = new Set();
  for (let p = proj; p && !lineage.has(idOf(p.id)); p = byId.get(idOf(p.parent_id))) lineage.add(idOf(p.id));
  return (contractors || [])
    .filter(c => c.status !== 'inactive' && (c.sites || []).some(id => lineage.has(idOf(id))))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
