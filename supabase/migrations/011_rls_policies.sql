-- ════════════════════════════════════════════════════════════════
-- 011 — Row Level Security on every table
--
-- WHY NOW: with RLS off, anyone holding the project's anon key could read
-- and write every table through the Supabase REST API — users (with
-- password hashes) included. Enabling RLS closes that: the anon role
-- matches no policy below, so it sees and changes nothing.
--
-- HOW THE APP IS AFFECTED: not at all. The app's server (app/api/proxy →
-- lib/dprSupabaseApi.js) uses the service-role key, which bypasses RLS,
-- and enforces these same rules in code (lib/sites.js scope, ownership
-- checks).
--
-- WHO THE POLICIES ARE FOR: a request made as an app user — a JWT with
-- role "authenticated" and sub = users.id. The app doesn't send those yet
-- (it signs users in itself, not via Supabase Auth); when the server
-- starts issuing per-user tokens, these policies enforce the rules in the
-- database too:
--
--   admin       full access to every table
--   supervisor  SELECT  rows on sites assigned in user_sites (an assigned
--                       parent covers its sub-sites)
--               INSERT  DPRs / consumption entries on those sites, as
--                       themselves
--               UPDATE  their own DPRs / entries on those sites
--               DELETE  their own consumption entries; DPRs: admin only
--                       (a DPR's own manpower lines may be replaced by its
--                       author — editing a DPR rewrites them)
--               master data (projects, activities, materials, contractors,
--               assignments): read what they can see, never write
--
-- Helper functions are SECURITY DEFINER (they read users / user_sites /
-- projects without RLS, so policies never recurse) and STABLE; policies
-- call them through (select …) so each runs once per statement.
--
-- The tables are named as in this database: projects (the sites table),
-- dpr_records.prepared_by / material_logs.logged_by (who filed it), and
-- `site` holds the site's full path (migrations/009).
--
-- Safe to re-run.
-- ════════════════════════════════════════════════════════════════

begin;

-- ── Helpers ─────────────────────────────────────────────────────

-- The signed-in app user (users.id), from the request JWT's `sub`.
create or replace function app_user_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select u.id from users u where u.id = auth.uid()
$$;

create or replace function app_username() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select u.username from users u where u.id = auth.uid()
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
$$;

-- Every project's full path, "Parent › Sub-site" (lib/sites.js sitePaths).
create or replace function project_paths() returns table (id bigint, path text)
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive tree as (
    select p.id, trim(coalesce(p.sub_project_name, p.main_project_name)) as path
    from projects p where p.parent_id is null
    union all
    select p.id, t.path || ' › ' || trim(coalesce(p.sub_project_name, p.main_project_name))
    from projects p join tree t on p.parent_id = t.id
  )
  select id, path from tree
$$;

-- Projects the current user's assignments cover: each assigned project
-- and everything under it (lib/sites.js scopeFor). All, for an admin.
create or replace function covered_project_ids() returns setof bigint
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive covered as (
    select us.project_id as id from user_sites us where us.user_id = auth.uid()
    union
    select p.id from projects p join covered c on p.parent_id = c.id
  )
  select id from covered where not is_admin()
  union
  select id from projects where is_admin()
$$;

-- What the user may see in the project list: covered projects plus their
-- ancestors (so "Parent › Sub-site" still resolves).
create or replace function visible_project_ids() returns setof bigint
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive up as (
    select p.id, p.parent_id from projects p where p.id in (select covered_project_ids())
    union
    select p.id, p.parent_id from projects p join up on p.id = up.parent_id
  )
  select id from up
$$;

-- Site paths the user may read and file reports on.
create or replace function user_site_paths() returns setof text
language sql stable security definer set search_path = public, pg_temp as $$
  select pp.path from project_paths() pp where pp.id in (select covered_project_ids())
$$;

create or replace function has_site_access(p_project_id bigint) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select is_admin() or p_project_id in (select covered_project_ids())
$$;

