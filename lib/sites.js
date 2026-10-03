// Site hierarchy rules shared by the server (scoping) and every screen
// (dashboard, site dropdowns, filters), so they all agree on what a
// "site" is.
//
// Projects form a parent → sub-site tree (getProjects() rows: id,
// project_name, parent_id, status). A project with sub-sites is a
// container: work is reported on its sub-sites, never on the parent, so
// it is not a reporting site. A project without sub-sites is one.

const idOf = (v) => String(v ?? '').trim();
const nameKey = (v) => String(v ?? '').trim().toLowerCase();
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

// Reporting sites in the list's tree order: { value, label, project }.
// label is "Parent › Sub-site" for sub-sites.
export function reportingSites(projects, { activeOnly = true } = {}) {
  const byId = new Map(projects.map(p => [idOf(p.id), p]));
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
    .map(p => {
      const parent = byId.get(idOf(p.parent_id));
      const name = String(p.project_name || '').trim();
      return { value: name, label: parent ? `${parent.project_name} › ${name}` : name, project: p };
    });
}

// Reporting sites grouped under their parent, for <optgroup> dropdowns:
// [{ group: 'Parent name' | '', options: [{ value, label }] }].
export function reportingSiteGroups(projects, opts) {
  const byId = new Map(projects.map(p => [idOf(p.id), p]));
  const groups = [];
  reportingSites(projects, opts).forEach(({ value, project }) => {
    const parent = byId.get(idOf(project.parent_id));
    const group = parent ? String(parent.project_name || '').trim() : '';
    let g = groups[groups.length - 1];
    if (!g || g.group !== group) groups.push(g = { group, options: [] });
    g.options.push({ value, label: value });
  });
  return groups;
}

// Site names a filter on `siteName` should match: the site itself, plus
// every sub-site when it is a container (lowercased).
export function siteFilterNames(siteName, projects) {
  const names = new Set([nameKey(siteName)]);
  const proj = projects.find(p => nameKey(p.project_name) === nameKey(siteName));
  if (proj) {
    const stack = [proj];
    while (stack.length) {
      childrenOf(stack.pop(), projects).forEach(c => { names.add(nameKey(c.project_name)); stack.push(c); });
    }
  }
  return names;
}

// A user's scope from their assigned project ids: an assigned project
// covers itself and everything under it. Returns
//   projects  — what the user may see: covered projects plus their
//               ancestors (so "Parent › Sub-site" labels still resolve;
//               an ancestor always keeps a child in the list, so it stays
//               a container and is never offered as a site)
//   siteNames — lowercased names of covered projects; DPRs and material
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
  return {
    projects: projects.filter(p => visible.has(idOf(p.id))),
    siteNames: new Set(projects.filter(p => covered.has(idOf(p.id))).map(p => nameKey(p.project_name))),
  };
}

export const inScope = (scope, site) => !scope || scope.siteNames.has(nameKey(site));

// Active contractors working on `siteName`: allocated to the site itself
// or to any of its parents (an allocated parent covers its sub-sites).
// contractors: [{ id, name, status, sites: [projectId] }], sorted by name.
export function contractorsForSite(contractors, projects, siteName) {
  const proj = projects.find(p => nameKey(p.project_name) === nameKey(siteName));
  if (!proj) return [];
  const byId = new Map(projects.map(p => [idOf(p.id), p]));
  const lineage = new Set();
  for (let p = proj; p && !lineage.has(idOf(p.id)); p = byId.get(idOf(p.parent_id))) lineage.add(idOf(p.id));
  return (contractors || [])
    .filter(c => c.status !== 'inactive' && (c.sites || []).some(id => lineage.has(idOf(id))))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
