-- ════════════════════════════════════════════════════════════════
-- 004 — Edit / delete lifecycle for consumption entries (material_logs)
--
-- Applied to production on 2026-09-25. This file records the columns as
-- they exist there (all additive and nullable, so it is safe to re-run).
--
-- Rules (enforced server-side in lib/dprSupabaseApi.js, shared with the
-- UI via lib/materials/consumption.js consumptionAccess()):
--   • Admins can edit or delete any entry at any time.
--   • The user who logged an entry can edit or delete it directly for
--     24 hours after created_at.
--   • After that they send a request: edit_request_type = 'edit' |
--     'delete', edit_requested_by/at set → pending. An admin approves
--     (edit → edit_granted_to/at set, letting them edit once; delete → the
--     entry is deleted) or declines (all request columns cleared).
--   • edited_by / edited_at record the last edit.
-- ════════════════════════════════════════════════════════════════

alter table material_logs
  add column if not exists edit_requested_by text,
  add column if not exists edit_requested_at timestamptz,
  add column if not exists edit_request_type text,
  add column if not exists edit_granted_to   text,
  add column if not exists edit_granted_at   timestamptz,
  add column if not exists edited_by         text,
  add column if not exists edited_at         timestamptz;
