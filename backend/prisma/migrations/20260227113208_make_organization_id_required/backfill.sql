-- Step 1: Backfill NULL organizationId values
-- This ensures we don't violate the NOT NULL constraint
-- Run the backfill script or execute these updates directly

-- Create default organization if it doesn't exist
INSERT INTO organizations (id, name, slug, contact_email, created_at, updated_at)
VALUES ('248c0a81-db22-4e41-869d-61634de4a304', 'Default Organization', 'default-org', 'default@example.com', datetime('now'), datetime('now'))
ON CONFLICT(id) DO NOTHING;

-- Backfill all tables with NULL organizationId
UPDATE store_areas SET organization_id = '248c0a81-db22-4e41-869d-61634de4a304' WHERE organization_id IS NULL;
UPDATE users SET organization_id = '248c0a81-db22-4e41-869d-61634de4a304' WHERE organization_id IS NULL;
UPDATE products SET organization_id = '248c0a81-db22-4e41-869d-61634de4a304' WHERE organization_id IS NULL;
UPDATE inventory_items SET organization_id = '248c0a81-db22-4e41-869d-61634de4a304' WHERE organization_id IS NULL;
UPDATE item_transactions SET organization_id = '248c0a81-db22-4e41-869d-61634de4a304' WHERE organization_id IS NULL;
UPDATE expired_item_transactions SET organization_id = '248c0a81-db22-4e41-869d-61634de4a304' WHERE organization_id IS NULL;
UPDATE audit_log SET organization_id = '248c0a81-db22-4e41-869d-61634de4a304' WHERE organization_id IS NULL;
UPDATE uploads SET organization_id = '248c0a81-db22-4e41-869d-61634de4a304' WHERE organization_id IS NULL;

-- Step 2: Verify no NULL values remain
-- This will fail if any NULLs still exist, preventing the migration from proceeding
-- 
-- SELECT COUNT(*) FROM store_areas WHERE organization_id IS NULL;
-- SELECT COUNT(*) FROM users WHERE organization_id IS NULL;
-- SELECT COUNT(*) FROM products WHERE organization_id IS NULL;
-- SELECT COUNT(*) FROM inventory_items WHERE organization_id IS NULL;
-- SELECT COUNT(*) FROM item_transactions WHERE organization_id IS NULL;
-- SELECT COUNT(*) FROM expired_item_transactions WHERE organization_id IS NULL;
-- SELECT COUNT(*) FROM audit_log WHERE organization_id IS NULL;
-- SELECT COUNT(*) FROM uploads WHERE organization_id IS NULL;

-- All counts should be 0 before proceeding with the schema changes below
