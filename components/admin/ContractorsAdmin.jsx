'use client';

import { Fragment, useState } from 'react';
import { useApp } from '../app/AppContext';
import Icon from '../ui/Icon';
import SitePicker, { siteNames } from './SitePicker';
import { useAdminAction } from './useAdminAction';

const TRADE_SUGGESTIONS = ['Civil', 'Masonry', 'Carpentry', 'Electrical', 'Plumbing', 'Fabrication', 'Painting', 'Flooring', 'HVAC', 'Waterproofing'];

// One contractor: details, the sites they're allocated to, and inline
// edit / site-allocation rows.
function ContractorRow({ c, projects, run, busy }) {
  const [mode, setMode] = useState(null); // 'edit' | 'sites' | null
  const [form, setForm] = useState({ name: c.name, phone: c.phone, trade: c.trade });
  const active = c.status !== 'inactive';
  const sites = siteNames(c.sites, projects);

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const ok = await run({ action: 'updateContractor', id: c.id, name: form.name.trim(), phone: form.phone.trim(), trade: form.trade.trim() }, { success: '✅ Contractor updated' });
    if (ok) setMode(null);
  };
  const toggle = () => run({ action: 'updateContractor', id: c.id, status: active ? 'inactive' : 'active' }, { success: active ? 'Deactivated' : 'Activated' });
  const remove = () => {
    if (window.confirm(`Delete contractor "${c.name}"? Reports already filed keep the contractor's name.`)) {
      run({ action: 'deleteContractor', id: c.id }, { success: '🗑️ Contractor deleted' });
    }
  };
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <Fragment>
      <tr className={active ? '' : 'off'}>
        <td>
          <b>{c.name}</b>
          {(c.trade || c.phone) && <div className="sub">{[c.trade, c.phone].filter(Boolean).join(' · ')}</div>}
        </td>
        <td className="sites-cell">
          {sites.length ? sites.join(', ') : <span className="tag warn">No sites</span>}
          <div><button type="button" className="btn sm ghost" onClick={() => setMode(m => (m === 'sites' ? null : 'sites'))} aria-expanded={mode === 'sites'}>{mode === 'sites' ? 'Close' : 'Allocate sites'}</button></div>
        </td>
        <td>{active ? <span className="tag ok">Active</span> : <span className="tag">Inactive</span>}</td>
        <td className="acts">
          <button type="button" className="btn sm ghost" onClick={toggle} disabled={busy}>{active ? 'Deactivate' : 'Activate'}</button>
          <button type="button" className={`icon-btn${mode === 'edit' ? ' on' : ''}`} onClick={() => setMode(m => (m === 'edit' ? null : 'edit'))} aria-label={`Edit ${c.name}`} title="Edit"><Icon name="edit" /></button>
          <button type="button" className="icon-btn danger" onClick={remove} disabled={busy} aria-label={`Delete ${c.name}`} title="Delete"><Icon name="trash" /></button>
        </td>
      </tr>
      {mode === 'edit' && (
        <tr>
          <td colSpan={4}>
            <form className="inline-form" onSubmit={save}>
              <input className="input" value={form.name} onChange={set('name')} aria-label="Contractor name" autoFocus />
              <input className="input" value={form.trade} onChange={set('trade')} list="contractorTrades" placeholder="Trade" aria-label="Trade" style={{ maxWidth: 170 }} />
              <input className="input" value={form.phone} onChange={set('phone')} placeholder="Phone" aria-label="Phone" inputMode="tel" style={{ maxWidth: 170 }} />
              <button type="submit" className="btn sm primary" disabled={busy || !form.name.trim()}>Save</button>
              <button type="button" className="btn sm ghost" onClick={() => { setMode(null); setForm({ name: c.name, phone: c.phone, trade: c.trade }); }}>Cancel</button>
            </form>
          </td>
        </tr>
      )}
      {mode === 'sites' && (
        <tr>
          <td colSpan={4}>
            <SitePicker
              selected={c.sites}
              projects={projects}
              busy={busy}
              onCancel={() => setMode(null)}
              onSave={async (projectIds) => {
                const ok = await run({ action: 'setContractorSites', id: c.id, projectIds }, { success: `✅ Sites updated for ${c.name}` });
                if (ok) setMode(null);
              }}
            />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// Admin › Contractors: the contractor list and which sites each works on.
// The DPR and Materials forms offer only the contractors allocated to the
// chosen site (lib/sites.js contractorsForSite).
export default function ContractorsAdmin() {
  const { contractors, projects, showToast } = useApp();
  const { run, busy } = useAdminAction();
  const [form, setForm] = useState({ name: '', trade: '', phone: '' });

  const add = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) { showToast('⚠️ Enter the contractor name'); return; }
    if (contractors.some(c => c.name.trim().toLowerCase() === name.toLowerCase())) { showToast('⚠️ That contractor already exists'); return; }
    const ok = await run({ action: 'addContractor', name, trade: form.trade.trim(), phone: form.phone.trim() }, { success: `✅ ${name} added — now allocate their sites`, pending: '⏳ Adding...' });
    if (ok) setForm({ name: '', trade: '', phone: '' });
  };
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const sorted = [...contractors].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const unallocated = contractors.filter(c => c.status !== 'inactive' && !c.sites.length).length;

  return (
    <>
      <datalist id="contractorTrades">{TRADE_SUGGESTIONS.map(t => <option key={t} value={t} />)}</datalist>
      <form className="panel" onSubmit={add}>
        <h2 className="panel-title">Add contractor</h2>
        <div className="form-grid four-col">
          <label className="field">
            <span>Contractor name</span>
            <input className="input" value={form.name} onChange={set('name')} placeholder="e.g. Shree Ram Constructions" />
          </label>
          <label className="field">
            <span>Trade <em>(optional)</em></span>
            <input className="input" value={form.trade} onChange={set('trade')} list="contractorTrades" placeholder="e.g. Civil, Electrical" />
          </label>
          <label className="field">
            <span>Phone <em>(optional)</em></span>
            <input className="input" value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="e.g. 98250 12345" />
          </label>
          <button type="submit" className="btn primary" disabled={busy}><Icon name="plus" />Add contractor</button>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>Allocate each contractor to the sites they work on. When a supervisor picks a site in a DPR or a consumption entry, only that site’s contractors are offered. Allocating a parent site covers all of its sub-sites.</p>
      </form>

      <div className="list-bar section-gap">
        <h2 className="panel-title">Contractors <em>({contractors.length})</em></h2>
        {unallocated > 0 && <span className="tag warn">{unallocated} without sites</span>}
      </div>
      {sorted.length ? (
        <div className="list tscroll">
          <table className="dt">
            <thead><tr><th>Contractor</th><th>Sites</th><th>Status</th><th /></tr></thead>
            <tbody>{sorted.map(c => <ContractorRow key={c.id} c={c} projects={projects} run={run} busy={busy} />)}</tbody>
          </table>
        </div>
      ) : (
        <div className="list"><div className="empty"><h3>No contractors yet</h3><p className="muted">Add the first one above, then allocate their sites.</p></div></div>
      )}
    </>
  );
}
