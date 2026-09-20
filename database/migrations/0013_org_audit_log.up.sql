-- Migration 0013: give the organization RBAC audit trail a Postgres home.
--
-- Express records authorization events through `OrgAuditService.emit`
-- (`backend/src/services/org-audit.service.ts:20`) into the Prisma model
-- `OrgAuditLog`, which maps to `org_audit_log`. That table only ever existed in
-- the Express/SQLite lineage (`backend/prisma/migrations/20260416132951_add_org_audit_log`);
-- it has never existed in this Postgres series, so the Worker had nowhere to
-- write and recorded no authorization events at all. Phase 4 deletes Express,
-- so without this table the trail disappears with it (task 3.1.g, Finding 8).
--
-- Scope of the trail, decided explicitly rather than ported wholesale:
--
--   * `role_assigned` is the only event either backend can emit today, and in
--     Express its single emitter (`org-bootstrap.service.ts:154`) records the
--     *automatic self-assignment* at first bootstrap — actor and target are the
--     same user. That entry is derivable from `users.role` + `users.created_at`.
--   * The event with the actual compliance value — one human promoting another
--     to admin via `PUT /api/users/:id` — was audited by *neither* backend. The
--     Worker now writes it (`index-minimal.ts`, `handleUpdateUser`), which is
--     why `old_role` is meaningful here and was always NULL under Express.
--   * The four invite events (`invite_created`/`accepted`/`revoked`/`resent`)
--     are gated behind `ENABLE_CUSTOM_ORG_INVITES`, which is off, so no writer
--     ships for them. Their columns (`invite_id`, `target_*`) are included
--     anyway: adding a nullable column later costs another six-artifact
--     migration, while adding a writer later costs one file.
--
-- Expand-only: a new table with no backfill and no change to existing objects.
-- Column order, types and index names mirror the Prisma model so that layer 3
-- of `baseline.fingerprint.test.ts` (migration series vs. Prisma-generated SQL)
-- diffs clean.
--
-- Every object is created `IF NOT EXISTS` because this series carries an
-- unstated idempotency contract: the documented forward-fix recovery path
-- (exercised by `src/database/migrations/e2e.test.ts`) unstamps every migration
-- above the one being fixed and replays them *over the existing schema*, since
-- the runner requires applied migrations to be a contiguous prefix. A migration
-- that is not replayable over its own result breaks that recovery path. The
-- foreign key is declared inline rather than via `ALTER TABLE ... ADD
-- CONSTRAINT` for the same reason: Postgres has no `ADD CONSTRAINT IF NOT
-- EXISTS`, but the table-level `IF NOT EXISTS` covers a constraint declared
-- inside `CREATE TABLE`.
CREATE TABLE IF NOT EXISTS "org_audit_log" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_user_id" INTEGER,
    "actor_organization_id" TEXT,
    "target_user_id" INTEGER,
    "target_organization_id" TEXT,
    "old_role" TEXT,
    "new_role" TEXT,
    "invite_id" TEXT,
    "ip_address" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_audit_log_pkey" PRIMARY KEY ("id"),
    -- Cascade matches the Prisma relation (`onDelete: Cascade`): an
    -- organization's audit rows are meaningless once the organization row is
    -- gone, and nothing outside the organization may read them.
    CONSTRAINT "org_audit_log_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "org_audit_log_organization_id_idx" ON "org_audit_log"("organization_id");
CREATE INDEX IF NOT EXISTS "org_audit_log_event_type_idx" ON "org_audit_log"("event_type");
CREATE INDEX IF NOT EXISTS "org_audit_log_actor_user_id_idx" ON "org_audit_log"("actor_user_id");
CREATE INDEX IF NOT EXISTS "org_audit_log_target_user_id_idx" ON "org_audit_log"("target_user_id");
CREATE INDEX IF NOT EXISTS "org_audit_log_invite_id_idx" ON "org_audit_log"("invite_id");
CREATE INDEX IF NOT EXISTS "org_audit_log_created_at_idx" ON "org_audit_log"("created_at");
