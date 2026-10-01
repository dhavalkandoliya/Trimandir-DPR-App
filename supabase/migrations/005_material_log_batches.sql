-- ════════════════════════════════════════════════════════════════
-- 005 — Submission batches for consumption entries (material_logs)
--
-- Additive and safe to re-run. The app works before it is applied: the
-- server retries the insert without these columns, and the client groups
-- un-batched rows by the fallback key below (lib/materials/consumption.js
-- batchKey()).
--
-- Every row saved by one "Save consumption" (or one DPR submission's
-- materials) shares a batch_id; batch_line is its position in the form.
-- The Material Consumption Report covers a whole batch: the eye button on
-- any of its log rows opens the report for all of them.
--
-- Backfill: rows inserted together by one statement share an identical
-- created_at (Postgres now() is per transaction), so date + site + logger +
-- created_at identifies a past submission. Their original line order isn't
-- recorded; batch_line is left null for them.
-- ════════════════════════════════════════════════════════════════

alter table material_logs
  add column if not exists batch_id   uuid,
  add column if not exists batch_line smallint;

create index if not exists idx_material_logs_batch on material_logs (batch_id);

with batches as (
  select log_date, site, logged_by, created_at, gen_random_uuid() as batch_id
  from material_logs
  where batch_id is null
  group by log_date, site, logged_by, created_at
)
update material_logs m
set batch_id = b.batch_id
from batches b
where m.batch_id is null
  and m.log_date = b.log_date
  and m.site = b.site
  and m.logged_by = b.logged_by
  and m.created_at = b.created_at;
