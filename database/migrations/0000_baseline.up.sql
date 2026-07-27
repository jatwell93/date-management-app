-- Canonical PostgreSQL baseline (Phase 1 task 1.3).
--
-- Establishes the schema that existed in production immediately before the
-- Neon SQL delta series (0001-0009) began. The 0001-0009 migrations assume
-- this schema already exists; without this baseline they cannot be applied to
-- a fresh database.
--
-- Generation (reproducible from git history):
--   git show ae26d623~1:backend/prisma/production/schema.prisma > baseline.prisma
--   DATABASE_URL=postgresql://placeholder npx prisma@5.22.0 migrate diff \
--     --from-empty --to-schema-datamodel baseline.prisma --script
--
-- The source commit ae26d623~1 is the parent of "feat(uploads): queued catalogue
-- imports and launch pricing", which introduced the first neon-sql delta (0001).
-- Production was shaped by `prisma db push` against this Prisma schema, so the
-- `migrate diff` output is the authoritative DDL for the pre-delta state.
--
-- Prisma version: pinned to 5.22.0 (the version in the historical lockfile at
-- commit ae26d623~1). Prisma 6+ additionally emits `CREATE SCHEMA IF NOT EXISTS
-- "public";` as its first statement; that line is added manually below for
-- fresh-database safety since Prisma 5.22.0 does not emit it. The table DDL
-- is byte-identical between the two versions.

