'use client';

import { useMemo, useState } from 'react';
import { useApp } from '../app/AppContext';
import Icon from '../ui/Icon';
import { storedPrefix, taskName } from '../../lib/activities';
import { useAdminAction } from './useAdminAction';

// Two-level master lists — Sites › sub-sites and Activities › tasks — share
// one editor: a collapsible card per top-level item, its children inside.
// Order is persisted via updateSortOrder (drag on desktop, ↑/↓ anywhere).
const CONFIG = {
  projects: {
    field: 'project_name', add: 'addProject', update: 'updateProject', remove: 'deleteProject', sortType: 'projects',
    noun: 'site', nouns: 'sites', subNoun: 'sub-site', countNoun: ['sub-site', 'sub-sites'],
    help: 'Only active sites appear in the report and Materials forms. Reports are filed on sub-sites; a site with sub-sites groups them. Deleting a site does not delete reports already filed against it — deactivate it instead to keep history tidy.',
    placeholder: 'e.g. New Hospital Wing', subPlaceholder: 'e.g. Temple',
    movable: false,
  },
  activities: {
    field: 'activity_name', add: 'addActivity', update: 'updateActivity', remove: 'deleteActivity', sortType: 'activities',
    noun: 'category', nouns: 'activities', subNoun: 'task', countNoun: ['task', 'tasks'],
    help: 'Categories group the work (e.g. RCC); tasks are what crews do under them (e.g. Steel work). Only active ones appear in the DPR form, where each category heads its own group of tasks.',
    placeholder: 'e.g. MEP Work', subPlaceholder: 'e.g. Steel work',
    movable: true, // a task can be moved to another category (fixes misfiled ones)
  },
};

const idStr = (v) => String(v ?? '').trim();
const isTop = (item) => idStr(item.parent_id) === '';
const plural = ([one, many], n) => `${n} ${n === 1 ? one : many}`;

// Rename (and, for activities, move to another category).
function EditForm({ item, label, cfg, tops, parentName, busy, run, onDone }) {
  const stored = item[cfg.field];
  const shown = parentName !== null ? taskName(stored, parentName) : stored;
  const [text, setText] = useState(shown);
  const [parent, setParent] = useState(idStr(item.parent_id));
  const moved = parent !== idStr(item.parent_id);

  const save = async (e) => {
    e.preventDefault();
    const name = text.trim();
    if (!name) return;
    const body = { action: cfg.update, id: item.id };
    // Same category: keep the stored "Category ↳ " prefix its siblings use.
    if (name !== shown || moved) body[cfg.field] = moved ? name : `${storedPrefix(stored)}${name}`;
    if (moved) body.parent_id = parent;
    if (Object.keys(body).length === 2) { onDone(); return; }
    const ok = await run(body, { success: moved ? '✅ Moved' : '✅ Renamed' });
    if (ok) onDone();
  };

  return (
    <form className="inline-form" onSubmit={save}>
      <input className="input" value={text} onChange={(e) => setText(e.target.value)} aria-label={label} autoFocus />
      {cfg.movable && (
        <select className="select" value={parent} onChange={(e) => setParent(e.target.value)} aria-label="Category" style={{ maxWidth: 220 }}>
          <option value="">Main category (top level)</option>
          {tops.filter(t => idStr(t.id) !== idStr(item.id)).map(t => <option key={idStr(t.id)} value={idStr(t.id)}>Under {t[cfg.field]}</option>)}
        </select>
      )}
      <button type="submit" className="btn sm primary" disabled={busy || !text.trim()}>Save</button>
      <button type="button" className="btn sm ghost" onClick={onDone}>Cancel</button>
    </form>
  );
}

// ↑/↓, (de)activate, edit, delete — for a category header or a task row.
function Tools({ item, name, cfg, canUp, canDown, onMove, onEdit, run, busy, childCount }) {
  const active = item.status === 'active';
  const toggle = () => run({ action: cfg.update, id: item.id, status: active ? 'inactive' : 'active' }, { success: active ? 'Deactivated' : 'Activated' });
  const remove = () => {
    const extra = childCount ? ` and its ${plural(cfg.countNoun, childCount)}` : '';
    if (window.confirm(`Delete "${name}"${extra} permanently?`)) run({ action: cfg.remove, id: item.id }, { success: '🗑️ Deleted' });
  };
  return (
    <div className="tree-tools">
      {onMove && <>
        <button type="button" className="icon-btn" onClick={() => onMove(-1)} disabled={!canUp || busy} aria-label={`Move ${name} up`} title="Move up"><Icon name="up" /></button>
        <button type="button" className="icon-btn" onClick={() => onMove(1)} disabled={!canDown || busy} aria-label={`Move ${name} down`} title="Move down"><Icon name="arrowDown" /></button>
      </>}
      <button type="button" className="btn sm ghost" onClick={toggle} disabled={busy}>{active ? 'Deactivate' : 'Activate'}</button>
      <button type="button" className="icon-btn" onClick={onEdit} aria-label={`Edit ${name}`} title={cfg.movable ? 'Rename or move' : 'Rename'}><Icon name="edit" /></button>
      <button type="button" className="icon-btn danger" onClick={remove} disabled={busy} aria-label={`Delete ${name}`} title="Delete"><Icon name="trash" /></button>
    </div>
  );
}

