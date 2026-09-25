'use client';

import { useState } from 'react';
import { useApp } from '../app/AppContext';
import Icon from '../ui/Icon';
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
  const toggle = () => run({ action: 'updateMaterial', id: m.id, status: active ? 'inactive' : 'active' }, { success: active ? 'Deactivated' : 'Activated' });
  const remove = () => {
    if (window.confirm(`Delete material "${m.material_name}"? Consumption entries already logged keep their material name.`)) {
      run({ action: 'deleteMaterial', id: m.id }, { success: '🗑️ Deleted' });
    }
  };

  if (editing) {
    return (
      <tr>
        <td colSpan={4}>
          <form className="inline-form" onSubmit={save}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Material name" autoFocus />
            <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} list="materialUnitSuggestions" placeholder="Default unit" aria-label="Default unit" style={{ maxWidth: 160 }} />
            <button type="submit" className="btn sm primary" disabled={busy || !name.trim()}>Save</button>
            <button type="button" className="btn sm ghost" onClick={() => { setEditing(false); setName(m.material_name); setUnit(m.unit || ''); }}>Cancel</button>
          </form>
        </td>
      </tr>
    );
  }
  return (
    <tr className={active ? '' : 'off'}>
      <td><b>{m.material_name}</b></td>
      <td>{m.unit || <span className="muted">—</span>}</td>
      <td>{active ? <span className="tag ok">Active</span> : <span className="tag">Inactive</span>}</td>
      <td className="acts">
        <button type="button" className="btn sm ghost" onClick={toggle} disabled={busy}>{active ? 'Deactivate' : 'Activate'}</button>
        <button type="button" className="icon-btn" onClick={() => setEditing(true)} aria-label={`Edit ${m.material_name}`} title="Edit"><Icon name="edit" /></button>
        <button type="button" className="icon-btn danger" onClick={remove} disabled={busy} aria-label={`Delete ${m.material_name}`} title="Delete"><Icon name="trash" /></button>
      </td>
    </tr>
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
      <datalist id="materialUnitSuggestions">{QTY_UNIT_SUGGESTIONS.map(u => <option key={u} value={u} />)}</datalist>
      <form className="panel" onSubmit={add}>
        <h2 className="panel-title">Add material</h2>
        <div className="form-grid three">
          <label className="field">
            <span>Material name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cement - OPC" />
          </label>
          <label className="field">
            <span>Default unit <em>(optional)</em></span>
            <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} list="materialUnitSuggestions" placeholder="e.g. Bags, Nos, Brass, Kg" />
          </label>
          <button type="submit" className="btn primary" disabled={busy}><Icon name="plus" />Add material</button>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>The materials offered when logging consumption. The unit is only a default — each entry records its own unit.</p>
      </form>

      <div className="list-bar section-gap">
        <h2 className="panel-title">Material catalogue <em>({materials.length})</em></h2>
      </div>
      {sorted.length ? (
        <div className="list tscroll">
          <table className="dt">
            <thead><tr><th>Material</th><th>Default unit</th><th>Status</th><th /></tr></thead>
            <tbody>{sorted.map(m => <MaterialRow key={m.id} m={m} run={run} busy={busy} />)}</tbody>
          </table>
        </div>
      ) : (
        <div className="list"><div className="empty"><h3>No materials yet</h3><p className="muted">Add the first one above.</p></div></div>
      )}
    </>
  );
}
