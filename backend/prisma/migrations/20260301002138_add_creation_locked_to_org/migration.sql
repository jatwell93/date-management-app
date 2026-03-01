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
    "is_creation_locked" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_organizations" ("clerk_organization_id", "contact_email", "created_at", "id", "name", "slug", "updated_at") SELECT "clerk_organization_id", "contact_email", "created_at", "id", "name", "slug", "updated_at" FROM "organizations";
DROP TABLE "organizations";
ALTER TABLE "new_organizations" RENAME TO "organizations";
CREATE UNIQUE INDEX "organizations_clerk_organization_id_key" ON "organizations"("clerk_organization_id");
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
