'use client';

import { useMemo, useState } from 'react';
import { useApp } from '../app/AppContext';
import Icon from '../ui/Icon';
import { useAdminAction } from './useAdminAction';

// Two-level master lists — Projects › Sub-projects and Activities ›
// Sub-activities — share one editor. Order is persisted via updateSortOrder.
const CONFIG = {
  projects: {
    field: 'project_name', add: 'addProject', update: 'updateProject', remove: 'deleteProject', sortType: 'projects',
    noun: 'site', nouns: 'sites', subNoun: 'sub-site',
    help: 'Only active sites appear in the report and Materials forms. Deleting a site does not delete reports already filed against it — deactivate it instead to keep history tidy.',
    placeholder: 'e.g. New Hospital Wing',
  },
  activities: {
    field: 'activity_name', add: 'addActivity', update: 'updateActivity', remove: 'deleteActivity', sortType: 'activities',
    noun: 'main activity', nouns: 'activities', subNoun: 'sub-activity',
    help: 'Main activities are work categories (e.g. RCC Work); sub-activities are specific tasks (e.g. Steel work). Only active ones appear in the report form.',
    placeholder: 'e.g. MEP Work',
  },
};

const idStr = (v) => String(v ?? '').trim();
const isTop = (item) => idStr(item.parent_id) === '';

function InlineEdit({ value, onSave, onCancel, busy, label }) {
  const [text, setText] = useState(value);
  return (
    <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (text.trim() && text.trim() !== value) onSave(text.trim()); else onCancel(); }}>
      <input className="input" value={text} onChange={(e) => setText(e.target.value)} aria-label={label} autoFocus />
      <button type="submit" className="btn sm primary" disabled={busy || !text.trim()}>Save</button>
      <button type="button" className="btn sm ghost" onClick={onCancel}>Cancel</button>
    </form>
  );
}

function ItemLine({ item, cfg, canUp, canDown, onMove, editing, setEditing, run, busy, childCount }) {
  const name = item[cfg.field];
  const active = item.status === 'active';
  const rename = (next) => run({ action: cfg.update, id: item.id, [cfg.field]: next }, { success: '✅ Renamed' }).then(ok => { if (ok) setEditing(null); });
  const toggle = () => run({ action: cfg.update, id: item.id, status: active ? 'inactive' : 'active' }, { success: active ? 'Deactivated' : 'Activated' });
  const remove = () => {
    const extra = childCount ? ` and its ${childCount} ${childCount === 1 ? cfg.subNoun : `${cfg.subNoun}s`}` : '';
    if (window.confirm(`Delete "${name}"${extra} permanently?`)) run({ action: cfg.remove, id: item.id }, { success: '🗑️ Deleted' });
  };

  if (editing === idStr(item.id)) {
    return <div className="tree-line"><InlineEdit value={name} onSave={rename} onCancel={() => setEditing(null)} busy={busy} label={`Rename ${name}`} /></div>;
  }
  return (
    <div className={`tree-line${active ? '' : ' off'}`}>
      <span className="name">{name}{!active && <span className="tag">Inactive</span>}</span>
      <div className="tree-tools">
        <button type="button" className="icon-btn" onClick={() => onMove(-1)} disabled={!canUp || busy} aria-label={`Move ${name} up`} title="Move up"><Icon name="up" /></button>
        <button type="button" className="icon-btn" onClick={() => onMove(1)} disabled={!canDown || busy} aria-label={`Move ${name} down`} title="Move down"><Icon name="arrowDown" /></button>
        <button type="button" className="btn sm ghost" onClick={toggle} disabled={busy}>{active ? 'Deactivate' : 'Activate'}</button>
        <button type="button" className="icon-btn" onClick={() => setEditing(idStr(item.id))} aria-label={`Rename ${name}`} title="Rename"><Icon name="edit" /></button>
        <button type="button" className="icon-btn danger" onClick={remove} disabled={busy} aria-label={`Delete ${name}`} title="Delete"><Icon name="trash" /></button>
      </div>
    </div>
  );
}

