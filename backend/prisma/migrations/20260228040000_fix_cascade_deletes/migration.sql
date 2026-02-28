-- Migration: Fix cascade delete rules to prevent data loss

-- Step 1: Add deletedAt column to users table for soft delete
ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL;

-- Step 2: Recreate tables with safer foreign key constraints
-- Note: SQLite doesn't support ALTER TABLE for foreign keys, so we need to recreate tables

-- Recreate audit_log with SET NULL for user_id
CREATE TABLE "new_audit_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_id" TEXT NOT NULL,
    "user_id" INTEGER,
    "inventory_item_id" INTEGER,
    "action" TEXT NOT NULL,
    "change_description" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "audit_log_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_audit_log" SELECT * FROM "audit_log";
DROP TABLE "audit_log";
ALTER TABLE "new_audit_log" RENAME TO "audit_log";
CREATE INDEX "audit_log_organization_id_idx" ON "audit_log"("organization_id");
CREATE INDEX "audit_log_user_id_idx" ON "audit_log"("user_id");
CREATE INDEX "audit_log_inventory_item_id_idx" ON "audit_log"("inventory_item_id");
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");

-- Recreate item_transactions with SET NULL for user_id
CREATE TABLE "new_item_transactions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_id" TEXT NOT NULL,
    "inventory_item_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "type" TEXT NOT NULL,
    "quantity_change" REAL NOT NULL,
    "notes" TEXT,
    "transaction_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "item_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "item_transactions_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "item_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_item_transactions" SELECT * FROM "item_transactions";
DROP TABLE "item_transactions";
ALTER TABLE "new_item_transactions" RENAME TO "item_transactions";
CREATE INDEX "item_transactions_organization_id_idx" ON "item_transactions"("organization_id");
CREATE INDEX "item_transactions_inventory_item_id_idx" ON "item_transactions"("inventory_item_id");
CREATE INDEX "item_transactions_user_id_idx" ON "item_transactions"("user_id");
CREATE INDEX "item_transactions_type_idx" ON "item_transactions"("type");
CREATE INDEX "item_transactions_transaction_date_idx" ON "item_transactions"("transaction_date");

-- Recreate expired_item_transactions with SET NULL for user_id
CREATE TABLE "new_expired_item_transactions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_id" TEXT NOT NULL,
    "inventory_item_id" INTEGER NOT NULL,
    "user_id" INTEGER,
    "action" TEXT NOT NULL,
    "units_discarded" INTEGER,
    "financial_loss" REAL,
    "transaction_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "expired_item_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "expired_item_transactions_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "expired_item_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_expired_item_transactions" SELECT * FROM "expired_item_transactions";
DROP TABLE "expired_item_transactions";
ALTER TABLE "new_expired_item_transactions" RENAME TO "expired_item_transactions";
CREATE INDEX "expired_item_transactions_organization_id_idx" ON "expired_item_transactions"("organization_id");
CREATE INDEX "expired_item_transactions_inventory_item_id_idx" ON "expired_item_transactions"("inventory_item_id");
CREATE INDEX "expired_item_transactions_user_id_idx" ON "expired_item_transactions"("user_id");
CREATE INDEX "expired_item_transactions_action_idx" ON "expired_item_transactions"("action");
CREATE INDEX "expired_item_transactions_transaction_date_idx" ON "expired_item_transactions"("transaction_date");

-- Update users table to include deleted_at in the model
UPDATE users SET deleted_at = NULL WHERE deleted_at IS NULL;