// Native drag-to-reorder within one list (categories, or one card's tasks).
// Only the grip starts a drag (so inputs in a card stay selectable); the
// card or row is the drop target. Touch screens don't fire these events —
// ↑/↓ cover them.
function useDragList(onReorder) {
  const [drag, setDrag] = useState(null); // { list, from, over }
  const handle = (list, index, enabled) => (enabled ? {
    draggable: true,
    onDragStart: (e) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', ''); // Firefox won't start a drag without data
      const box = e.currentTarget.closest('.cat-card, .task-row');
      if (box) e.dataTransfer.setDragImage(box, 24, 24);
      setDrag({ list, from: index, over: index });
    },
    onDragEnd: () => setDrag(null),
  } : {});
  const props = (list, index, enabled) => (enabled ? {
    onDragOver: (e) => {
      if (!drag || drag.list !== list) return;
      e.preventDefault();
      e.stopPropagation();
      if (drag.over !== index) setDrag(d => ({ ...d, over: index }));
    },
    onDrop: (e) => {
      if (!drag || drag.list !== list) return;
      e.preventDefault();
      e.stopPropagation();
      if (drag.from !== index) onReorder(list, drag.from, index);
      setDrag(null);
    },
  } : {});
  const cls = (list, index) => (drag && drag.list === list
    ? (drag.from === index ? ' dragging' : drag.over === index ? (drag.over < drag.from ? ' drop-before' : ' drop-after') : '')
    : '');
  return { props, handle, cls };
}

const move = (arr, from, to) => { const a = [...arr]; const [x] = a.splice(from, 1); a.splice(to, 0, x); return a; };

