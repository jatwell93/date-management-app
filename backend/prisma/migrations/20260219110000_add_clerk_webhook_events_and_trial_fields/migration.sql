-- CreateTable
CREATE TABLE "clerk_webhook_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event_type" TEXT NOT NULL,
    "processed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "clerk_webhook_events_event_type_processed_at_idx" ON "clerk_webhook_events"("event_type", "processed_at");

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_organizations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clerk_organization_id" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contact_email" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "new_organizations_clerk_organization_id_key" UNIQUE ("clerk_organization_id"),
    CONSTRAINT "new_organizations_slug_key" UNIQUE ("slug")
);
INSERT INTO "new_organizations" ("created_at", "id", "name", "slug", "contact_email", "updated_at") SELECT "created_at", "id", "name", "slug", "contact_email", "updated_at" FROM "organizations";
DROP TABLE "organizations";
ALTER TABLE "new_organizations" RENAME TO "organizations";
CREATE UNIQUE INDEX "organizations_clerk_organization_id_key" ON "organizations"("clerk_organization_id");
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_subscription_tiers" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_id" TEXT NOT NULL,
    "tier_level" TEXT NOT NULL,
    "stripe_subscription_id" TEXT,
    "trial_end_date" DATETIME,
    "trial_started_at" DATETIME,
    "trial_converted_at" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "billing_cycle" TEXT NOT NULL DEFAULT 'monthly',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "subscription_tiers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_subscription_tiers" ("id", "organization_id", "tier_level", "stripe_subscription_id", "trial_end_date", "status", "billing_cycle", "created_at", "updated_at") SELECT "id", "organization_id", "tier_level", "stripe_subscription_id", "trial_end_date", "status", "billing_cycle", "created_at", "updated_at" FROM "subscription_tiers";
DROP TABLE "subscription_tiers";
ALTER TABLE "new_subscription_tiers" RENAME TO "subscription_tiers";
CREATE INDEX "subscription_tiers_organization_id_idx" ON "subscription_tiers"("organization_id");
CREATE INDEX "subscription_tiers_tier_level_idx" ON "subscription_tiers"("tier_level");
CREATE INDEX "subscription_tiers_status_idx" ON "subscription_tiers"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateTable
CREATE TABLE "trial_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "occurred_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,
    "sent_reminders_at" TEXT,
    CONSTRAINT "trial_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "trial_events_organization_id_idx" ON "trial_events"("organization_id");

-- CreateIndex
CREATE INDEX "trial_events_event_type_idx" ON "trial_events"("event_type");

-- CreateIndex
CREATE INDEX "trial_events_occurred_at_idx" ON "trial_events"("occurred_at");
