'use client';

import { useId } from 'react';
import {
  OUTPUT_UNIT_SUGGESTIONS, OWNERSHIP_OPTIONS, QTY_UNIT_SUGGESTIONS, TRUST, normalizeOwnership,
} from '../../lib/materials/consumption';

// One consumption entry: Material · Qty · Unit · Ownership · Contractor ·
// Output / Work Done (qty + unit) · Remarks. Shared by the Materials screen
// and the Entry form's materials section.
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
    <div className="activitybox ce-row">
      <div className="entry-row-head">
        <span className="entry-row-title">Entry {index + 1}</span>
        <div className="entry-row-actions">
          {ownership !== TRUST && <span className="ce-excluded">Not in Trust totals</span>}
          {canRemove && (
            <button type="button" className="delete-btn entry-row-remove" onClick={onRemove} aria-label={`Remove entry ${index + 1}`}>✕</button>
          )}
        </div>
      </div>

      <div className="ce-grid ce-grid-main">
        <div>
          <label htmlFor={`${uid}-mat`}>Material Name</label>
          <select id={`${uid}-mat`} value={row.name} onChange={(e) => onMaterial(e.target.value)}>
            <option value="">— Select Material —</option>
            {materials.map(m => <option key={m.id} value={m.material_name}>{m.material_name}</option>)}
            {row.name && !known && <option value={row.name}>{row.name}</option>}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-qty`}>Qty</label>
          <input id={`${uid}-qty`} type="number" min="0" step="any" inputMode="decimal" value={row.qty} onChange={(e) => update({ qty: e.target.value })} placeholder="0" />
        </div>
        <div>
          <label htmlFor={`${uid}-unit`}>Unit</label>
          <input id={`${uid}-unit`} list={`${uid}-units`} value={row.unit} onChange={(e) => update({ unit: e.target.value })} placeholder="Bags" autoComplete="off" />
          <datalist id={`${uid}-units`}>{QTY_UNIT_SUGGESTIONS.map(u => <option key={u} value={u} />)}</datalist>
        </div>
      </div>

      <div className="ce-grid ce-grid-two">
        <div>
          <label htmlFor={`${uid}-own`}>Ownership</label>
          <select id={`${uid}-own`} value={ownership} onChange={(e) => update({ ownership: e.target.value })}>
            {OWNERSHIP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${uid}-con`}>Contractor{isContractor ? ' *' : <span className="entry-optional"> (Optional)</span>}</label>
          <input
            id={`${uid}-con`}
            list={`${uid}-cons`}
            value={row.contractor}
            onChange={(e) => update({ contractor: e.target.value })}
            placeholder={isContractor ? 'Contractor name' : 'Who used it (optional)'}
            aria-required={isContractor}
            autoComplete="off"
          />
          <datalist id={`${uid}-cons`}>{contractorSuggestions.map(c => <option key={c} value={c} />)}</datalist>
        </div>
      </div>

      <div className="ce-grid ce-grid-two">
        <div>
          <label htmlFor={`${uid}-out`}>Output / Work Done <span className="entry-optional">(Optional)</span></label>
          <input id={`${uid}-out`} type="number" min="0" step="any" inputMode="decimal" value={row.outputQty} onChange={(e) => update({ outputQty: e.target.value })} placeholder="e.g. 62" />
        </div>
        <div>
          <label htmlFor={`${uid}-outu`}>Output Unit</label>
          <input id={`${uid}-outu`} list={`${uid}-outunits`} value={row.outputUnit} onChange={(e) => update({ outputUnit: e.target.value })} placeholder="Rft / Sq.ft / Cu.m" autoComplete="off" />
          <datalist id={`${uid}-outunits`}>{OUTPUT_UNIT_SUGGESTIONS.map(u => <option key={u} value={u} />)}</datalist>
        </div>
      </div>

      <label htmlFor={`${uid}-rem`}>Remarks <span className="entry-optional">(Optional)</span></label>
      <input id={`${uid}-rem`} type="text" value={row.remarks} onChange={(e) => update({ remarks: e.target.value })} placeholder="e.g. Door frame - granite work" />
    </div>
  );
}
