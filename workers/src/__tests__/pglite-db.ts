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
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, sku),
    UNIQUE (organization_id, barcode)
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

  CREATE TABLE store_areas (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sub_department TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

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

  CREATE TABLE expired_item_transactions (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    inventory_item_id INTEGER NOT NULL,
    user_id INTEGER,
    action TEXT NOT NULL,
    units_discarded INTEGER,
    financial_loss DOUBLE PRECISION,
    markdown_level SMALLINT,
    transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

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

  CREATE TABLE subscription_tiers (
    id SERIAL PRIMARY KEY,
    organization_id TEXT NOT NULL,
    tier_level TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    billing_cycle TEXT NOT NULL DEFAULT 'monthly',
    trial_started_at TIMESTAMPTZ,
    trial_end_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