export default function HierarchyAdmin({ kind }) {
  const cfg = CONFIG[kind];
  const app = useApp();
  const items = kind === 'projects' ? app.projects : app.activities;
  const { run, busy } = useAdminAction();
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const [optimisticOrder, setOptimisticOrder] = useState(null); // ids, while a reorder is saving
  const [parentId, setParentId] = useState('');
  const [name, setName] = useState('');
  const [taskDraft, setTaskDraft] = useState({}); // per-card "add task" text

  const ordered = useMemo(() => {
    if (!optimisticOrder) return items;
    const byId = new Map(items.map(i => [idStr(i.id), i]));
    return optimisticOrder.map(id => byId.get(id)).filter(Boolean);
  }, [items, optimisticOrder]);

  const tree = useMemo(() => {
    const topIds = new Set(ordered.filter(isTop).map(i => idStr(i.id)));
    const byLowerName = new Map(ordered.filter(isTop).map(t => [String(t[cfg.field]).trim().toLowerCase(), t]));
    // The category a misfiled item's stored name points at ("Fabrication Work ↳ …").
    const suggest = (i) => {
      const n = String(i[cfg.field] || '').replace(/^[↳\s]+/, '');
      const head = n.includes('↳') ? n.split('↳')[0].trim().toLowerCase() : '';
      const t = head && byLowerName.get(head);
      return t && idStr(t.id) !== idStr(i.id) ? idStr(t.id) : '';
    };
    const childrenOf = (id) => ordered.filter(i => idStr(i.parent_id) === idStr(id) && idStr(i.id) !== idStr(id));
    // Needs a category: children whose parent isn't a category (missing, or
    // itself a child — a known source-data issue), and childless top-level
    // items whose name says they belong under a category ("X ↳ task").
    const misfiled = ordered.filter(i => (!isTop(i) && !topIds.has(idStr(i.parent_id)))
      || (cfg.movable && isTop(i) && suggest(i) && !childrenOf(i.id).length));
    const misfiledIds = new Set(misfiled.map(i => idStr(i.id)));
    const tops = ordered.filter(i => isTop(i) && !misfiledIds.has(idStr(i.id)));
    return {
      tops: tops.map(t => ({ item: t, children: childrenOf(t.id) })),
      misfiled: misfiled.map(i => ({ item: i, suggestion: suggest(i) })),
    };
  }, [ordered, cfg]);
  const topItems = tree.tops.map(t => t.item);

  const flatten = (tops) => [
    ...tops.flatMap(t => [idStr(t.item.id), ...t.children.map(c => idStr(c.id))]),
    ...tree.misfiled.map(m => idStr(m.item.id)),
  ];
  const persistOrder = async (orderedIds) => {
    setOptimisticOrder(orderedIds);
    await run({ action: 'updateSortOrder', type: cfg.sortType, orderedIds }, { pending: '⏳ Saving order...', success: '↕️ Order saved' });
    setOptimisticOrder(null); // show the server's order (reverts on failure)
  };
  // list: 'tops', or a category id for its tasks.
  const reorder = (list, from, to) => {
    if (to < 0) return;
    if (list === 'tops') {
      if (to >= tree.tops.length) return;
      persistOrder(flatten(move(tree.tops, from, to)));
      return;
    }
    const tops = tree.tops.map(t => (idStr(t.item.id) === list ? { ...t, children: move(t.children, from, to) } : t));
    const t = tree.tops.find(x => idStr(x.item.id) === list);
    if (!t || to >= t.children.length) return;
    persistOrder(flatten(tops));
  };
  const dnd = useDragList(reorder);

  const toggleOpen = (id) => setOpen(cur => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allOpen = tree.tops.length > 0 && tree.tops.every(t => open.has(idStr(t.item.id)));

  const add = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) { app.showToast(`⚠️ Enter a ${parentId ? cfg.subNoun : cfg.noun} name`); return; }
    const ok = await run({ action: cfg.add, [cfg.field]: n, parent_id: parentId || '' }, { success: `✅ ${parentId ? cfg.subNoun : cfg.noun} added`, pending: '⏳ Adding...' });
    if (ok) { setName(''); if (parentId) setOpen(cur => new Set(cur).add(parentId)); }
  };
  const addTask = async (e, top) => {
    e.preventDefault();
    const id = idStr(top.id);
    const n = String(taskDraft[id] || '').trim();
    if (!n) return;
    const ok = await run({ action: cfg.add, [cfg.field]: n, parent_id: id }, { success: `✅ Added to ${top[cfg.field]}`, pending: '⏳ Adding...' });
    if (ok) setTaskDraft(d => ({ ...d, [id]: '' }));
  };
  const moveTo = (item, parent) => {
    if (!parent) return;
    run({ action: cfg.update, id: item.id, parent_id: parent, [cfg.field]: taskName(item[cfg.field]) }, { success: '✅ Moved' });
  };

  const editProps = { cfg, tops: topItems, busy, run, onDone: () => setEditing(null) };
  const activeTops = topItems.filter(t => t.status === 'active');

  return (
    <>
      <form className="panel" onSubmit={add}>
        <h2 className="panel-title">Add {cfg.noun} or {cfg.subNoun}</h2>
        <div className="form-grid three">
          <label className="field">
            <span>Under</span>
            <select className="select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">Nothing — new {cfg.noun}</option>
              {activeTops.map(t => <option key={idStr(t.id)} value={idStr(t.id)}>{t[cfg.field]}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={parentId ? cfg.subPlaceholder : cfg.placeholder} />
          </label>
          <button type="submit" className="btn primary" disabled={busy}><Icon name="plus" />Add</button>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>{cfg.help}</p>
      </form>

      <div className="list-bar section-gap">
        <h2 className="panel-title">All {cfg.nouns} <em>({tree.tops.length} {tree.tops.length === 1 ? cfg.noun : (cfg.noun === 'category' ? 'categories' : cfg.nouns)})</em></h2>
        {tree.tops.length > 0 && (
          <button type="button" className="btn sm ghost" onClick={() => setOpen(allOpen ? new Set() : new Set(tree.tops.map(t => idStr(t.item.id))))}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        )}
      </div>

      {tree.misfiled.length > 0 && (
        <section className="cat-card misfiled">
          <div className="cat-head static">
            <Icon name="inbox" />
            <div className="cat-title"><b>Needs a {cfg.noun}</b><span className="small muted">These point to a {cfg.noun} that doesn’t exist or isn’t one, so they’re missing from the DPR form. Move each one — the suggested {cfg.noun} is pre-selected.</span></div>
          </div>
          <div className="cat-body">
            {tree.misfiled.map(({ item, suggestion }) => (
              <MisfiledRow key={idStr(item.id)} item={item} suggestion={suggestion} cfg={cfg} tops={topItems} busy={busy} run={run} onMove={moveTo} />
            ))}
          </div>
        </section>
      )}

      {!tree.tops.length && !tree.misfiled.length && <div className="list"><div className="empty"><h3>No {cfg.nouns} yet</h3><p className="muted">Add the first {cfg.noun} above.</p></div></div>}

      <div className="cat-list">
        {tree.tops.map((t, i) => {
          const id = idStr(t.item.id);
          const nm = t.item[cfg.field];
          const isOpen = open.has(id);
          const active = t.item.status === 'active';
          const activeKids = t.children.filter(c => c.status === 'active').length;
          const inactiveKids = t.children.length - activeKids;
          return (
            <section key={id} className={`cat-card${active ? '' : ' off'}${dnd.cls('tops', i)}`} {...dnd.props('tops', i, !busy && editing !== id)}>
              {editing === id ? (
                <div className="cat-head"><EditForm item={t.item} label={`Rename ${nm}`} parentName={null} {...editProps} /></div>
              ) : (
                <div className="cat-head">
                  <span className="grip" title="Drag to reorder" aria-hidden="true" {...dnd.handle('tops', i, !busy)}><Icon name="grip" /></span>
                  <button type="button" className="cat-toggle" aria-expanded={isOpen} onClick={() => toggleOpen(id)}>
                    <span className="chev"><Icon name="chev" /></span>
                    <span className="cat-title">
                      <b>{nm}</b>
                      <span className="cat-badges">
                        <span className={`tag${activeKids ? ' info' : ''}`}>{plural(cfg.countNoun, activeKids)}</span>
                        {inactiveKids > 0 && <span className="tag">{inactiveKids} inactive</span>}
                        {!active && <span className="tag warn">Inactive</span>}
                      </span>
                    </span>
                  </button>
                  <Tools item={t.item} name={nm} cfg={cfg} canUp={i > 0} canDown={i < tree.tops.length - 1} onMove={(d) => reorder('tops', i, i + d)}
                    onEdit={() => setEditing(id)} run={run} busy={busy} childCount={t.children.length} />
                </div>
              )}
              {isOpen && (
                <div className="cat-body">
                  {t.children.map((c, ci) => {
                    const cid = idStr(c.id);
                    const label = kind === 'activities' ? taskName(c[cfg.field], nm) : c[cfg.field];
                    const cActive = c.status === 'active';
                    return (
                      <div key={cid} className={`task-row${cActive ? '' : ' off'}${dnd.cls(id, ci)}`} {...dnd.props(id, ci, !busy && editing !== cid)}>
                        {editing === cid ? (
                          <EditForm item={c} label={`Rename ${label}`} parentName={nm} {...editProps} />
                        ) : (
                          <>
                            <span className="grip" title="Drag to reorder" aria-hidden="true" {...dnd.handle(id, ci, !busy)}><Icon name="grip" /></span>
                            <span className="task-name" title={c[cfg.field] !== label ? c[cfg.field] : undefined}>{label}{!cActive && <span className="tag">Inactive</span>}</span>
                            <Tools item={c} name={label} cfg={cfg} canUp={ci > 0} canDown={ci < t.children.length - 1} onMove={(d) => reorder(id, ci, ci + d)}
                              onEdit={() => setEditing(cid)} run={run} busy={busy} childCount={0} />
                          </>
                        )}
                      </div>
                    );
                  })}
                  {!t.children.length && <p className="tree-empty">No {cfg.countNoun[1]} yet — {kind === 'activities' ? 'crews log this category on its own.' : 'reports are filed on the site itself.'}</p>}
                  <form className="task-add" onSubmit={(e) => addTask(e, t.item)}>
                    <Icon name="plus" />
                    <input className="input" value={taskDraft[id] || ''} onChange={(e) => setTaskDraft(d => ({ ...d, [id]: e.target.value }))} placeholder={`Add a ${cfg.subNoun} to ${nm}`} aria-label={`New ${cfg.subNoun} under ${nm}`} />
                    <button type="submit" className="btn sm" disabled={busy || !String(taskDraft[id] || '').trim()}>Add</button>
                  </form>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

function MisfiledRow({ item, suggestion, cfg, tops, busy, run, onMove }) {
  const [parent, setParent] = useState(suggestion);
  const nm = item[cfg.field];
  const remove = () => { if (window.confirm(`Delete "${nm}" permanently?`)) run({ action: cfg.remove, id: item.id }, { success: '🗑️ Deleted' }); };
  return (
    <div className="task-row">
      <span className="task-name" title={nm}>{taskName(nm)}<span className="sub">Stored as “{nm}”</span></span>
      <div className="tree-tools">
        {cfg.movable ? (
          <>
            <select className="select sm" value={parent} onChange={(e) => setParent(e.target.value)} aria-label={`Category for ${nm}`}>
              <option value="">Choose {cfg.noun}…</option>
              {tops.map(t => <option key={idStr(t.id)} value={idStr(t.id)}>{t[cfg.field]}</option>)}
            </select>
            <button type="button" className="btn sm primary" onClick={() => onMove(item, parent)} disabled={busy || !parent}>Move</button>
          </>
        ) : <span className="muted small">Rename or delete it</span>}
        <button type="button" className="icon-btn danger" onClick={remove} disabled={busy} aria-label={`Delete ${nm}`} title="Delete"><Icon name="trash" /></button>
      </div>
    </div>
  );
}
