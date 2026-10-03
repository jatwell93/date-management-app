-- Recovery (manual-only, destructive, partial) for migration 0018.
--
-- Drops `users_role_canonical`, which is all that can be reversed in SQL. The
-- 18 deleted accounts are not recreated: they could not sign in, nothing
-- referenced them, and re-inserting them would re-create the defect #560
-- removed. If they are ever genuinely needed, recover them from the
-- `database-backup.yml` dump taken before this migration ran
-- (docs/database-backup-runbook.md) or from Neon PITR.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_canonical;
