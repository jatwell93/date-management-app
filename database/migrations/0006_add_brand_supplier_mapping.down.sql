DROP TABLE IF EXISTS catalogue_corrections;
DROP TABLE IF EXISTS master_catalogue_entries;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_brand_id_fkey;
DROP INDEX IF EXISTS idx_products_brand_id;
ALTER TABLE products DROP COLUMN IF EXISTS brand_id;

DROP TABLE IF EXISTS brands;

DROP INDEX IF EXISTS idx_expired_transactions_credit_disposition;
ALTER TABLE expired_item_transactions
  DROP CONSTRAINT IF EXISTS expired_transactions_credit_disposition_check;
ALTER TABLE expired_item_transactions DROP COLUMN IF EXISTS credit_disposition;
