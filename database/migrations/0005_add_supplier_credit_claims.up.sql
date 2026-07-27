-- Supplier credit-claim recovery.
-- Products gain a nullable supplier_id (self-building supplier map); five new
-- tables model the claim lifecycle. Mirrors Prisma models + SQLite migration 015.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS supplier_id integer;

CREATE TABLE IF NOT EXISTS suppliers (
  id                   serial PRIMARY KEY,
  organization_id      text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name                 text NOT NULL,
  contact_email        text,
  credit_policy_note   text NOT NULL DEFAULT '',
  policy_write_off_qty integer,
  policy_credit_qty    integer,
  follow_up_days       integer NOT NULL DEFAULT 7,
  created_at           timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT suppliers_organization_id_name_key UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_suppliers_organization_id
  ON suppliers (organization_id);

-- FK from products to suppliers, added after suppliers exists.
ALTER TABLE products
  ADD CONSTRAINT products_supplier_id_fkey
  FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_supplier_id
  ON products (supplier_id);

CREATE TABLE IF NOT EXISTS credit_claims (
  id                     serial PRIMARY KEY,
  organization_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  supplier_id            integer NOT NULL REFERENCES suppliers (id),
  created_by_user_id     integer REFERENCES users (id) ON DELETE SET NULL,
  status                 text NOT NULL DEFAULT 'DRAFT',
  contact_email_snapshot text,
  expected_credit_units  integer,
  expected_credit_value  double precision,
  credited_value         double precision,
  sent_at                timestamp(3),
  next_follow_up_at      timestamp(3),
  follow_up_count        integer NOT NULL DEFAULT 0,
  settled_at             timestamp(3),
  created_at             timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_claims_organization_id
  ON credit_claims (organization_id);
CREATE INDEX IF NOT EXISTS idx_credit_claims_supplier_id
  ON credit_claims (supplier_id);
CREATE INDEX IF NOT EXISTS idx_credit_claims_status
  ON credit_claims (status);
CREATE INDEX IF NOT EXISTS idx_credit_claims_next_follow_up_at
  ON credit_claims (next_follow_up_at);

CREATE TABLE IF NOT EXISTS credit_claim_lines (
  id                          serial PRIMARY KEY,
  organization_id             text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  claim_id                    integer NOT NULL REFERENCES credit_claims (id) ON DELETE CASCADE,
  expired_item_transaction_id integer NOT NULL UNIQUE REFERENCES expired_item_transactions (id),
  batch_number                text,
  units_claimed               integer NOT NULL,
  expected_credit_units       integer,
  expected_credit_value       double precision,
  created_at                  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_claim_lines_organization_id
  ON credit_claim_lines (organization_id);
CREATE INDEX IF NOT EXISTS idx_credit_claim_lines_claim_id
  ON credit_claim_lines (claim_id);

CREATE TABLE IF NOT EXISTS credit_claim_photos (
  id              serial PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  claim_line_id   integer NOT NULL REFERENCES credit_claim_lines (id) ON DELETE CASCADE,
  storage_key     text NOT NULL,
  file_name       text NOT NULL,
  size_bytes      integer NOT NULL,
  delete_after    timestamp(3),
  created_at      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_claim_photos_organization_id
  ON credit_claim_photos (organization_id);
CREATE INDEX IF NOT EXISTS idx_credit_claim_photos_claim_line_id
  ON credit_claim_photos (claim_line_id);
CREATE INDEX IF NOT EXISTS idx_credit_claim_photos_delete_after
  ON credit_claim_photos (delete_after);

CREATE TABLE IF NOT EXISTS credit_claim_events (
  id              serial PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  claim_id        integer NOT NULL REFERENCES credit_claims (id) ON DELETE CASCADE,
  user_id         integer REFERENCES users (id) ON DELETE SET NULL,
  type            text NOT NULL,
  note            text,
  created_at      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_credit_claim_events_organization_id
  ON credit_claim_events (organization_id);
CREATE INDEX IF NOT EXISTS idx_credit_claim_events_claim_id
  ON credit_claim_events (claim_id);
