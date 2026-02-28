-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_organization_usage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_id" TEXT NOT NULL,
    "active_users" INTEGER NOT NULL DEFAULT 0,
    "max_users" INTEGER NOT NULL,
    "total_skus" INTEGER NOT NULL DEFAULT 0,
    "max_skus" INTEGER NOT NULL,
    "total_inventory_items" INTEGER NOT NULL DEFAULT 0,
    "storage_used_bytes" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "organization_usage_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_organization_usage" ("active_users", "created_at", "id", "max_skus", "max_users", "organization_id", "storage_used_bytes", "total_skus", "updated_at") SELECT "active_users", "created_at", "id", "max_skus", "max_users", "organization_id", "storage_used_bytes", "total_skus", "updated_at" FROM "organization_usage";
DROP TABLE "organization_usage";
ALTER TABLE "new_organization_usage" RENAME TO "organization_usage";
CREATE UNIQUE INDEX "organization_usage_organization_id_key" ON "organization_usage"("organization_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
