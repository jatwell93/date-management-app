/*
  Warnings:

  - The primary key for the `trial_events` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `pin` on the `users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "subscription_tiers" ADD COLUMN "stripe_customer_id" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_trial_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organization_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "occurred_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,
    "sent_reminders_at" TEXT,
    CONSTRAINT "trial_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_trial_events" ("event_type", "id", "metadata", "occurred_at", "organization_id", "sent_reminders_at") SELECT "event_type", "id", "metadata", "occurred_at", "organization_id", "sent_reminders_at" FROM "trial_events";
DROP TABLE "trial_events";
ALTER TABLE "new_trial_events" RENAME TO "trial_events";
CREATE INDEX "trial_events_organization_id_idx" ON "trial_events"("organization_id");
CREATE INDEX "trial_events_event_type_idx" ON "trial_events"("event_type");
CREATE INDEX "trial_events_occurred_at_idx" ON "trial_events"("occurred_at");
CREATE TABLE "new_users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_id" TEXT,
    "clerk_user_id" TEXT,
    "email" TEXT,
    "username" TEXT,
    "role" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_users" ("clerk_user_id", "created_at", "email", "id", "organization_id", "role", "updated_at", "username") SELECT "clerk_user_id", "created_at", "email", "id", "organization_id", "role", "updated_at", "username" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_clerk_user_id_key" ON "users"("clerk_user_id");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");
CREATE INDEX "users_clerk_user_id_idx" ON "users"("clerk_user_id");
CREATE INDEX "users_email_idx" ON "users"("email");
CREATE INDEX "users_username_idx" ON "users"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "subscription_tiers_trial_end_date_idx" ON "subscription_tiers"("trial_end_date");
