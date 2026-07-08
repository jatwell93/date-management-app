DROP TABLE IF EXISTS organization_markdown_config;

ALTER TABLE products
  DROP COLUMN IF EXISTS retail_price;
