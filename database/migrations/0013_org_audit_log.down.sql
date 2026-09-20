-- Recovery (manual-only, destructive, complete) for migration 0013.
--
-- Drops the organization RBAC audit trail. Destructive in the strongest sense
-- of any down migration in this series: an audit trail cannot be reconstructed
-- after the fact, so every recorded role assignment and admin promotion is lost
-- permanently, not merely made unreachable. Nothing else in the schema
-- references `org_audit_log`, so the drop is otherwise self-contained.
DROP TABLE IF EXISTS "org_audit_log";