create or replace function has_site_path_access(p_site text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select is_admin() or p_site in (select user_site_paths())
$$;

-- True when the current user filed it (case-insensitive, like the app).
create or replace function is_own(p_author text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select lower(trim(coalesce(p_author, ''))) = lower(trim(coalesce(app_username(), '')))
     and app_username() is not null
$$;

revoke all on function app_user_id(), app_username(), is_admin(), project_paths(), covered_project_ids(),
  visible_project_ids(), user_site_paths(), has_site_access(bigint), has_site_path_access(text), is_own(text) from public;
grant execute on function app_user_id(), app_username(), is_admin(), project_paths(), covered_project_ids(),
  visible_project_ids(), user_site_paths(), has_site_access(bigint), has_site_path_access(text), is_own(text)
  to authenticated, service_role;

-- ── Enable RLS everywhere ───────────────────────────────────────
alter table users                enable row level security;
alter table projects             enable row level security;
alter table user_sites           enable row level security;
alter table contractors          enable row level security;
alter table site_contractors     enable row level security;
alter table activities           enable row level security;
alter table materials            enable row level security;
alter table dpr_records          enable row level security;
alter table dpr_manpower_entries enable row level security;
alter table material_logs        enable row level security;

-- ── users: admins manage; everyone else sees only themselves ────
drop policy if exists users_admin_all on users;
create policy users_admin_all on users for all to authenticated
  using ((select is_admin())) with check ((select is_admin()));
drop policy if exists users_self_select on users;
create policy users_self_select on users for select to authenticated
  using (id = (select app_user_id()));

-- ── projects (sites) ────────────────────────────────────────────
drop policy if exists projects_admin_all on projects;
create policy projects_admin_all on projects for all to authenticated
  using ((select is_admin())) with check ((select is_admin()));
drop policy if exists projects_select_visible on projects;
create policy projects_select_visible on projects for select to authenticated
  using (id in (select visible_project_ids()));

-- ── user_sites ──────────────────────────────────────────────────
drop policy if exists user_sites_admin_all on user_sites;
create policy user_sites_admin_all on user_sites for all to authenticated
  using ((select is_admin())) with check ((select is_admin()));
drop policy if exists user_sites_select_own on user_sites;
create policy user_sites_select_own on user_sites for select to authenticated
  using (user_id = (select app_user_id()));

-- ── contractors + site_contractors ──────────────────────────────
drop policy if exists contractors_admin_all on contractors;
create policy contractors_admin_all on contractors for all to authenticated
  using ((select is_admin())) with check ((select is_admin()));
drop policy if exists contractors_select_visible on contractors;
create policy contractors_select_visible on contractors for select to authenticated
  using (exists (select 1 from site_contractors sc
                 where sc.contractor_id = contractors.id
                   and sc.project_id in (select visible_project_ids())));

drop policy if exists site_contractors_admin_all on site_contractors;
create policy site_contractors_admin_all on site_contractors for all to authenticated
  using ((select is_admin())) with check ((select is_admin()));
drop policy if exists site_contractors_select_visible on site_contractors;
create policy site_contractors_select_visible on site_contractors for select to authenticated
  using (project_id in (select visible_project_ids()));

-- ── activities, materials: everyone signed in reads; admins write ─
drop policy if exists activities_admin_all on activities;
create policy activities_admin_all on activities for all to authenticated
  using ((select is_admin())) with check ((select is_admin()));
drop policy if exists activities_select on activities;
create policy activities_select on activities for select to authenticated
  using ((select app_user_id()) is not null);

drop policy if exists materials_admin_all on materials;
create policy materials_admin_all on materials for all to authenticated
  using ((select is_admin())) with check ((select is_admin()));
drop policy if exists materials_select on materials;
create policy materials_select on materials for select to authenticated
  using ((select app_user_id()) is not null);

-- ── dpr_records ─────────────────────────────────────────────────
drop policy if exists dpr_records_admin_all on dpr_records;
create policy dpr_records_admin_all on dpr_records for all to authenticated
  using ((select is_admin())) with check ((select is_admin()));
drop policy if exists dpr_records_select on dpr_records;
create policy dpr_records_select on dpr_records for select to authenticated
  using (site in (select user_site_paths()));
drop policy if exists dpr_records_insert on dpr_records;
create policy dpr_records_insert on dpr_records for insert to authenticated
  with check (site in (select user_site_paths()) and is_own(prepared_by));
drop policy if exists dpr_records_update_own on dpr_records;
create policy dpr_records_update_own on dpr_records for update to authenticated
  using (site in (select user_site_paths()) and is_own(prepared_by))
  with check (site in (select user_site_paths()) and is_own(prepared_by));
-- No supervisor DELETE policy: deleting a DPR is admin-only.

-- ── dpr_manpower_entries: follow their DPR ──────────────────────
drop policy if exists dpr_entries_admin_all on dpr_manpower_entries;
create policy dpr_entries_admin_all on dpr_manpower_entries for all to authenticated
  using ((select is_admin())) with check ((select is_admin()));
drop policy if exists dpr_entries_select on dpr_manpower_entries;
create policy dpr_entries_select on dpr_manpower_entries for select to authenticated
  using (exists (select 1 from dpr_records r where r.id = dpr_record_id and r.site in (select user_site_paths())));
drop policy if exists dpr_entries_write_own on dpr_manpower_entries;
create policy dpr_entries_write_own on dpr_manpower_entries for all to authenticated
  using (exists (select 1 from dpr_records r where r.id = dpr_record_id
                 and r.site in (select user_site_paths()) and is_own(r.prepared_by)))
  with check (exists (select 1 from dpr_records r where r.id = dpr_record_id
                      and r.site in (select user_site_paths()) and is_own(r.prepared_by)));

-- ── material_logs ───────────────────────────────────────────────
drop policy if exists material_logs_admin_all on material_logs;
create policy material_logs_admin_all on material_logs for all to authenticated
  using ((select is_admin())) with check ((select is_admin()));
drop policy if exists material_logs_select on material_logs;
create policy material_logs_select on material_logs for select to authenticated
  using (site in (select user_site_paths()));
drop policy if exists material_logs_insert on material_logs;
create policy material_logs_insert on material_logs for insert to authenticated
  with check (site in (select user_site_paths()) and is_own(logged_by));
drop policy if exists material_logs_update_own on material_logs;
create policy material_logs_update_own on material_logs for update to authenticated
  using (site in (select user_site_paths()) and is_own(logged_by))
  with check (site in (select user_site_paths()) and is_own(logged_by));
drop policy if exists material_logs_delete_own on material_logs;
create policy material_logs_delete_own on material_logs for delete to authenticated
  using (site in (select user_site_paths()) and is_own(logged_by));

commit;

-- ── Check ───────────────────────────────────────────────────────
-- Every table should show rls_enabled = true.
select c.relname as table_name, c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;
