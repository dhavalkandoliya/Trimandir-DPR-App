-- ════════════════════════════════════════════════════════════════
-- 003 — Remove material budgets
--
-- RUN THIS ONLY AFTER the app version without budgets is deployed.
-- Earlier app versions read and write materials.budget_qty; dropping the
-- column while one of them is still live would break adding/editing
-- materials in Admin.
--
-- At the time of writing every materials.budget_qty was 0, so no data is lost.
-- ════════════════════════════════════════════════════════════════

alter table materials drop column if exists budget_qty;
