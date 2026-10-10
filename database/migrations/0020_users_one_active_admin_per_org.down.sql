-- Recovery (manual-only, destructive, complete) for migration 0020.
--
-- Drops the one-active-admin index. "Destructive" only in the sense every down
-- migration here is: the database stops refusing a second active admin, so the
-- application's own admin-slot check is the only guard left. No data is affected.
DROP INDEX IF EXISTS users_one_active_admin_per_org;
