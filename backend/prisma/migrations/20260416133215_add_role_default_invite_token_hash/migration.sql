-- AlterTable
ALTER TABLE "organization_invites" ADD COLUMN "invite_token_expires_at" DATETIME;
ALTER TABLE "organization_invites" ADD COLUMN "invite_token_hash" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organization_id" TEXT NOT NULL,
    "clerk_user_id" TEXT,
    "email" TEXT,
    "username" TEXT,
    "role" TEXT NOT NULL DEFAULT 'team_member',
    "deleted_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_users" ("clerk_user_id", "created_at", "deleted_at", "email", "id", "organization_id", "role", "updated_at", "username") SELECT "clerk_user_id", "created_at", "deleted_at", "email", "id", "organization_id", "role", "updated_at", "username" FROM "users";
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
