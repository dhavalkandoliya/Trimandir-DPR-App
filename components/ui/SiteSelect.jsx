'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import { SITE_SEP, isArchivedSite, projectByPath, siteKey, siteTree } from '../../lib/sites';

// The site picker used everywhere a site is chosen: the DPR and Materials
// log filters (mode 'filter') and the New DPR / Log Material forms (mode
// 'report'). Projects are collapsible groups with their sub-sites
// indented beneath; a search box filters every site by name or path.
// Archived (inactive) sites sit in their own collapsible section at the
// bottom of a filter (lib/sites.js siteTree()).
//
// Keyboard: on the closed button, ↓ / Enter / Space open it. Inside, focus
// stays in the search box: ↑ ↓ Home End move, Enter picks a site or
// toggles a group, → / ← expand / collapse, Esc closes. A click outside
// closes it too.
//
// Props:
//   value, onChange(path)  the selected site path ('' = none / all sites)
//   mode                   'filter' | 'report'
//   extra                  [path] — filter values that name no current
//                          site (old log rows), listed last
//   allLabel               filter mode's '' option ("All sites")
//   placeholder            report mode's text when nothing is chosen
//   labelledBy             id of the visible label
export default function SiteSelect({
  projects, value = '', onChange, mode = 'filter', extra = [],
  allLabel = 'All sites', placeholder = 'Choose site', disabled = false, labelledBy,
}) {
  const uid = useId().replace(/:/g, '');
  const listId = `${uid}-list`;
  const filter = mode === 'filter';
  const tree = useMemo(() => siteTree(projects || [], { mode }), [projects, mode]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  const [activeKey, setActiveKey] = useState('');
  const [alignRight, setAlignRight] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const searchRef = useRef(null);
  const rowRefs = useRef(new Map());

  // ── Rows shown in the menu, in order ──
  // { key, kind: 'option' | 'group' | 'section', value?, label, depth,
  //   node?, parentKey?, count?, archived?, all?, crumbs? }
  const rows = useMemo(() => {
    const out = [];
    const q = query.trim().toLowerCase();
    if (q) {
      // Search: every choosable site whose name or path matches, flat,
      // shown as a breadcrumb.
      const add = (n, archived) => {
        if (n.value && n.path.toLowerCase().includes(q)) {
          out.push({ key: `o:${n.value}`, kind: 'option', value: n.value, label: n.path, depth: 0, archived, all: filter && n.children.length > 0 });
        }
        n.children.forEach(c => add(c, archived));
      };
      tree.groups.forEach(n => add(n, false));
      tree.archived.forEach(n => add(n, true));
      extra.filter(v => v.toLowerCase().includes(q)).forEach(v => out.push({ key: `x:${v}`, kind: 'option', value: v, label: v, depth: 0, unlinked: true }));
      return out;
    }
    if (filter) out.push({ key: 'o:', kind: 'option', value: '', label: allLabel, depth: 0 });
    const walk = (n, depth, parentKey) => {
      if (!n.children.length) {
        out.push({ key: `o:${n.value}`, kind: 'option', value: n.value, label: n.label, depth, parentKey });
        return;
      }
      const key = `g:${n.id}`;
      out.push({ key, kind: 'group', node: n, label: n.label, depth, parentKey, count: n.children.length });
      if (!expanded.has(key)) return;
      if (filter && n.value) out.push({ key: `o:${n.value}`, kind: 'option', value: n.value, label: 'All sub-sites', depth: depth + 1, parentKey: key, all: true });
      n.children.forEach(c => walk(c, depth + 1, key));
    };
    tree.groups.forEach(n => walk(n, 0, ''));
    if (tree.archived.length) {
      out.push({ key: 's:archived', kind: 'section', label: 'Archived / Inactive', depth: 0, count: tree.archived.length });
      if (expanded.has('s:archived')) {
        tree.archived.forEach(n => out.push({ key: `o:${n.value}`, kind: 'option', value: n.value, label: n.label, depth: 1, parentKey: 's:archived', archived: true }));
      }
    }
    if (extra.length) {
      out.push({ key: 's:extra', kind: 'section', label: 'Not linked to a site', depth: 0, count: extra.length });
      if (expanded.has('s:extra')) {
        extra.forEach(v => out.push({ key: `x:${v}`, kind: 'option', value: v, label: v, depth: 1, parentKey: 's:extra', unlinked: true }));
      }
    }
    return out;
  }, [tree, expanded, query, filter, allLabel, extra]);

  const selectedKey = filter || value ? (extra.includes(value) ? `x:${value}` : `o:${value}`) : '';
  const activeIndex = Math.max(0, rows.findIndex(r => r.key === activeKey));

  // ── Opening / closing ──
  // Opening expands the way to the current value, so it's in view.
  const openMenu = () => {
    if (disabled) return;
    const next = new Set(expanded);
    const findPath = (nodes, trail) => {
      for (const n of nodes) {
        if (n.value && siteKey(n.value) === siteKey(value)) { trail.forEach(k => next.add(k)); if (n.children.length) next.add(`g:${n.id}`); return true; }
        if (findPath(n.children, [...trail, `g:${n.id}`])) return true;
      }
      return false;
    };
    if (value && !findPath(tree.groups, [])) {
      if (tree.archived.some(n => siteKey(n.value) === siteKey(value))) next.add('s:archived');
      else if (extra.includes(value)) next.add('s:extra');
    }
    // Filing a report: show every site straight away (a supervisor usually
    // has one project or two).
    if (!filter && !value) {
      const all = (nodes) => nodes.forEach(n => { if (n.children.length) { next.add(`g:${n.id}`); all(n.children); } });
      all(tree.groups);
    }
    setExpanded(next);
    setQuery('');
    setActiveKey(selectedKey);
    const rect = buttonRef.current?.getBoundingClientRect();
    setAlignRight(!!rect && rect.left + 360 > window.innerWidth - 16 && rect.right > 360);
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  const choose = (v) => {
    onChange(v);
    close();
  };
  const toggle = (key, force) => setExpanded(cur => {
    const next = new Set(cur);
    const on = force === undefined ? !next.has(key) : force;
    if (on) next.add(key); else next.delete(key);
    return next;
  });

  useEffect(() => { if (open) searchRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) close(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open]);
  // Keep the keyboard's row in view.
  useEffect(() => {
    if (open && rows[activeIndex]) rowRefs.current.get(rows[activeIndex].key)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, rows]);
  // A search result list starts at its first match.
  useEffect(() => { if (open && query) setActiveKey(rows[0] ? rows[0].key : ''); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const activate = (row) => {
    if (!row) return;
    if (row.kind === 'option') choose(row.value);
    else toggle(row.key);
  };

  const onMenuKey = (e) => {
    const row = rows[activeIndex];
    const move = (i) => { const r = rows[Math.min(rows.length - 1, Math.max(0, i))]; if (r) setActiveKey(r.key); };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(activeIndex + 1); break;
      case 'ArrowUp': e.preventDefault(); move(activeIndex - 1); break;
      case 'Home': if (!query) { e.preventDefault(); move(0); } break;
      case 'End': if (!query) { e.preventDefault(); move(rows.length - 1); } break;
      case 'Enter': e.preventDefault(); activate(row); break;
      case 'ArrowRight':
        if (row && row.kind !== 'option' && !expanded.has(row.key)) { e.preventDefault(); toggle(row.key, true); }
        break;
      case 'ArrowLeft':
        if (!row || query) break;
        if (row.kind !== 'option' && expanded.has(row.key)) { e.preventDefault(); toggle(row.key, false); }
        else if (row.parentKey) { e.preventDefault(); setActiveKey(row.parentKey); }
        break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); close(); break;
      case 'Tab': close(false); break;
      default: break;
    }
  };
  const onButtonKey = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); openMenu(); }
  };

  // ── The closed button: the chosen site as a breadcrumb ──
  const summary = (() => {
    if (!value) return filter ? <span className="ss-text">{allLabel}</span> : <span className="ss-text ss-placeholder">{placeholder}</span>;
    const project = projectByPath(value, projects || []);
    const parts = String(value).split(SITE_SEP);
    const last = parts.pop();
    const archived = isArchivedSite(value, projects || []);
    const isParent = filter && project && (projects || []).some(p => String(p.parent_id ?? '').trim() === String(project.id));
    return (
      <span className="ss-text">
        {parts.map((p, i) => <span key={i} className="ss-crumb">{p}<span className="ss-sep" aria-hidden="true">›</span></span>)}
        <b>{last}</b>
        {isParent && <span className="ss-badge">All sub-sites</span>}
        {archived && <span className="ss-badge muted">Archived</span>}
        {!project && <span className="ss-badge muted">Not linked</span>}
      </span>
    );
  })();

  const rowId = (key) => `${uid}-r-${rows.findIndex(r => r.key === key)}`;

  return (
    <div className={`ss${open ? ' open' : ''}`} ref={wrapRef}>
      <button
        type="button"
        ref={buttonRef}
        className="ss-button"
        aria-haspopup="tree"
        aria-expanded={open}
        aria-labelledby={labelledBy ? `${labelledBy} ${uid}-btn` : undefined}
        id={`${uid}-btn`}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onButtonKey}
      >
        <Icon name="site" />
        {summary}
        <span className="ss-caret" aria-hidden="true"><Icon name="chev" /></span>
      </button>

      {open && (
        <div className={`ss-pop${alignRight ? ' right' : ''}`}>
          <div className="ss-search">
            <Icon name="search" />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={rows[activeIndex] ? rowId(rows[activeIndex].key) : undefined}
              aria-label="Search sites"
              placeholder="Search sites…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onMenuKey}
            />
            {query && <button type="button" className="ss-clear" aria-label="Clear search" onClick={() => { setQuery(''); searchRef.current?.focus(); }}><Icon name="x" /></button>}
          </div>
          <ul className="ss-list" role="tree" id={listId} aria-label="Sites">
            {!rows.length && <li className="ss-empty" role="presentation">{query ? `No site matches “${query}”` : 'No sites available'}</li>}
            {rows.map((r, i) => {
              const isOpen = expanded.has(r.key);
              const cls = ['ss-row', `ss-${r.kind}`, i === activeIndex ? 'active' : '', r.key === selectedKey ? 'selected' : '', r.archived ? 'archived' : '', r.all ? 'all' : ''].filter(Boolean).join(' ');
              const crumbs = query && r.label.includes(SITE_SEP) ? r.label.split(SITE_SEP) : null;
              return (
                <li
                  key={r.key}
                  id={`${uid}-r-${i}`}
                  ref={(el) => { if (el) rowRefs.current.set(r.key, el); else rowRefs.current.delete(r.key); }}
                  className={cls}
                  role="treeitem"
                  aria-level={r.depth + 1}
                  aria-expanded={r.kind === 'option' ? undefined : isOpen}
                  aria-selected={r.kind === 'option' ? r.key === selectedKey : undefined}
                  style={{ '--depth': r.depth }}
                  onMouseDown={(e) => e.preventDefault()} // keep focus in the search box
                  onMouseMove={() => { if (r.key !== activeKey) setActiveKey(r.key); }}
                  onClick={() => activate(r)}
                >
                  {r.kind !== 'option' && (
                    <span className={`ss-chev${isOpen ? ' on' : ''}`} aria-hidden="true"><Icon name="chev" /></span>
                  )}
                  {r.kind === 'section' && <span className="ss-icon" aria-hidden="true"><Icon name="archive" /></span>}
                  <span className="ss-label">
                    {crumbs
                      ? <>{crumbs.slice(0, -1).map((c, j) => <span key={j} className="ss-crumb">{c}<span className="ss-sep" aria-hidden="true">›</span></span>)}<b>{crumbs[crumbs.length - 1]}</b></>
                      : r.label}
                    {query && r.all && <span className="ss-badge">All sub-sites</span>}
                  </span>
                  {r.kind !== 'option' && <span className="ss-count">{r.count} {r.kind === 'group' ? (r.count === 1 ? 'sub-site' : 'sub-sites') : ''}</span>}
                  {r.archived && query && <span className="ss-badge muted">Archived</span>}
                  {r.key === selectedKey && <span className="ss-check" aria-hidden="true"><Icon name="check" /></span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
