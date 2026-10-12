-- ════════════════════════════════════════════════════════════════
-- 010 — Remove the edit-request workflow
--
-- The app no longer has edit requests. A supervisor edits their own DPR
-- for 15 minutes and their own consumption entry for 24 hours; after that
-- it is locked and only an admin can change it. There was never an
-- edit_requests table — requests lived in these columns, dropped here:
--
--   dpr_records    edit_permission ('' | 'pending' | 'granted'), requested_by
--   material_logs  edit_requested_by, edit_requested_at, edit_request_type,
--                  edit_granted_to, edit_granted_at          (migration 004)
--
-- Kept: dpr_records.edited_by and material_logs.edited_by / edited_at,
-- which record who last changed a row.
--
-- Apply AFTER deploying the release that stops using these columns: the
-- previous release writes edit_permission on every DPR save, so dropping
-- them first would break saving. Safe to re-run. Any request still
-- pending, and any edit already granted, is discarded.
-- ════════════════════════════════════════════════════════════════

begin;

alter table dpr_records
  drop column if exists edit_permission,   -- its check constraint goes with it
  drop column if exists requested_by;

alter table material_logs
  drop column if exists edit_requested_by,
  drop column if exists edit_requested_at,
  drop column if exists edit_request_type,
  drop column if exists edit_granted_to,
  drop column if exists edit_granted_at;

commit;
