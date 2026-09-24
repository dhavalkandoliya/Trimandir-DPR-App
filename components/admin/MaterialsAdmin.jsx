'use client';

import { useState } from 'react';
import { useApp } from '../app/AppContext';
import { QTY_UNIT_SUGGESTIONS } from '../../lib/materials/consumption';
import { useAdminAction } from './useAdminAction';

function MaterialRow({ m, run, busy }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(m.material_name);
  const [unit, setUnit] = useState(m.unit || '');
  const active = m.status !== 'inactive';

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const ok = await run({ action: 'updateMaterial', id: m.id, material_name: name.trim(), unit: unit.trim() }, { success: '✅ Material updated' });
    if (ok) setEditing(false);
  };
  const toggle = () => run({ action: 'updateMaterial', id: m.id, status: active ? 'inactive' : 'active' }, { success: active ? '🔴 Deactivated' : '🟢 Activated' });
  const remove = () => {
    if (window.confirm(`Delete material "${m.material_name}"? Consumption entries already logged keep their material name.`)) {
      run({ action: 'deleteMaterial', id: m.id }, { success: '🗑️ Deleted' });
    }
  };

  if (editing) {
    return (
      <form className="admin-tree-row admin-inline-form" onSubmit={save}>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Material name" autoFocus />
        <input value={unit} onChange={(e) => setUnit(e.target.value)} list="materialUnitSuggestions" placeholder="Default unit" aria-label="Default unit" className="admin-unit-input" />
        <button type="submit" className="btn-green btn-sm admin-inline-btn" disabled={busy || !name.trim()}>Save</button>
        <button type="button" className="btn-gray btn-sm admin-inline-btn" onClick={() => { setEditing(false); setName(m.material_name); setUnit(m.unit || ''); }}>Cancel</button>
      </form>
    );
  }
  return (
    <div className={`admin-tree-row${active ? '' : ' is-inactive'}`}>
      <span className="admin-tree-name">
        {m.material_name}
        <span className="admin-tree-meta">{m.unit ? `Default unit: ${m.unit}` : 'No default unit'}</span>
      </span>
      <div className="admin-row-actions">
        <button type="button" className="btn-blue btn-sm admin-icon-btn" onClick={() => setEditing(true)} aria-label={`Edit ${m.material_name}`} title="Edit">✏️</button>
        <button type="button" className={`${active ? 'btn-red' : 'btn-green'} btn-sm admin-icon-btn`} onClick={toggle} disabled={busy} aria-label={`${active ? 'Deactivate' : 'Activate'} ${m.material_name}`} title={active ? 'Deactivate' : 'Activate'}>{active ? '🔴' : '🟢'}</button>
        <button type="button" className="btn-red btn-sm admin-icon-btn" onClick={remove} disabled={busy} aria-label={`Delete ${m.material_name}`} title="Delete">🗑️</button>
      </div>
    </div>
  );
}

export default function MaterialsAdmin() {
  const { materials, showToast } = useApp();
  const { run, busy } = useAdminAction();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');

  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) { showToast('⚠️ Enter material name'); return; }
    if (materials.some(m => m.material_name.trim().toLowerCase() === name.trim().toLowerCase())) { showToast('⚠️ That material already exists'); return; }
    const ok = await run({ action: 'addMaterial', material_name: name.trim(), unit: unit.trim() }, { success: '✅ Material added', pending: '⏳ Adding...' });
    if (ok) { setName(''); setUnit(''); }
  };

  const sorted = [...materials].sort((a, b) => String(a.material_name).localeCompare(String(b.material_name)));

  return (
    <>
      <p className="admin-help">The materials offered when logging consumption entries. The unit is only a default — each entry records its own unit.</p>
      <datalist id="materialUnitSuggestions">{QTY_UNIT_SUGGESTIONS.map(u => <option key={u} value={u} />)}</datalist>
      <form className="admin-form" onSubmit={add}>
        <div className="admin-form-title">➕ Add Material</div>
        <label htmlFor="newMaterialName">Material Name</label>
        <input id="newMaterialName" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cement - OPC" />
        <label htmlFor="newMaterialUnit">Default Unit <span className="entry-optional">(Optional)</span></label>
        <input id="newMaterialUnit" value={unit} onChange={(e) => setUnit(e.target.value)} list="materialUnitSuggestions" placeholder="e.g. Bags, Nos, Brass, Kg" />
        <button type="submit" className="btn-green" disabled={busy}>✅ Add Material</button>
      </form>
      <div className="admin-list-title">🧱 All Materials ({materials.length})</div>
      <div className="admin-list-scroll admin-tree">
        {sorted.length ? sorted.map(m => <MaterialRow key={m.id} m={m} run={run} busy={busy} />) : <p className="history-empty">No materials yet.</p>}
      </div>
    </>
  );
}
