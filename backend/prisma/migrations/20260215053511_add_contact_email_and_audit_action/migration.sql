/*
  Warnings:

  - Added the required column `action` to the `audit_log` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "contact_email" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_audit_log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_id" TEXT,
    "user_id" INTEGER NOT NULL,
    "inventory_item_id" INTEGER,
    "action" TEXT NOT NULL,
    "change_description" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "audit_log_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_audit_log" ("change_description", "created_at", "id", "inventory_item_id", "organization_id", "user_id") SELECT "change_description", "created_at", "id", "inventory_item_id", "organization_id", "user_id" FROM "audit_log";
DROP TABLE "audit_log";
ALTER TABLE "new_audit_log" RENAME TO "audit_log";
CREATE INDEX "audit_log_organization_id_idx" ON "audit_log"("organization_id");
CREATE INDEX "audit_log_user_id_idx" ON "audit_log"("user_id");
CREATE INDEX "audit_log_inventory_item_id_idx" ON "audit_log"("inventory_item_id");
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
