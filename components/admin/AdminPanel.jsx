'use client';

import { useMemo, useState } from 'react';
import { apiMutate } from '../../lib/client/api';
import { formatQty, groupSubmissions } from '../../lib/materials/consumption';
import { useApp } from '../app/AppContext';
import Icon from '../ui/Icon';
import { siteDisplayName, toYMD, formatDisplayDate } from '../../lib/report/reportModel';
import ContractorsAdmin from './ContractorsAdmin';
import HierarchyAdmin from './HierarchyAdmin';
import MaterialsAdmin from './MaterialsAdmin';
import UsersAdmin from './UsersAdmin';

// "10 Bags Cement" for a one-material submission, else "a submission of 3 materials".
function describe(sub) {
  if (sub.entries.length === 1) { const e = sub.entries[0]; return `${formatQty(e.qty)} ${e.unit} ${e.material_name}`; }
  return `a submission of ${sub.entries.length} materials`;
}

function EditRequests({ pending, pendingLogs }) {
  const { projects, approveEdit, showToast, reloadMaterialLogs } = useApp();
  const [busy, setBusy] = useState(null);

  // One request per submission. Approve: an edit is granted (they may
  // edit the submission once); a delete removes the whole submission.
  const resolve = async (sub, approve) => {
    const what = sub.request.type === 'delete' ? 'delete' : 'edit';
    if (approve && what === 'delete' && !window.confirm(`Delete ${describe(sub)} (${sub.site}) permanently?`)) return;
    setBusy(sub.key);
    try {
      const res = await apiMutate({ action: 'resolveMaterialLogRequest', ids: sub.entries.map(e => e.id), approve });
      showToast(res.result === 'deleted' ? '🗑️ Submission deleted' : res.result === 'granted' ? `✅ ${sub.request.by || 'They'} can now edit this submission` : 'Request declined');
      reloadMaterialLogs();
    } catch (err) {
      showToast(`⚠️ ${err.message || 'Action failed'}`);
    } finally {
      setBusy(null);
    }
  };

  if (!pending.length && !pendingLogs.length) {
    return <div className="list"><div className="empty"><h3>No requests waiting</h3><p className="muted">When a supervisor asks to change a locked report or consumption entry, it shows up here.</p></div></div>;
  }
  return (
    <div className="stack">
      {pending.length > 0 && (
        <section>
          <div className="list-bar"><h2 className="panel-title">Daily reports <em>({pending.length})</em></h2></div>
          <div className="list">
            {pending.map(item => (
              <div key={`${toYMD(item.date)}||${item.site}`} className="lrow simple">
                <div>
                  <b>{item.requestedBy || 'Someone'}</b> wants to edit <b>{siteDisplayName(item.site, projects)}</b>, {formatDisplayDate(item.date)}
                  <div className="sub">Originally filed by {item.by || '—'}.</div>
                </div>
                <div className="row">
                  <button type="button" className="btn sm primary" onClick={() => approveEdit(item)}><Icon name="check" />Allow edit</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {pendingLogs.length > 0 && (
        <section>
          <div className="list-bar"><h2 className="panel-title">Material consumption <em>({pendingLogs.length})</em></h2></div>
          <div className="list">
            {pendingLogs.map(sub => {
              const del = sub.request.type === 'delete';
              return (
                <div key={sub.key} className="lrow simple">
                  <div>
                    <b>{sub.request.by || 'Someone'}</b> wants to <b>{del ? 'delete' : 'edit'}</b> <b>{describe(sub)}</b> — {siteDisplayName(sub.site, projects)}, {formatDisplayDate(sub.date)}
                    <div className="sub">
                      <span className={`tag ${del ? 'danger' : 'warn'}`}>{del ? 'Delete' : 'Edit'}</span> {sub.entries.map(e => `${e.material_name} ${formatQty(e.qty)} ${e.unit}`.trim()).join(', ')} · logged by {sub.loggedBy || '—'}
                    </div>
                  </div>
                  <div className="row">
                    <button type="button" className="btn sm danger" onClick={() => resolve(sub, false)} disabled={busy === sub.key}>Decline</button>
                    <button type="button" className="btn sm primary" onClick={() => resolve(sub, true)} disabled={busy === sub.key}>
                      <Icon name={del ? 'trash' : 'check'} />{del ? 'Approve & delete' : 'Allow edit'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

// Same order as the sidebar's System / Admin group (AppShell).
const SECTIONS = {
  contractors: { tab: 'Contractors', title: 'Contractors', lede: 'Contractors and the sites they work on. The DPR and Materials forms offer only the contractors allocated to the chosen site.' },
  users: { tab: 'Users', title: 'Users & site assignments', lede: 'Who can sign in, and which sites each supervisor sees and reports on.' },
  sites: { tab: 'Sites', title: 'Sites', lede: 'Projects and their sub-sites. Reports are filed on sub-sites; a parent groups them.' },
  activities: { tab: 'Activities', title: 'Activities', lede: 'The activity list offered on manpower rows.' },
  materials: { tab: 'Material catalogue', title: 'Material catalogue', lede: 'The materials offered when logging consumption.' },
  requests: { tab: 'Edit requests', title: 'Edit requests', lede: 'Supervisors asking to change a locked report or consumption entry.' },
};

// The section comes from the sidebar (or, on phones, the tabs below the
// heading) via AppContext.adminSection.
export default function AdminPanel() {
  const { history, materialLogs, adminSection, switchTab } = useApp();
  const pending = useMemo(() => history.filter(h => h.editPermission === 'pending'), [history]);
  // Whole submissions with a waiting request (all their entries, for context).
  const pendingLogs = useMemo(() => groupSubmissions(materialLogs).filter(s => s.request.status === 'pending'), [materialLogs]);
  const pendingCount = pending.length + pendingLogs.length;
  const tab = SECTIONS[adminSection] ? adminSection : 'requests';
  const sec = SECTIONS[tab];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{sec.title}</h1>
          <p className="lede">{sec.lede}</p>
        </div>
      </div>
      <div className="tabs admin-tabs" role="tablist" aria-label="Admin sections">
        {Object.entries(SECTIONS).map(([k, { tab: label }]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => switchTab('Admin', { section: k })}>
            {label}{k === 'requests' && pendingCount ? ` (${pendingCount})` : ''}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'contractors' && <ContractorsAdmin />}
        {tab === 'requests' && <EditRequests pending={pending} pendingLogs={pendingLogs} />}
        {tab === 'users' && <UsersAdmin />}
        {tab === 'sites' && <HierarchyAdmin kind="projects" />}
        {tab === 'activities' && <HierarchyAdmin kind="activities" />}
        {tab === 'materials' && <MaterialsAdmin />}
      </div>
    </>
  );
}
