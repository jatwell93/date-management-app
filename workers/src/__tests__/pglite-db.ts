/**
 * In-process Postgres (pglite) test harness for the catalogue import SQL.
 *
 * The worker's catalogue import path (`processCatalogueImportJob`, `upsertProductBatch`,
 * the projected-SKU quota CTE, and the conflict query) is the most complex, highest-risk
 * code in the feature and was previously only covered by tests that mocked `db.sql`. This
 * harness runs the *real* SQL against an in-memory Postgres so classification, counters,
 * quota, conflicts, and resume behaviour are verified end-to-end.
 *
 * pglite is WASM and needs a Node runtime, so the tests using this harness run under the
 * dedicated `vitest.node.config.mts` project (matcher `*.node.test.ts`), not the workerd pool.
 */
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '../database';

export interface PgliteHarness {
  db: Database;
  pg: PGlite;
  close: () => Promise<void>;
}

const SCHEMA_SQL = `
  CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    barcode TEXT NOT NULL,
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    -- Nullable to mirror production, where legacy rows can have a NULL cost_price
    -- (all cost queries COALESCE it to 0). A NOT NULL harness previously hid a
    -- write-off matcher bug that only manifested against real NULL data. #268
    cost_price DOUBLE PRECISION DEFAULT 0,
    -- Retail price distinct from cost, so a markdown band can discount off retail
    -- (issue #338). Nullable: cost-only catalogues leave it NULL and fall back to cost.
    retail_price DOUBLE PRECISION,
    notes TEXT NOT NULL DEFAULT '',
    -- Self-building supplier map (issue: supplier credit claims). Nullable = the
    -- "needs supplier" triage bucket.
    supplier_id INTEGER,
    brand_id INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, sku),
    UNIQUE (organization_id, barcode)
  );

  CREATE TABLE organization_markdown_config (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    credit_scope TEXT NOT NULL DEFAULT 'NO_CREDIT'
      CHECK (credit_scope IN ('NO_CREDIT', 'FULL_CREDIT')),
    band1_percentage DOUBLE PRECISION NOT NULL DEFAULT 50,
    band2_percentage DOUBLE PRECISION NOT NULL DEFAULT 60,
    band3_percentage DOUBLE PRECISION NOT NULL DEFAULT 75,
    band1_basis TEXT NOT NULL DEFAULT 'cost',
    band2_basis TEXT NOT NULL DEFAULT 'cost',
    band3_basis TEXT NOT NULL DEFAULT 'cost',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, credit_scope)
  );

  CREATE TABLE uploads (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    user_id INTEGER,
    file_key TEXT,
    file_name TEXT,
    file_size_bytes INTEGER,
    content_type TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    import_type TEXT NOT NULL DEFAULT 'product-catalog',
    tier_snapshot TEXT,
    max_skus_snapshot INTEGER,
    max_active_expiries_snapshot INTEGER,
    upload_progress INTEGER NOT NULL DEFAULT 0,
    processing_message TEXT,
    error_message TEXT,
    rows_processed INTEGER NOT NULL DEFAULT 0,
    rows_total INTEGER,
    rows_imported INTEGER NOT NULL DEFAULT 0,
    rows_updated INTEGER NOT NULL DEFAULT 0,
    rows_unchanged INTEGER NOT NULL DEFAULT 0,
    rows_skipped INTEGER NOT NULL DEFAULT 0,
    row_error_count INTEGER NOT NULL DEFAULT 0,
    row_errors TEXT,
    processing_offset INTEGER NOT NULL DEFAULT 0,
    retry_count INTEGER NOT NULL DEFAULT 0,
    failure_category TEXT,
    error_report_key TEXT,
    queued_at TIMESTAMPTZ,
    validation_started_at TIMESTAMPTZ,
    processing_started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX uploads_one_active_catalogue_per_org
    ON uploads (organization_id)
    WHERE import_type = 'product-catalog'
      AND status IN ('pending', 'queued', 'validating', 'processing');

  CREATE TABLE organizations (
    id TEXT PRIMARY KEY,
    clerk_organization_id TEXT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    contact_email TEXT,
    is_creation_locked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (clerk_organization_id),
    UNIQUE (slug)
  );

  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    clerk_user_id TEXT,
    email TEXT,
    username TEXT,
    role TEXT NOT NULL,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX users_clerk_user_id_key ON users (clerk_user_id);

  CREATE TABLE store_areas (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    parent_id INTEGER REFERENCES store_areas (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sub_department TEXT NOT NULL DEFAULT '',
    last_checked TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (parent_id IS NULL OR parent_id <> id)
  );

  CREATE INDEX idx_store_areas_parent_id ON store_areas (parent_id);

  CREATE TABLE check_cycles (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status IN ('active', 'completed')),
    CHECK (
      (status = 'completed' AND completed_at IS NOT NULL)
      OR (status = 'active' AND completed_at IS NULL)
    )
  );

  CREATE UNIQUE INDEX one_active_cycle_per_org
    ON check_cycles (organization_id)
    WHERE status = 'active';

  CREATE TABLE bay_checks (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    cycle_id INTEGER NOT NULL REFERENCES check_cycles (id) ON DELETE CASCADE,
    store_area_id INTEGER NOT NULL REFERENCES store_areas (id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    items_added_count INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (items_added_count >= 0)
  );

  CREATE INDEX idx_bay_checks_organization_id ON bay_checks (organization_id);
  CREATE INDEX idx_bay_checks_cycle_id ON bay_checks (cycle_id);
  CREATE INDEX idx_bay_checks_store_area_id ON bay_checks (store_area_id);
  CREATE INDEX idx_bay_checks_checked_at ON bay_checks (checked_at);

  CREATE TABLE inventory_items (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    product_id INTEGER,
    location_id INTEGER,
    expiry_date DATE,
    status TEXT NOT NULL DEFAULT 'Active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- Mirrors the production table (see the Neon export: nullable user_id and
  -- inventory_item_id, NOT NULL organization_id/action/change_description, and
  -- deliberately NO foreign key on inventory_item_id). The absent FK matters:
  -- deleteInventoryItem writes its audit row in the same CTE that deletes the
  -- item, so a FK would have to be deferrable for that statement to work at all.
  --
  -- Added when the write/delete isolation tests were written: updateInventoryItem
  -- and deleteInventoryItem both INSERT here as part of their CTE, so without
  -- this table neither method could be exercised under pglite at all -- which is
  -- one reason the write paths had no real-SQL coverage.
  CREATE TABLE audit_log (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    user_id INTEGER,
    inventory_item_id INTEGER,
    action TEXT NOT NULL,
    change_description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE expired_item_transactions (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    inventory_item_id INTEGER NOT NULL,
    user_id INTEGER,
    action TEXT NOT NULL,
    units_discarded INTEGER,
    financial_loss DOUBLE PRECISION,
    markdown_level SMALLINT,
    credit_disposition TEXT NOT NULL DEFAULT 'PENDING'
      CHECK (credit_disposition IN ('PENDING', 'DISPOSED')),
    transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE subscription_tiers (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    tier_level TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    billing_cycle TEXT NOT NULL DEFAULT 'monthly',
    trial_started_at TIMESTAMPTZ,
    trial_end_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Migration 0012: one subscription row per organization. Every reader in
    -- both backends selects it with LIMIT 1, and ensureTrialSubscription's
    -- ON CONFLICT relies on this constraint existing -- without it here the
    -- idempotency tests would pass for the wrong reason (issue #472).
    CONSTRAINT subscription_tiers_organization_id_key UNIQUE (organization_id)
  );

  -- Svix delivery ledger. completed_at (migration 0012) is what makes the row a
  -- claim rather than a receipt: NULL = a delivery is processing it.
  CREATE TABLE clerk_webhook_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Defaulted, as 0012 leaves it: a row inserted without naming the column is
    -- born completed, which is what makes an old Worker's post-hoc marker safe
    -- during the deploy gap. The claim always writes NULL explicitly.
    completed_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE suppliers (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    contact_email TEXT,
    contact_phone TEXT,
    credit_policy_note TEXT NOT NULL DEFAULT '',
    credit_type TEXT NOT NULL DEFAULT 'NONE'
      CHECK (credit_type IN ('NONE', 'FULL_CREDIT')),
    policy_write_off_qty INTEGER,
    policy_credit_qty INTEGER,
    follow_up_days INTEGER NOT NULL DEFAULT 7,
    representative_name TEXT,
    representative_email TEXT,
    policy_updated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, name)
  );

  CREATE TABLE brands (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    manufacturer_name TEXT,
    suggested_supplier_name TEXT,
    supplier_id INTEGER REFERENCES suppliers (id) ON DELETE SET NULL,
    source TEXT NOT NULL DEFAULT 'REFERENCE'
      CHECK (source IN ('REFERENCE', 'USER_ADDED', 'CONFIRMED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, name)
  );

  CREATE INDEX idx_brands_organization_id ON brands (organization_id);
  CREATE INDEX idx_brands_supplier_id ON brands (supplier_id);
  CREATE INDEX idx_products_brand_id ON products (brand_id);

  CREATE TABLE master_catalogue_entries (
    id SERIAL PRIMARY KEY,
    barcode TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    api_sku TEXT,
    sigma_sku TEXT,
    ch2_sku TEXT,
    brand_name TEXT NOT NULL,
    manufacturer_name TEXT,
    category TEXT,
    sub_category TEXT,
    rrp DOUBLE PRECISION,
    metro_price DOUBLE PRECISION,
    retired_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX idx_master_catalogue_entries_api_sku ON master_catalogue_entries (api_sku);
  CREATE INDEX idx_master_catalogue_entries_sigma_sku ON master_catalogue_entries (sigma_sku);
  CREATE INDEX idx_master_catalogue_entries_ch2_sku ON master_catalogue_entries (ch2_sku);

  CREATE TABLE catalogue_seed_runs (
    id SERIAL PRIMARY KEY,
    version INTEGER NOT NULL UNIQUE,
    seeded_at TIMESTAMPTZ NOT NULL,
    source_file_name TEXT NOT NULL,
    inserted INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    unchanged INTEGER NOT NULL,
    retired INTEGER NOT NULL,
    reinstated INTEGER NOT NULL,
    error_count INTEGER NOT NULL
  );

  CREATE TABLE catalogue_corrections (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    product_id INTEGER,
    brand_id INTEGER REFERENCES brands (id) ON DELETE SET NULL,
    barcode TEXT,
    entered_brand_name TEXT,
    chosen_supplier_id INTEGER REFERENCES suppliers (id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('UNMATCHED', 'BRAND_ADDED', 'SUPPLIER_OVERRIDE')),
    status TEXT NOT NULL DEFAULT 'PENDING'
      CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
    created_by_user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX idx_catalogue_corrections_organization_id
    ON catalogue_corrections (organization_id);
  CREATE INDEX idx_catalogue_corrections_status ON catalogue_corrections (status);
  CREATE INDEX idx_catalogue_corrections_product_id ON catalogue_corrections (product_id);
  CREATE INDEX idx_catalogue_corrections_brand_id ON catalogue_corrections (brand_id);
  CREATE INDEX idx_expired_transactions_credit_disposition
    ON expired_item_transactions (credit_disposition);

  CREATE TABLE credit_claims (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    supplier_id INTEGER NOT NULL,
    created_by_user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    contact_email_snapshot TEXT,
    expected_credit_units INTEGER,
    expected_credit_value DOUBLE PRECISION,
    credited_value DOUBLE PRECISION,
    sent_at TIMESTAMPTZ,
    next_follow_up_at TIMESTAMPTZ,
    follow_up_count INTEGER NOT NULL DEFAULT 0,
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE credit_claim_lines (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    claim_id INTEGER NOT NULL REFERENCES credit_claims (id) ON DELETE CASCADE,
    expired_item_transaction_id INTEGER NOT NULL UNIQUE,
    batch_number TEXT,
    units_claimed INTEGER NOT NULL,
    expected_credit_units INTEGER,
    expected_credit_value DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE credit_claim_photos (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    claim_line_id INTEGER NOT NULL REFERENCES credit_claim_lines (id) ON DELETE CASCADE,
    storage_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    delete_after TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE credit_claim_events (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    claim_id INTEGER NOT NULL REFERENCES credit_claims (id) ON DELETE CASCADE,
    user_id INTEGER,
    type TEXT NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

/**
 * Adapts a Neon-style tagged template (`sql\`... ${value} ...\``) to a pglite
 * positional-parameter query. The worker's catalogue code only ever uses `db.sql`
 * as a tagged template with interpolated *values* (never identifiers), so a simple
 * `$1..$n` rewrite is faithful to production.
 */
export function createTaggedSql(pg: PGlite) {
  return (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    strings.forEach((chunk, index) => {
      text += chunk;
      if (index < values.length) {
        text += `$${index + 1}`;
      }
    });
    const result = await pg.query(text, values as unknown[]);
    return result.rows;
  }) as unknown as Database['sql'];
}

export async function createPgliteHarness(): Promise<PgliteHarness> {
  const pg = await PGlite.create();
  await pg.exec(SCHEMA_SQL);
  const db = { sql: createTaggedSql(pg) } as unknown as Database;
  return {
    db,
    pg,
    close: () => pg.close(),
  };
}
