-- ════════════════════════════════════════════════════════════════
-- 009 — Sites are identified by their full path, not a bare name
--
-- Surat_Trimandir was added with sub-sites named exactly like
-- Vasad_Trimandir's (Temple, Infra Work, Ancillary Building). Reports
-- stored only the bare sub-site name, so "Infra Work" could mean either
-- project: filters, the dashboard and supervisor site scoping all mixed
-- the two up.
--
-- From this release dpr_records.site and material_logs.site store the
-- site's full PATH — every ancestor's name and its own joined by " › "
-- ("Vasad_Trimandir › Infra Work"); a top-level site's path is its name,
-- so those rows don't change. dpr_records.project_id is filled in too.
-- See lib/sites.js.
--
-- This migration:
--   1. rewrites every bare-name row to its path. A name several projects
--      share is attributed, in order, to the one project that
--        a) the name matches uniquely, else
--        b) the row's author (prepared_by / logged_by) is assigned to
--           (user_sites, an assigned parent covering its sub-sites), else
--        c) b) narrowed to projects that existed when the row was created,
--        d) projects that existed when the row was created.
--      Rows still ambiguous are left as they are and listed by the final
--      query for manual fixing.
--   2. adds a unique index so two siblings can never share a name (and so
--      two sites can never share a path).
--
-- Safe to re-run. Apply it together with the app release that writes
-- paths; re-running it after the deploy also picks up any bare-name row
-- an old client saved in between.
-- ════════════════════════════════════════════════════════════════

begin;

-- ── 1a. DPRs ────────────────────────────────────────────────────
with recursive tree as (
  select id, parent_id, trim(coalesce(sub_project_name, main_project_name)) as name,
         trim(coalesce(sub_project_name, main_project_name)) as path, created_at
  from projects where parent_id is null
  union all
  select p.id, p.parent_id, trim(coalesce(p.sub_project_name, p.main_project_name)),
         t.path || ' › ' || trim(coalesce(p.sub_project_name, p.main_project_name)), p.created_at
  from projects p join tree t on p.parent_id = t.id
),
covered (user_id, project_id) as (
  select user_id, project_id from user_sites
  union
  select c.user_id, p.id from projects p join covered c on p.parent_id = c.project_id
),
cand as (
  select r.id as row_id, t.id as project_id,
         exists (select 1 from users u join covered c on c.user_id = u.id
                 where lower(u.username) = lower(trim(r.prepared_by)) and c.project_id = t.id) as by_user,
         t.created_at <= r.created_at as existed
  from dpr_records r
  join tree t on lower(trim(r.site)) in (lower(t.name), lower(t.path))
  where r.project_id is null or r.site not in (select path from tree)
),
pick as (
  select row_id,
    case
      when count(*) = 1 then min(project_id)
      when count(*) filter (where by_user) = 1 then min(project_id) filter (where by_user)
      when count(*) filter (where by_user and existed) = 1 then min(project_id) filter (where by_user and existed)
      when count(*) filter (where existed) = 1 then min(project_id) filter (where existed)
    end as project_id
  from cand group by row_id
)
update dpr_records r
set site = t.path, project_id = t.id
from pick p join tree t on t.id = p.project_id
where r.id = p.row_id;

-- ── 1b. Consumption entries ─────────────────────────────────────
with recursive tree as (
  select id, parent_id, trim(coalesce(sub_project_name, main_project_name)) as name,
         trim(coalesce(sub_project_name, main_project_name)) as path, created_at
  from projects where parent_id is null
  union all
  select p.id, p.parent_id, trim(coalesce(p.sub_project_name, p.main_project_name)),
         t.path || ' › ' || trim(coalesce(p.sub_project_name, p.main_project_name)), p.created_at
  from projects p join tree t on p.parent_id = t.id
),
covered (user_id, project_id) as (
  select user_id, project_id from user_sites
  union
  select c.user_id, p.id from projects p join covered c on p.parent_id = c.project_id
),
cand as (
  select l.id as row_id, t.id as project_id,
         exists (select 1 from users u join covered c on c.user_id = u.id
                 where lower(u.username) = lower(trim(l.logged_by)) and c.project_id = t.id) as by_user,
         t.created_at <= l.created_at as existed
  from material_logs l
  join tree t on lower(trim(l.site)) in (lower(t.name), lower(t.path))
  where l.site not in (select path from tree)
),
pick as (
  select row_id,
    case
      when count(*) = 1 then min(project_id)
      when count(*) filter (where by_user) = 1 then min(project_id) filter (where by_user)
      when count(*) filter (where by_user and existed) = 1 then min(project_id) filter (where by_user and existed)
      when count(*) filter (where existed) = 1 then min(project_id) filter (where existed)
    end as project_id
  from cand group by row_id
)
update material_logs l
set site = t.path
from pick p join tree t on t.id = p.project_id
where l.id = p.row_id;

-- ── 2. Sibling names are unique (so paths are) ──────────────────
-- Fails if two siblings already share a name: rename one in Admin › Sites
-- and run this file again.
create unique index if not exists uq_projects_sibling_name
  on projects (coalesce(parent_id, 0), lower(trim(coalesce(sub_project_name, main_project_name))));

commit;

-- ── Check: rows that still don't name a site path ────────────────
-- Expect no rows. Any listed here were ambiguous (or name a deleted
-- project) — set their site to the right path by hand.
with recursive tree as (
  select id, trim(coalesce(sub_project_name, main_project_name)) as path
  from projects where parent_id is null
  union all
  select p.id, t.path || ' › ' || trim(coalesce(p.sub_project_name, p.main_project_name))
  from projects p join tree t on p.parent_id = t.id
)
select 'dpr_records' as tbl, id::text, report_date as day, site, prepared_by as author
from dpr_records where site not in (select path from tree)
union all
select 'material_logs', id::text, log_date, site, logged_by
from material_logs where site not in (select path from tree)
order by 1, 3;
