-- Rollback for 0005_add_supplier_credit_claims.sql. Drop in FK-dependency order.

DROP TABLE IF EXISTS credit_claim_events;
DROP TABLE IF EXISTS credit_claim_photos;
DROP TABLE IF EXISTS credit_claim_lines;
DROP TABLE IF EXISTS credit_claims;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_supplier_id_fkey;

DROP INDEX IF EXISTS idx_products_supplier_id;

ALTER TABLE products
  DROP COLUMN IF EXISTS supplier_id;

DROP TABLE IF EXISTS suppliers;
