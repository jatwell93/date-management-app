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
    "past_due_since" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "billing_cycle" TEXT NOT NULL DEFAULT 'monthly',
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "stripe_customer_id" TEXT,
    CONSTRAINT "subscription_tiers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_subscription_tiers" ("billing_cycle", "created_at", "id", "organization_id", "past_due_since", "status", "stripe_customer_id", "stripe_subscription_id", "tier_level", "trial_converted_at", "trial_end_date", "trial_started_at", "updated_at") SELECT "billing_cycle", "created_at", "id", "organization_id", "past_due_since", "status", "stripe_customer_id", "stripe_subscription_id", "tier_level", "trial_converted_at", "trial_end_date", "trial_started_at", "updated_at" FROM "subscription_tiers";
DROP TABLE "subscription_tiers";
ALTER TABLE "new_subscription_tiers" RENAME TO "subscription_tiers";
CREATE INDEX "subscription_tiers_organization_id_idx" ON "subscription_tiers"("organization_id");
CREATE INDEX "subscription_tiers_tier_level_idx" ON "subscription_tiers"("tier_level");
CREATE INDEX "subscription_tiers_status_idx" ON "subscription_tiers"("status");
CREATE INDEX "subscription_tiers_trial_end_date_idx" ON "subscription_tiers"("trial_end_date");
CREATE INDEX "subscription_tiers_past_due_since_idx" ON "subscription_tiers"("past_due_since");
CREATE TABLE "new_uploads" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "content_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "import_type" TEXT NOT NULL DEFAULT 'product-catalog',
    "tier_snapshot" TEXT,
    "max_skus_snapshot" INTEGER,
    "max_active_expiries_snapshot" INTEGER,
    "upload_progress" INTEGER NOT NULL DEFAULT 0,
    "processing_message" TEXT,
    "error_message" TEXT,
    "rows_processed" INTEGER NOT NULL DEFAULT 0,
    "rows_total" INTEGER,
    "rows_imported" INTEGER NOT NULL DEFAULT 0,
    "rows_updated" INTEGER NOT NULL DEFAULT 0,
    "rows_unchanged" INTEGER NOT NULL DEFAULT 0,
    "rows_skipped" INTEGER NOT NULL DEFAULT 0,
    "row_error_count" INTEGER NOT NULL DEFAULT 0,
    "row_errors" TEXT,
    "processing_offset" INTEGER NOT NULL DEFAULT 0,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "failure_category" TEXT,
    "error_report_key" TEXT,
    "queued_at" DATETIME,
    "validation_started_at" DATETIME,
    "processing_started_at" DATETIME,
    "completed_at" DATETIME,
    "failed_at" DATETIME,
    "columns_used" TEXT,
    "columns_ignored" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "uploads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_uploads" ("columns_ignored", "columns_used", "content_type", "created_at", "error_message", "file_key", "file_name", "file_size_bytes", "id", "organization_id", "processing_message", "row_error_count", "rows_imported", "rows_processed", "rows_skipped", "rows_total", "rows_updated", "status", "updated_at", "upload_progress", "user_id") SELECT "columns_ignored", "columns_used", "content_type", "created_at", "error_message", "file_key", "file_name", "file_size_bytes", "id", "organization_id", "processing_message", "row_error_count", "rows_imported", "rows_processed", "rows_skipped", "rows_total", "rows_updated", "status", "updated_at", "upload_progress", "user_id" FROM "uploads";
DROP TABLE "uploads";
ALTER TABLE "new_uploads" RENAME TO "uploads";
CREATE UNIQUE INDEX "uploads_file_key_key" ON "uploads"("file_key");
CREATE INDEX "uploads_organization_id_created_at_idx" ON "uploads"("organization_id", "created_at");
CREATE INDEX "uploads_user_id_created_at_idx" ON "uploads"("user_id", "created_at");
CREATE INDEX "uploads_status_idx" ON "uploads"("status");
CREATE INDEX "uploads_created_at_idx" ON "uploads"("created_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
