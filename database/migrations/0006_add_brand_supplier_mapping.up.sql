-- Brand-mediated supplier mapping, catalogue corrections, and persisted disposal.

CREATE TABLE IF NOT EXISTS brands (
  id                      serial PRIMARY KEY,
  organization_id         text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name                    text NOT NULL,
  manufacturer_name       text,
  suggested_supplier_name text,
  supplier_id             integer REFERENCES suppliers (id) ON DELETE SET NULL,
  source                  text NOT NULL DEFAULT 'REFERENCE'
                          CHECK (source IN ('REFERENCE', 'USER_ADDED', 'CONFIRMED')),
  created_at              timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT brands_organization_id_name_key UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_brands_organization_id ON brands (organization_id);
CREATE INDEX IF NOT EXISTS idx_brands_supplier_id ON brands (supplier_id);

ALTER TABLE products ADD COLUMN IF NOT EXISTS brand_id integer;
DO $$ BEGIN
  ALTER TABLE products ADD CONSTRAINT products_brand_id_fkey
    FOREIGN KEY (brand_id) REFERENCES brands (id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_products_brand_id ON products (brand_id);

CREATE TABLE IF NOT EXISTS master_catalogue_entries (
  id                serial PRIMARY KEY,
  barcode           text NOT NULL UNIQUE,
  description       text NOT NULL,
  api_sku           text,
  sigma_sku         text,
  ch2_sku           text,
  brand_name        text NOT NULL,
  manufacturer_name text,
  category          text,
  sub_category      text,
  rrp               double precision,
  metro_price       double precision,
  created_at        timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_master_catalogue_entries_api_sku
  ON master_catalogue_entries (api_sku);
CREATE INDEX IF NOT EXISTS idx_master_catalogue_entries_sigma_sku
  ON master_catalogue_entries (sigma_sku);
CREATE INDEX IF NOT EXISTS idx_master_catalogue_entries_ch2_sku
  ON master_catalogue_entries (ch2_sku);

CREATE TABLE IF NOT EXISTS catalogue_corrections (
  id                 serial PRIMARY KEY,
  organization_id    text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  product_id         integer REFERENCES products (id) ON DELETE SET NULL,
  brand_id           integer REFERENCES brands (id) ON DELETE SET NULL,
  barcode            text,
  entered_brand_name text,
  chosen_supplier_id integer REFERENCES suppliers (id) ON DELETE SET NULL,
  kind                text NOT NULL CHECK (kind IN ('UNMATCHED', 'BRAND_ADDED', 'SUPPLIER_OVERRIDE')),
  status              text NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  created_by_user_id  integer REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_catalogue_corrections_organization_id
  ON catalogue_corrections (organization_id);
CREATE INDEX IF NOT EXISTS idx_catalogue_corrections_status
  ON catalogue_corrections (status);
CREATE INDEX IF NOT EXISTS idx_catalogue_corrections_product_id
  ON catalogue_corrections (product_id);
CREATE INDEX IF NOT EXISTS idx_catalogue_corrections_brand_id
  ON catalogue_corrections (brand_id);

ALTER TABLE expired_item_transactions
  ADD COLUMN IF NOT EXISTS credit_disposition text NOT NULL DEFAULT 'PENDING';
DO $$ BEGIN
  ALTER TABLE expired_item_transactions ADD CONSTRAINT expired_transactions_credit_disposition_check
    CHECK (credit_disposition IN ('PENDING', 'DISPOSED'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_expired_transactions_credit_disposition
  ON expired_item_transactions (credit_disposition);
