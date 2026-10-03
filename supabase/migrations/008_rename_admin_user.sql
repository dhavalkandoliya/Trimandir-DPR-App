-- ════════════════════════════════════════════════════════════════
-- 008 — Rename the built-in admin account: TPD-admin → admin
--
-- Safe to re-run (only touches a row still named TPD-admin, and only if no
-- "admin" account exists). The password is unchanged. The updated_at
-- trigger bumps the row, which signs out any open TPD-admin session — sign
-- in again as "admin".
--
-- The protected-account checks (lib/authSupabaseApi.js PROTECTED_USERNAME,
-- components/admin/UsersAdmin.jsx PROTECTED) name "admin" from the same
-- release. No dpr_records / material_logs rows were filed under TPD-admin
-- when this was written, so nothing else refers to the old name.
-- ════════════════════════════════════════════════════════════════

update users
set username = 'admin'
where lower(username) = 'tpd-admin'
  and not exists (select 1 from users where lower(username) = 'admin');
