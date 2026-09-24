'use client';

import { useMemo, useState } from 'react';
import { useApp } from '../app/AppContext';
import { useAdminAction } from './useAdminAction';

// Two-level master lists — Projects › Sub-projects and Activities ›
// Sub-activities — share one editor. Order is persisted via updateSortOrder
// (the old panel sent activity order straight to Apps Script with
// mode:'no-cors', so it never reached Supabase).
const CONFIG = {
  projects: {
    field: 'project_name', add: 'addProject', update: 'updateProject', remove: 'deleteProject', sortType: 'projects',
    icon: '📍', noun: 'project', nouns: 'projects', subNoun: 'sub-project',
    help: 'Only active projects appear in the DPR and Materials forms. Deleting a project does not delete DPRs already logged against it.',
    placeholder: 'e.g. New Hospital Wing',
  },
  activities: {
    field: 'activity_name', add: 'addActivity', update: 'updateActivity', remove: 'deleteActivity', sortType: 'activities',
    icon: '🔨', noun: 'activity', nouns: 'activities', subNoun: 'sub-activity',
    help: 'Main activities are work categories (e.g. RCC Work); sub-activities are specific tasks (e.g. Steel work). Only active ones appear in the DPR form.',
    placeholder: 'e.g. MEP Work / Panel Wiring',
  },
};

const idStr = (v) => String(v ?? '').trim();
const isTop = (item) => idStr(item.parent_id) === '';

function InlineEdit({ value, onSave, onCancel, busy, label }) {
  const [text, setText] = useState(value);
  return (
    <form className="admin-inline-form" onSubmit={(e) => { e.preventDefault(); if (text.trim() && text.trim() !== value) onSave(text.trim()); else onCancel(); }}>
      <input value={text} onChange={(e) => setText(e.target.value)} aria-label={label} autoFocus />
      <button type="submit" className="btn-green btn-sm admin-inline-btn" disabled={busy || !text.trim()}>Save</button>
      <button type="button" className="btn-gray btn-sm admin-inline-btn" onClick={onCancel}>Cancel</button>
    </form>
  );
}

function ItemRow({ item, cfg, isSub, canUp, canDown, onMove, editing, setEditing, run, busy, childCount }) {
  const name = item[cfg.field];
  const active = item.status === 'active';
  const rename = (next) => run({ action: cfg.update, id: item.id, [cfg.field]: next }, { success: '✅ Renamed' }).then(ok => { if (ok) setEditing(null); });
  const toggle = () => run({ action: cfg.update, id: item.id, status: active ? 'inactive' : 'active' }, { success: active ? '🔴 Deactivated' : '🟢 Activated' });
  const remove = () => {
    const extra = childCount ? ` and its ${childCount} ${childCount === 1 ? cfg.subNoun : `${cfg.subNoun}s`}` : '';
    if (window.confirm(`Delete "${name}"${extra} permanently?`)) run({ action: cfg.remove, id: item.id }, { success: '🗑️ Deleted' });
  };

  if (editing === idStr(item.id)) {
    return <div className={`admin-tree-row${isSub ? ' is-sub' : ''}`}><InlineEdit value={name} onSave={rename} onCancel={() => setEditing(null)} busy={busy} label={`Rename ${name}`} /></div>;
  }
  return (
    <div className={`admin-tree-row${isSub ? ' is-sub' : ''}${active ? '' : ' is-inactive'}`}>
      <span className="admin-tree-name">
        {isSub ? '↳ ' : `${cfg.icon} `}{name}
        {!active && <span className="admin-badge is-inactive">off</span>}
      </span>
      <div className="admin-row-actions">
        <button type="button" className="btn-gray btn-sm admin-icon-btn" onClick={() => onMove(-1)} disabled={!canUp || busy} aria-label={`Move ${name} up`} title="Move up">↑</button>
        <button type="button" className="btn-gray btn-sm admin-icon-btn" onClick={() => onMove(1)} disabled={!canDown || busy} aria-label={`Move ${name} down`} title="Move down">↓</button>
        <button type="button" className="btn-blue btn-sm admin-icon-btn" onClick={() => setEditing(idStr(item.id))} aria-label={`Rename ${name}`} title="Rename">✏️</button>
        <button type="button" className={`${active ? 'btn-red' : 'btn-green'} btn-sm admin-icon-btn`} onClick={toggle} disabled={busy} aria-label={`${active ? 'Deactivate' : 'Activate'} ${name}`} title={active ? 'Deactivate' : 'Activate'}>{active ? '🔴' : '🟢'}</button>
        <button type="button" className="btn-red btn-sm admin-icon-btn" onClick={remove} disabled={busy} aria-label={`Delete ${name}`} title="Delete">🗑️</button>
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

  return (
    <>
      <p className="admin-help">{cfg.help}</p>
      <form className="admin-form" onSubmit={add}>
        <div className="admin-form-title">➕ Add {cfg.noun} or {cfg.subNoun}</div>
        <label htmlFor={`${kind}Parent`}>Parent (blank = top-level {cfg.noun})</label>
        <select id={`${kind}Parent`} value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">— None (top-level) —</option>
          {activeTops.map(t => <option key={idStr(t.item.id)} value={idStr(t.item.id)}>{t.item[cfg.field]}</option>)}
        </select>
        <label htmlFor={`${kind}Name`}>Name</label>
        <input id={`${kind}Name`} value={name} onChange={(e) => setName(e.target.value)} placeholder={cfg.placeholder} />
        <button type="submit" className="btn-green" disabled={busy}>✅ Add</button>
      </form>

      <div className="admin-list-title">📋 All {cfg.nouns} ({items.length})</div>
      <div className="admin-list-scroll admin-tree">
        {!tree.tops.length && !tree.orphans.length && <p className="history-empty">No {cfg.nouns} yet.</p>}
        {tree.tops.map((t, i) => (
          <div key={idStr(t.item.id)} className="admin-tree-group">
            <ItemRow item={t.item} cfg={cfg} canUp={i > 0} canDown={i < tree.tops.length - 1} onMove={(d) => moveTop(i, d)}
              editing={editing} setEditing={setEditing} run={run} busy={busy} childCount={t.children.length} />
            {t.children.map((c, ci) => (
              <ItemRow key={idStr(c.id)} item={c} cfg={cfg} isSub canUp={ci > 0} canDown={ci < t.children.length - 1}
                onMove={(d) => moveChild(i, ci, d)} editing={editing} setEditing={setEditing} run={run} busy={busy} childCount={0} />
            ))}
            {!t.children.length && <div className="admin-tree-empty">No {cfg.subNoun}s yet.</div>}
          </div>
        ))}
        {tree.orphans.length > 0 && (
          <div className="admin-tree-group is-orphans">
            <div className="admin-tree-orphan-title">⚠️ Unassigned — parent no longer exists</div>
            {tree.orphans.map(o => (
              <ItemRow key={idStr(o.id)} item={o} cfg={cfg} isSub canUp={false} canDown={false} onMove={() => {}}
                editing={editing} setEditing={setEditing} run={run} busy={busy} childCount={0} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
