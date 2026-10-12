-- ════════════════════════════════════════════════════════════════
-- 012 — Change history (audit log) for DPRs and consumption entries
--
-- dpr_audit_logs keeps one row per change: who, when, the full snapshot
-- before (old_data) and after (new_data, null for a delete), and a
-- readable Old → New summary (diff_summary, one change per line).
--
-- Two writers, never both for the same change:
--
--   1. The app (lib/dprSupabaseApi.js + lib/audit.js). Each edit/delete
--      done in the app is logged as ONE row for the whole report:
--        record_type 'dpr'                 record_id = dpr_records.id
--        record_type 'material_submission' record_id = batch id (or the
--                                          submission's lowest entry id)
--      Snapshots hold the report as the user sees it (a DPR with all its
--      manpower lines; a submission with all its materials), and
--      changed_by is the signed-in app user.
--
--   2. A trigger on dpr_records, dpr_manpower_entries and material_logs
--      that logs every UPDATE / DELETE NOT made by the app — e.g. in the
--      SQL editor or with a key outside the app — per row (record_type =
--      table name). The app's server marks its requests with the header
--      `x-dpr-app: 1` on the service-role key (lib/supabaseClient.js); the
--      trigger skips exactly those, so app changes aren't logged twice.
--
-- The log is append-only: a trigger rejects UPDATE / DELETE / TRUNCATE on
-- it for everyone, and under RLS only admins can read it (the app's server
-- reads it with the service-role key for Admin › View edit history).
--
-- Safe to re-run. Needs migration 011 (is_admin(), app_username()).
-- ════════════════════════════════════════════════════════════════

begin;

create table if not exists dpr_audit_logs (
  id            bigint generated always as identity primary key,
  record_type   text        not null check (record_type in ('dpr', 'material_submission', 'dpr_records', 'dpr_manpower_entries', 'material_logs')),
  record_id     text        not null,
  site_path     text,
  action        text        not null check (action in ('UPDATE', 'DELETE')),
  changed_by    text        not null,
  changed_at    timestamptz not null default now(),
  old_data      jsonb,
  new_data      jsonb,
  diff_summary  text        not null default ''
);
create index if not exists idx_dpr_audit_logs_record on dpr_audit_logs (record_type, record_id, changed_at desc);
create index if not exists idx_dpr_audit_logs_changed_at on dpr_audit_logs (changed_at desc);
-- Out-of-band manpower-line changes are found by their DPR.
create index if not exists idx_dpr_audit_logs_parent on dpr_audit_logs ((old_data ->> 'dpr_record_id')) where record_type = 'dpr_manpower_entries';

-- ── Append-only ─────────────────────────────────────────────────
create or replace function dpr_audit_logs_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'dpr_audit_logs is append-only';
end;
$$;
drop trigger if exists trg_dpr_audit_logs_append_only on dpr_audit_logs;
create trigger trg_dpr_audit_logs_append_only
  before update or delete on dpr_audit_logs
  for each row execute function dpr_audit_logs_append_only();
drop trigger if exists trg_dpr_audit_logs_no_truncate on dpr_audit_logs;
create trigger trg_dpr_audit_logs_no_truncate
  before truncate on dpr_audit_logs
  for each statement execute function dpr_audit_logs_append_only();

alter table dpr_audit_logs enable row level security;
drop policy if exists dpr_audit_logs_admin_select on dpr_audit_logs;
create policy dpr_audit_logs_admin_select on dpr_audit_logs for select to authenticated
  using ((select is_admin()));
revoke insert, update, delete, truncate on dpr_audit_logs from anon, authenticated;
-- Explicit grants: a new table isn't always granted to the API roles by
-- default, and the Data API (PostgREST) won't expose it without them. The
-- app's server writes and reads with service_role; admins read under RLS.
grant select, insert on dpr_audit_logs to service_role;
grant select on dpr_audit_logs to authenticated;

-- ── Safety-net trigger for changes made outside the app ─────────
create or replace function audit_out_of_band_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  headers  json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  old_j    jsonb := to_jsonb(old);
  new_j    jsonb := case when tg_op = 'UPDATE' then to_jsonb(new) else null end;
  summary  text;
  site     text;
begin
  -- The app's own server logs its changes itself (one row per report).
  if headers ->> 'x-dpr-app' = '1' and coalesce(auth.role(), '') = 'service_role' then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    select string_agg(format('%s: %s → %s', n.key, coalesce(o.value #>> '{}', '∅'), coalesce(n.value #>> '{}', '∅')), E'\n' order by n.key)
      into summary
    from jsonb_each(new_j) n join jsonb_each(old_j) o using (key)
    where n.value is distinct from o.value and n.key <> 'updated_at';
    if summary is null then return null; end if; -- nothing but updated_at changed
  else
    summary := 'Deleted';
  end if;

  if tg_table_name = 'dpr_manpower_entries' then
    select r.site into site from dpr_records r where r.id = old.dpr_record_id;
  else
    site := old_j ->> 'site';
  end if;

  insert into dpr_audit_logs (record_type, record_id, site_path, action, changed_by, old_data, new_data, diff_summary)
  values (tg_table_name, old.id::text, site, tg_op,
          coalesce(app_username(), 'database:' || session_user), old_j, new_j, summary);
  return null;
end;
$$;

drop trigger if exists trg_audit_dpr_records on dpr_records;
create trigger trg_audit_dpr_records
  after update or delete on dpr_records
  for each row execute function audit_out_of_band_change();

drop trigger if exists trg_audit_dpr_manpower_entries on dpr_manpower_entries;
create trigger trg_audit_dpr_manpower_entries
  after update or delete on dpr_manpower_entries
  for each row execute function audit_out_of_band_change();

drop trigger if exists trg_audit_material_logs on material_logs;
create trigger trg_audit_material_logs
  after update or delete on material_logs
  for each row execute function audit_out_of_band_change();

commit;

-- Make the Data API pick up the new table now.
notify pgrst, 'reload schema';