-- Ensure the public schema exists on fresh databases (Prisma 5 does not emit
-- this; Prisma 6 does. Added manually for fresh-database safety.)
CREATE SCHEMA IF NOT EXISTS "public";
-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "clerk_organization_id" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contact_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_creation_locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_tiers" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "tier_level" TEXT NOT NULL,
    "stripe_subscription_id" TEXT,
    "trial_end_date" TIMESTAMP(3),
    "trial_started_at" TIMESTAMP(3),
    "trial_converted_at" TIMESTAMP(3),
    "past_due_since" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "billing_cycle" TEXT NOT NULL DEFAULT 'monthly',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "stripe_customer_id" TEXT,

    CONSTRAINT "subscription_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,
    "sent_reminders_at" TEXT,

    CONSTRAINT "trial_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tier_feature_flags" (
    "id" SERIAL NOT NULL,
    "tier_level" TEXT NOT NULL,
    "feature_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limit_value" INTEGER,

    CONSTRAINT "tier_feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_usage" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "active_users" INTEGER NOT NULL DEFAULT 0,
    "max_users" INTEGER NOT NULL,
    "total_skus" INTEGER NOT NULL DEFAULT 0,
    "max_skus" INTEGER NOT NULL,
    "total_inventory_items" INTEGER NOT NULL DEFAULT 0,
    "max_inventory_items" INTEGER,
    "storage_used_bytes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_webhook_events" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clerk_webhook_events" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clerk_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cost_price" DOUBLE PRECISION NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "product_id" INTEGER NOT NULL,
    "expiry_date" TIMESTAMP(3) NOT NULL,
    "location_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Normal',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_areas" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sub_department" TEXT,
    "last_checked" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "clerk_user_id" TEXT,
    "email" TEXT,
    "username" TEXT,
    "role" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_invites" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "invited_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" INTEGER,
    "inventory_item_id" INTEGER,
    "action" TEXT NOT NULL,
    "change_description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_transactions" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "inventory_item_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "type" TEXT NOT NULL,
    "quantity_change" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "transaction_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expired_item_transactions" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "inventory_item_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "action" TEXT NOT NULL,
    "units_discarded" INTEGER,
    "financial_loss" DOUBLE PRECISION,
    "transaction_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expired_item_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "content_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "upload_progress" INTEGER NOT NULL DEFAULT 0,
    "processing_message" TEXT,
    "error_message" TEXT,
    "rows_processed" INTEGER NOT NULL DEFAULT 0,
    "rows_total" INTEGER,
    "rows_imported" INTEGER NOT NULL DEFAULT 0,
    "rows_updated" INTEGER NOT NULL DEFAULT 0,
    "rows_skipped" INTEGER NOT NULL DEFAULT 0,
    "row_error_count" INTEGER NOT NULL DEFAULT 0,
    "columns_used" TEXT,
    "columns_ignored" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migrations" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics_snapshots" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "trial_conversion_rate" DOUBLE PRECISION,
    "avg_revenue_per_user" DOUBLE PRECISION,
    "churn_rate" DOUBLE PRECISION,
    "total_trials" INTEGER NOT NULL DEFAULT 0,
    "total_conversions" INTEGER NOT NULL DEFAULT 0,
    "total_churn" INTEGER NOT NULL DEFAULT 0,
    "total_revenue_cents" INTEGER NOT NULL DEFAULT 0,
    "tier_distribution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metrics_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_metrics" (
    "id" SERIAL NOT NULL,
    "event_type" TEXT NOT NULL,
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_clerk_organization_id_key" ON "organizations"("clerk_organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "subscription_tiers_organization_id_idx" ON "subscription_tiers"("organization_id");

-- CreateIndex
CREATE INDEX "subscription_tiers_tier_level_idx" ON "subscription_tiers"("tier_level");

-- CreateIndex
CREATE INDEX "subscription_tiers_status_idx" ON "subscription_tiers"("status");

-- CreateIndex
CREATE INDEX "subscription_tiers_trial_end_date_idx" ON "subscription_tiers"("trial_end_date");

-- CreateIndex
CREATE INDEX "subscription_tiers_past_due_since_idx" ON "subscription_tiers"("past_due_since");

-- CreateIndex
CREATE INDEX "trial_events_organization_id_idx" ON "trial_events"("organization_id");

-- CreateIndex
CREATE INDEX "trial_events_event_type_idx" ON "trial_events"("event_type");

-- CreateIndex
CREATE INDEX "trial_events_occurred_at_idx" ON "trial_events"("occurred_at");

-- CreateIndex
CREATE INDEX "tier_feature_flags_tier_level_idx" ON "tier_feature_flags"("tier_level");

-- CreateIndex
CREATE UNIQUE INDEX "tier_feature_flags_tier_level_feature_key_key" ON "tier_feature_flags"("tier_level", "feature_key");

-- CreateIndex
CREATE UNIQUE INDEX "organization_usage_organization_id_key" ON "organization_usage"("organization_id");

-- CreateIndex
CREATE INDEX "processed_webhook_events_event_type_processed_at_idx" ON "processed_webhook_events"("event_type", "processed_at");

-- CreateIndex
CREATE INDEX "clerk_webhook_events_event_type_processed_at_idx" ON "clerk_webhook_events"("event_type", "processed_at");

-- CreateIndex
CREATE INDEX "products_organization_id_sku_idx" ON "products"("organization_id", "sku");

-- CreateIndex
CREATE INDEX "products_organization_id_barcode_idx" ON "products"("organization_id", "barcode");

-- CreateIndex
CREATE INDEX "products_sku_idx" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_barcode_idx" ON "products"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_sku_key" ON "products"("organization_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "products_organization_id_barcode_key" ON "products"("organization_id", "barcode");

-- CreateIndex
CREATE INDEX "inventory_items_organization_id_idx" ON "inventory_items"("organization_id");

-- CreateIndex
CREATE INDEX "inventory_items_product_id_idx" ON "inventory_items"("product_id");

-- CreateIndex
CREATE INDEX "inventory_items_location_id_idx" ON "inventory_items"("location_id");

-- CreateIndex
CREATE INDEX "inventory_items_expiry_date_idx" ON "inventory_items"("expiry_date");

-- CreateIndex
CREATE INDEX "inventory_items_status_idx" ON "inventory_items"("status");

-- CreateIndex
CREATE INDEX "store_areas_organization_id_idx" ON "store_areas"("organization_id");

-- CreateIndex
CREATE INDEX "store_areas_name_idx" ON "store_areas"("name");

-- CreateIndex
CREATE UNIQUE INDEX "store_areas_organization_id_name_sub_department_key" ON "store_areas"("organization_id", "name", "sub_department");

-- CreateIndex
CREATE UNIQUE INDEX "users_clerk_user_id_key" ON "users"("clerk_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

-- CreateIndex
CREATE INDEX "users_clerk_user_id_idx" ON "users"("clerk_user_id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_username_idx" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "organization_invites_token_key" ON "organization_invites"("token");

-- CreateIndex
CREATE INDEX "organization_invites_organization_id_idx" ON "organization_invites"("organization_id");

-- CreateIndex
CREATE INDEX "organization_invites_email_idx" ON "organization_invites"("email");

-- CreateIndex
CREATE INDEX "organization_invites_status_idx" ON "organization_invites"("status");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_key" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_idx" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "audit_log_organization_id_idx" ON "audit_log"("organization_id");

-- CreateIndex
CREATE INDEX "audit_log_user_id_idx" ON "audit_log"("user_id");

-- CreateIndex
CREATE INDEX "audit_log_inventory_item_id_idx" ON "audit_log"("inventory_item_id");

-- CreateIndex
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");

-- CreateIndex
CREATE INDEX "item_transactions_organization_id_idx" ON "item_transactions"("organization_id");

-- CreateIndex
CREATE INDEX "item_transactions_inventory_item_id_idx" ON "item_transactions"("inventory_item_id");

-- CreateIndex
CREATE INDEX "item_transactions_user_id_idx" ON "item_transactions"("user_id");

-- CreateIndex
CREATE INDEX "item_transactions_type_idx" ON "item_transactions"("type");

-- CreateIndex
CREATE INDEX "item_transactions_transaction_date_idx" ON "item_transactions"("transaction_date");

-- CreateIndex
CREATE INDEX "expired_item_transactions_organization_id_idx" ON "expired_item_transactions"("organization_id");

-- CreateIndex
CREATE INDEX "expired_item_transactions_inventory_item_id_idx" ON "expired_item_transactions"("inventory_item_id");

-- CreateIndex
CREATE INDEX "expired_item_transactions_user_id_idx" ON "expired_item_transactions"("user_id");

-- CreateIndex
CREATE INDEX "expired_item_transactions_action_idx" ON "expired_item_transactions"("action");

-- CreateIndex
CREATE INDEX "expired_item_transactions_transaction_date_idx" ON "expired_item_transactions"("transaction_date");

-- CreateIndex
CREATE UNIQUE INDEX "uploads_file_key_key" ON "uploads"("file_key");

-- CreateIndex
CREATE INDEX "uploads_organization_id_created_at_idx" ON "uploads"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "uploads_user_id_created_at_idx" ON "uploads"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "uploads_status_idx" ON "uploads"("status");

-- CreateIndex
CREATE INDEX "uploads_created_at_idx" ON "uploads"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "migrations_name_key" ON "migrations"("name");

-- CreateIndex
CREATE UNIQUE INDEX "metrics_snapshots_date_key" ON "metrics_snapshots"("date");

-- CreateIndex
CREATE INDEX "metrics_snapshots_date_idx" ON "metrics_snapshots"("date");

-- CreateIndex
CREATE INDEX "webhook_metrics_event_type_idx" ON "webhook_metrics"("event_type");

-- CreateIndex
CREATE INDEX "webhook_metrics_date_idx" ON "webhook_metrics"("date");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_metrics_event_type_date_key" ON "webhook_metrics"("event_type", "date");

-- AddForeignKey
ALTER TABLE "subscription_tiers" ADD CONSTRAINT "subscription_tiers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_events" ADD CONSTRAINT "trial_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_usage" ADD CONSTRAINT "organization_usage_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "store_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_areas" ADD CONSTRAINT "store_areas_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_transactions" ADD CONSTRAINT "item_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_transactions" ADD CONSTRAINT "item_transactions_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_transactions" ADD CONSTRAINT "item_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expired_item_transactions" ADD CONSTRAINT "expired_item_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expired_item_transactions" ADD CONSTRAINT "expired_item_transactions_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expired_item_transactions" ADD CONSTRAINT "expired_item_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

