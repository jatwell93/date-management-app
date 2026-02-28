/*
  Warnings:

  - Made the column `organization_id` on table `audit_log` required. This step will fail if there are existing NULL values in that column.
  - Made the column `organization_id` on table `expired_item_transactions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `organization_id` on table `inventory_items` required. This step will fail if there are existing NULL values in that column.
  - Made the column `organization_id` on table `item_transactions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `organization_id` on table `products` required. This step will fail if there are existing NULL values in that column.
  - Made the column `organization_id` on table `store_areas` required. This step will fail if there are existing NULL values in that column.
  - Made the column `organization_id` on table `uploads` required. This step will fail if there are existing NULL values in that column.
  - Made the column `organization_id` on table `users` required. This step will fail if there are existing NULL values in that column.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
INSERT INTO "new_audit_log" ("action", "change_description", "created_at", "id", "inventory_item_id", "organization_id", "user_id") SELECT "action", "change_description", "created_at", "id", "inventory_item_id", "organization_id", "user_id" FROM "audit_log";
DROP TABLE "audit_log";
ALTER TABLE "new_audit_log" RENAME TO "audit_log";
CREATE INDEX "audit_log_organization_id_idx" ON "audit_log"("organization_id");
CREATE INDEX "audit_log_user_id_idx" ON "audit_log"("user_id");
CREATE INDEX "audit_log_inventory_item_id_idx" ON "audit_log"("inventory_item_id");
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");
CREATE TABLE "new_expired_item_transactions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_id" TEXT NOT NULL,
    "inventory_item_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "units_discarded" INTEGER,
    "financial_loss" REAL,
    "transaction_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "expired_item_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "expired_item_transactions_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "expired_item_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_expired_item_transactions" ("action", "created_at", "financial_loss", "id", "inventory_item_id", "organization_id", "transaction_date", "units_discarded", "updated_at", "user_id") SELECT "action", "created_at", "financial_loss", "id", "inventory_item_id", "organization_id", "transaction_date", "units_discarded", "updated_at", "user_id" FROM "expired_item_transactions";
DROP TABLE "expired_item_transactions";
ALTER TABLE "new_expired_item_transactions" RENAME TO "expired_item_transactions";
CREATE INDEX "expired_item_transactions_organization_id_idx" ON "expired_item_transactions"("organization_id");
CREATE INDEX "expired_item_transactions_inventory_item_id_idx" ON "expired_item_transactions"("inventory_item_id");
CREATE INDEX "expired_item_transactions_user_id_idx" ON "expired_item_transactions"("user_id");
CREATE INDEX "expired_item_transactions_action_idx" ON "expired_item_transactions"("action");
CREATE INDEX "expired_item_transactions_transaction_date_idx" ON "expired_item_transactions"("transaction_date");
CREATE TABLE "new_inventory_items" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_id" TEXT NOT NULL,
    "product_id" INTEGER NOT NULL,
    "expiry_date" DATETIME NOT NULL,
    "location_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Normal',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "inventory_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "inventory_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "inventory_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "store_areas" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_inventory_items" ("created_at", "expiry_date", "id", "location_id", "organization_id", "product_id", "status", "updated_at") SELECT "created_at", "expiry_date", "id", "location_id", "organization_id", "product_id", "status", "updated_at" FROM "inventory_items";
DROP TABLE "inventory_items";
ALTER TABLE "new_inventory_items" RENAME TO "inventory_items";
CREATE INDEX "inventory_items_organization_id_idx" ON "inventory_items"("organization_id");
CREATE INDEX "inventory_items_product_id_idx" ON "inventory_items"("product_id");
CREATE INDEX "inventory_items_location_id_idx" ON "inventory_items"("location_id");
CREATE INDEX "inventory_items_expiry_date_idx" ON "inventory_items"("expiry_date");
CREATE INDEX "inventory_items_status_idx" ON "inventory_items"("status");
CREATE TABLE "new_item_transactions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_id" TEXT NOT NULL,
    "inventory_item_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "quantity_change" REAL NOT NULL,
    "notes" TEXT,
    "transaction_date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "item_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "item_transactions_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "item_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_item_transactions" ("id", "inventory_item_id", "notes", "organization_id", "quantity_change", "transaction_date", "type", "user_id") SELECT "id", "inventory_item_id", "notes", "organization_id", "quantity_change", "transaction_date", "type", "user_id" FROM "item_transactions";
DROP TABLE "item_transactions";
ALTER TABLE "new_item_transactions" RENAME TO "item_transactions";
CREATE INDEX "item_transactions_organization_id_idx" ON "item_transactions"("organization_id");
CREATE INDEX "item_transactions_inventory_item_id_idx" ON "item_transactions"("inventory_item_id");
CREATE INDEX "item_transactions_user_id_idx" ON "item_transactions"("user_id");
CREATE INDEX "item_transactions_type_idx" ON "item_transactions"("type");
CREATE INDEX "item_transactions_transaction_date_idx" ON "item_transactions"("transaction_date");
CREATE TABLE "new_products" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_id" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cost_price" REAL NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_products" ("barcode", "cost_price", "created_at", "id", "name", "notes", "organization_id", "sku", "updated_at") SELECT "barcode", "cost_price", "created_at", "id", "name", "notes", "organization_id", "sku", "updated_at" FROM "products";
DROP TABLE "products";
ALTER TABLE "new_products" RENAME TO "products";
CREATE INDEX "products_organization_id_sku_idx" ON "products"("organization_id", "sku");
CREATE INDEX "products_organization_id_barcode_idx" ON "products"("organization_id", "barcode");
CREATE INDEX "products_sku_idx" ON "products"("sku");
CREATE INDEX "products_barcode_idx" ON "products"("barcode");
CREATE UNIQUE INDEX "products_organization_id_sku_key" ON "products"("organization_id", "sku");
CREATE UNIQUE INDEX "products_organization_id_barcode_key" ON "products"("organization_id", "barcode");
CREATE TABLE "new_store_areas" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sub_department" TEXT,
    "last_checked" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "store_areas_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_store_areas" ("created_at", "id", "last_checked", "name", "organization_id", "sub_department", "updated_at") SELECT "created_at", "id", "last_checked", "name", "organization_id", "sub_department", "updated_at" FROM "store_areas";
DROP TABLE "store_areas";
ALTER TABLE "new_store_areas" RENAME TO "store_areas";
CREATE INDEX "store_areas_organization_id_idx" ON "store_areas"("organization_id");
CREATE INDEX "store_areas_name_idx" ON "store_areas"("name");
CREATE UNIQUE INDEX "store_areas_organization_id_name_sub_department_key" ON "store_areas"("organization_id", "name", "sub_department");
CREATE TABLE "new_uploads" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "content_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "uploads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_uploads" ("content_type", "created_at", "file_key", "file_name", "file_size_bytes", "id", "organization_id", "status", "updated_at", "user_id") SELECT "content_type", "created_at", "file_key", "file_name", "file_size_bytes", "id", "organization_id", "status", "updated_at", "user_id" FROM "uploads";
DROP TABLE "uploads";
ALTER TABLE "new_uploads" RENAME TO "uploads";
CREATE UNIQUE INDEX "uploads_file_key_key" ON "uploads"("file_key");
CREATE INDEX "uploads_organization_id_created_at_idx" ON "uploads"("organization_id", "created_at");
CREATE INDEX "uploads_user_id_created_at_idx" ON "uploads"("user_id", "created_at");
CREATE INDEX "uploads_status_idx" ON "uploads"("status");
CREATE INDEX "uploads_created_at_idx" ON "uploads"("created_at");
CREATE TABLE "new_users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_id" TEXT NOT NULL,
    "clerk_user_id" TEXT,
    "email" TEXT,
    "username" TEXT,
    "role" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
