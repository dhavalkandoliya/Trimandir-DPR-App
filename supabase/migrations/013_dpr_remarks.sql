-- ════════════════════════════════════════════════════════════════
-- 013 — Reason / remarks on a DPR (Site Closed / Holiday days)
--
-- A DPR whose site condition is "Site Closed" or "Holiday" has no
-- manpower lines; dpr_records.remarks holds why the site was closed or
-- which holiday it is. Other days leave it empty. Shown on the report,
-- the PDF / image, the DPR log exports and the edit history.
--
-- Additive and safe to re-run. Until it is applied, working-day reports
-- save as before; a closed / holiday report is refused with a hint to
-- apply this file (the app never drops a reason silently).
-- ════════════════════════════════════════════════════════════════

alter table dpr_records
  add column if not exists remarks text not null default '';

-- Make the Data API pick up the new column now.
notify pgrst, 'reload schema';
