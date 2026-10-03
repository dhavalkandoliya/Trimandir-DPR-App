-- ════════════════════════════════════════════════════════════════
-- 006 — Site assignments for supervisors (user_sites)
--
-- Additive and safe to re-run. Apply BEFORE deploying the code that uses
-- it: until this table exists the server refuses data requests from
-- non-admin users (it fails closed rather than showing every site).
--
-- A supervisor (role 'user') sees and reports on only the sites assigned
-- here; an admin always sees everything and needs no rows. Assigning a
-- parent site covers all of its sub-sites. Assignments are managed in
-- Admin › Users (setUserSites); a supervisor with none sees no sites.
-- ════════════════════════════════════════════════════════════════

create table if not exists user_sites (
  user_id    uuid   not null references users (id) on delete cascade,
  project_id bigint not null references projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

create index if not exists idx_user_sites_project_id on user_sites (project_id);
