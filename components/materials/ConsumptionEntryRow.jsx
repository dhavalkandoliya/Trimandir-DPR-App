'use client';

import { useId } from 'react';
import {
  OUTPUT_UNIT_SUGGESTIONS, OWNERSHIP_OPTIONS, QTY_UNIT_SUGGESTIONS, TRUST, normalizeOwnership,
} from '../../lib/materials/consumption';
import Icon from '../ui/Icon';

// One consumption entry: Material · Qty · Unit, then Ownership ·
// Contractor · Output / Work Done (qty + unit), then Remarks. Shared by the
// Materials screen and the Entry form's materials section.
export default function ConsumptionEntryRow({ index, row, materials, contractorSuggestions = [], onChange, onRemove, canRemove = true }) {
  const uid = useId();
  const ownership = normalizeOwnership(row.ownership);
  const isContractor = ownership === 'Contractor';
  const update = (patch) => onChange({ ...row, ...patch });

  const onMaterial = (name) => {
    const prev = materials.find(m => m.material_name === row.name);
    const next = materials.find(m => m.material_name === name);
    // Pre-fill the unit from the material list unless the user typed their own.
    const unitUntouched = !row.unit || (prev && row.unit === (prev.unit || ''));
    update({ name, unit: unitUntouched ? ((next && next.unit) || '') : row.unit });
  };

  const known = materials.some(m => m.material_name === row.name);

  return (
    <div className="ce-row">
      <div className="ce-head">
        <b>Entry {index + 1}</b>
        <div className="row" style={{ gap: 8 }}>
          {ownership !== TRUST && <span className="own-note">Not in Trust totals</span>}
          {canRemove && (
            <button type="button" className="icon-btn danger" onClick={onRemove} aria-label={`Remove entry ${index + 1}`} title="Remove entry">
              <Icon name="trash" />
            </button>
          )}
        </div>
      </div>

      <div className="ce-grid main">
        <label className="field">
          <span>Material</span>
          <select className="select" value={row.name} onChange={(e) => onMaterial(e.target.value)}>
            <option value="">Choose material</option>
            {materials.map(m => <option key={m.id} value={m.material_name}>{m.material_name}</option>)}
            {row.name && !known && <option value={row.name}>{row.name}</option>}
          </select>
        </label>
        <label className="field">
          <span>Qty</span>
          <input className="input" type="number" min="0" step="any" inputMode="decimal" value={row.qty} onChange={(e) => update({ qty: e.target.value })} placeholder="0" />
        </label>
        <label className="field">
          <span>Unit</span>
          <input className="input" list={`${uid}-units`} value={row.unit} onChange={(e) => update({ unit: e.target.value })} placeholder="Bags" autoComplete="off" />
          <datalist id={`${uid}-units`}>{QTY_UNIT_SUGGESTIONS.map(u => <option key={u} value={u} />)}</datalist>
        </label>
      </div>

      <div className="ce-grid four">
        <label className="field">
          <span>Ownership</span>
          <select className="select" value={ownership} onChange={(e) => update({ ownership: e.target.value })}>
            {OWNERSHIP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Contractor {isContractor ? '' : <em>(optional)</em>}</span>
          <input
            className="input"
            list={`${uid}-cons`}
            value={row.contractor}
            onChange={(e) => update({ contractor: e.target.value })}
            placeholder={isContractor ? 'Contractor name' : 'Who used it'}
            aria-required={isContractor}
            autoComplete="off"
          />
          <datalist id={`${uid}-cons`}>{contractorSuggestions.map(c => <option key={c} value={c} />)}</datalist>
        </label>
        <label className="field">
          <span>Output <em>(optional)</em></span>
          <input className="input" type="number" min="0" step="any" inputMode="decimal" value={row.outputQty} onChange={(e) => update({ outputQty: e.target.value })} placeholder="e.g. 62" />
        </label>
        <label className="field">
          <span>Output unit</span>
          <input className="input" list={`${uid}-outunits`} value={row.outputUnit} onChange={(e) => update({ outputUnit: e.target.value })} placeholder="Rft / Sq.ft" autoComplete="off" />
          <datalist id={`${uid}-outunits`}>{OUTPUT_UNIT_SUGGESTIONS.map(u => <option key={u} value={u} />)}</datalist>
        </label>
      </div>

      <div className="ce-grid">
        <label className="field">
          <span>Remarks <em>(optional)</em></span>
          <input className="input" type="text" value={row.remarks} onChange={(e) => update({ remarks: e.target.value })} placeholder="e.g. Door frame — granite work" />
        </label>
      </div>
    </div>
  );
}
