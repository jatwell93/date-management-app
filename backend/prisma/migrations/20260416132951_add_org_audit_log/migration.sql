-- CreateTable
CREATE TABLE "org_audit_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
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
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "org_audit_log_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "org_audit_log_organization_id_idx" ON "org_audit_log"("organization_id");

-- CreateIndex
CREATE INDEX "org_audit_log_event_type_idx" ON "org_audit_log"("event_type");

-- CreateIndex
CREATE INDEX "org_audit_log_actor_user_id_idx" ON "org_audit_log"("actor_user_id");

-- CreateIndex
CREATE INDEX "org_audit_log_target_user_id_idx" ON "org_audit_log"("target_user_id");

-- CreateIndex
CREATE INDEX "org_audit_log_invite_id_idx" ON "org_audit_log"("invite_id");

-- CreateIndex
CREATE INDEX "org_audit_log_created_at_idx" ON "org_audit_log"("created_at");
