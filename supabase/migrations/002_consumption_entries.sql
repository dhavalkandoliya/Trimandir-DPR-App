-- ════════════════════════════════════════════════════════════════
-- 002 — Consumption Entries fields on material_logs
--
-- RUN THIS BEFORE deploying the app version that writes these columns.
-- It is additive only (new nullable/defaulted columns), so the currently
-- deployed app keeps working unchanged while it's applied.
--
-- Each material log row becomes a "consumption entry":
--   material_name, quantity, unit          (existing)
--   ownership    — who supplied it: Trust | Contractor | Other
--   contractor   — contractor name (required by the app when ownership = Contractor)
--   output_qty / output_unit — work executed with it, e.g. 62 Rft, 5.5 Cu.m
--   remarks      — e.g. "Door frame - granite work"
--
-- Only ownership = 'Trust' counts toward the Trust's material totals;
-- Contractor/Other rows are kept for reference.
--
-- Existing rows are backfilled as 'Trust' by the column default: they were
-- all logged for the Trust's own material tracking before ownership
-- existed. Adjust the UPDATE at the bottom if some should be reclassified.
-- ════════════════════════════════════════════════════════════════

alter table material_logs
  add column if not exists ownership   text not null default 'Trust',
  add column if not exists contractor  text,
  add column if not exists output_qty  numeric(14, 2),
  add column if not exists output_unit text,
  add column if not exists remarks     text;

alter table material_logs drop constraint if exists material_logs_ownership_check;
alter table material_logs
  add constraint material_logs_ownership_check check (ownership in ('Trust', 'Contractor', 'Other'));

create index if not exists idx_material_logs_ownership on material_logs (ownership);

-- Example reclassification (not run by default):
-- update material_logs set ownership = 'Contractor', contractor = '...' where id in (...);