export default function HierarchyAdmin({ kind }) {
  const cfg = CONFIG[kind];
  const app = useApp();
  const items = kind === 'projects' ? app.projects : app.activities;
  const { run, busy } = useAdminAction();
  const [editing, setEditing] = useState(null);
  const [optimisticOrder, setOptimisticOrder] = useState(null); // ids, while a reorder is saving
  const [parentId, setParentId] = useState('');
  const [name, setName] = useState('');

  const ordered = useMemo(() => {
    if (!optimisticOrder) return items;
    const byId = new Map(items.map(i => [idStr(i.id), i]));
    return optimisticOrder.map(id => byId.get(id)).filter(Boolean);
  }, [items, optimisticOrder]);

  const tree = useMemo(() => {
    const ids = new Set(ordered.map(i => idStr(i.id)));
    const tops = ordered.filter(isTop);
    const childrenOf = (id) => ordered.filter(i => idStr(i.parent_id) === idStr(id));
    // Children whose parent no longer exists (a known source-data issue) —
    // shown so they can be fixed or deleted instead of silently vanishing.
    const orphans = ordered.filter(i => !isTop(i) && !ids.has(idStr(i.parent_id)));
    return { tops: tops.map(t => ({ item: t, children: childrenOf(t.id) })), orphans };
  }, [ordered]);

  const flatten = (tops, orphans) => [
    ...tops.flatMap(t => [idStr(t.item.id), ...t.children.map(c => idStr(c.id))]),
    ...orphans.map(o => idStr(o.id)),
  ];

  const persistOrder = async (orderedIds) => {
    setOptimisticOrder(orderedIds);
    await run({ action: 'updateSortOrder', type: cfg.sortType, orderedIds }, { pending: '⏳ Saving order...', success: '↕️ Order saved' });
    setOptimisticOrder(null); // show the server's order (reverts on failure)
  };

  const moveTop = (index, dir) => {
    const tops = [...tree.tops];
    const j = index + dir;
    if (j < 0 || j >= tops.length) return;
    [tops[index], tops[j]] = [tops[j], tops[index]];
    persistOrder(flatten(tops, tree.orphans));
  };
  const moveChild = (topIndex, index, dir) => {
    const tops = tree.tops.map(t => ({ ...t, children: [...t.children] }));
    const kids = tops[topIndex].children;
    const j = index + dir;
    if (j < 0 || j >= kids.length) return;
    [kids[index], kids[j]] = [kids[j], kids[index]];
    persistOrder(flatten(tops, tree.orphans));
  };

  const add = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) { app.showToast(`⚠️ Enter a ${parentId ? cfg.subNoun : cfg.noun} name`); return; }
    const ok = await run({ action: cfg.add, [cfg.field]: n, parent_id: parentId || '' }, { success: `✅ ${parentId ? cfg.subNoun : cfg.noun} added`, pending: '⏳ Adding...' });
    if (ok) setName('');
  };

  const activeTops = tree.tops.filter(t => t.item.status === 'active');
  const lineProps = { cfg, editing, setEditing, run, busy };

  return (
    <>
      <form className="panel" onSubmit={add}>
        <h2 className="panel-title">Add {cfg.noun} or {cfg.subNoun}</h2>
        <div className="form-grid three">
          <label className="field">
            <span>Under</span>
            <select className="select" value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">Nothing — new top-level {cfg.noun}</option>
              {activeTops.map(t => <option key={idStr(t.item.id)} value={idStr(t.item.id)}>{t.item[cfg.field]}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={cfg.placeholder} />
          </label>
          <button type="submit" className="btn primary" disabled={busy}><Icon name="plus" />Add</button>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>{cfg.help}</p>
      </form>

      <div className="list-bar section-gap">
        <h2 className="panel-title">All {cfg.nouns} <em>({items.length})</em></h2>
      </div>
      <section className="panel">
        {!tree.tops.length && !tree.orphans.length && <p className="muted">No {cfg.nouns} yet.</p>}
        {tree.tops.map((t, i) => (
          <div key={idStr(t.item.id)} className="tree-main">
            <ItemLine item={t.item} {...lineProps} canUp={i > 0} canDown={i < tree.tops.length - 1} onMove={(d) => moveTop(i, d)} childCount={t.children.length} />
            {t.children.length > 0 && (
              <div className="tree-sub">
                {t.children.map((c, ci) => (
                  <ItemLine key={idStr(c.id)} item={c} {...lineProps} canUp={ci > 0} canDown={ci < t.children.length - 1} onMove={(d) => moveChild(i, ci, d)} childCount={0} />
                ))}
              </div>
            )}
          </div>
        ))}
        {tree.orphans.length > 0 && (
          <div className="tree-main">
            <div className="banner warn" style={{ marginBottom: 6 }}>
              <Icon name="lock" />
              <div className="btxt"><b>Unassigned</b>These {cfg.subNoun}s point to a parent that no longer exists. Rename or delete them.</div>
            </div>
            <div className="tree-sub">
              {tree.orphans.map(o => (
                <ItemLine key={idStr(o.id)} item={o} {...lineProps} canUp={false} canDown={false} onMove={() => {}} childCount={0} />
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
