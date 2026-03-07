-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_uploads" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
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
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "uploads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_uploads" ("columns_ignored", "columns_used", "content_type", "created_at", "error_message", "file_key", "file_name", "file_size_bytes", "id", "organization_id", "processing_message", "rows_processed", "rows_total", "status", "updated_at", "upload_progress", "user_id") SELECT "columns_ignored", "columns_used", "content_type", "created_at", "error_message", "file_key", "file_name", "file_size_bytes", "id", "organization_id", "processing_message", "rows_processed", "rows_total", "status", "updated_at", "upload_progress", "user_id" FROM "uploads";
DROP TABLE "uploads";
ALTER TABLE "new_uploads" RENAME TO "uploads";
CREATE UNIQUE INDEX "uploads_file_key_key" ON "uploads"("file_key");
CREATE INDEX "uploads_organization_id_created_at_idx" ON "uploads"("organization_id", "created_at");
CREATE INDEX "uploads_user_id_created_at_idx" ON "uploads"("user_id", "created_at");
CREATE INDEX "uploads_status_idx" ON "uploads"("status");
CREATE INDEX "uploads_created_at_idx" ON "uploads"("created_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
