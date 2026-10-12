'use client';

import { DEFAULT_ADMIN_SECTION, useApp } from '../app/AppContext';
import ContractorsAdmin from './ContractorsAdmin';
import HierarchyAdmin from './HierarchyAdmin';
import MaterialsAdmin from './MaterialsAdmin';
import UsersAdmin from './UsersAdmin';

// Same order as the sidebar's System / Admin group (AppShell).
const SECTIONS = {
  contractors: { tab: 'Contractors', title: 'Contractors', lede: 'Contractors and the sites they work on. The DPR and Materials forms offer only the contractors allocated to the chosen site.' },
  users: { tab: 'Users', title: 'Users & site assignments', lede: 'Who can sign in, and which sites each supervisor sees and reports on.' },
  sites: { tab: 'Sites', title: 'Sites', lede: 'Projects and their sub-sites. Reports are filed on sub-sites; a parent groups them.' },
  activities: { tab: 'Activities', title: 'Activities', lede: 'The activity list offered on manpower rows.' },
  materials: { tab: 'Material catalogue', title: 'Material catalogue', lede: 'The materials offered when logging consumption.' },
};

// The section comes from the sidebar (or, on phones, the tabs below the
// heading) via AppContext.adminSection.
export default function AdminPanel() {
  const { adminSection, switchTab } = useApp();
  const tab = SECTIONS[adminSection] ? adminSection : DEFAULT_ADMIN_SECTION;
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
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'contractors' && <ContractorsAdmin />}
        {tab === 'users' && <UsersAdmin />}
        {tab === 'sites' && <HierarchyAdmin kind="projects" />}
        {tab === 'activities' && <HierarchyAdmin kind="activities" />}
        {tab === 'materials' && <MaterialsAdmin />}
      </div>
    </>
  );
}
