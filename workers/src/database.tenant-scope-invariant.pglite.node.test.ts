/**
 * Tenant-ID integrity invariant (task 3.4, from 2.4 Finding 18).
 *
 * Replaces `backend/scripts/audit-org-ids.ts`, an operator-run script that
 * counted rows with a NULL or orphaned `organization_id` across eight tables.
 * The invariant it checked outlives the SQLite-to-Postgres migration it was
 * written for, and a script somebody has to remember to run is the wrong home
 * for it.
 *
 * The script counted rows. This asserts the constraints that make those rows
 * impossible instead: in the authoritative schema every tenant table carries
 * `organization_id` as NOT NULL with a validated foreign key to
 * `organizations(id)`, so "no NULL tenant id" and "no orphan tenant id" are
 * properties of the catalog, not of whatever data happens to be loaded. A row
 * count over an empty pglite database would pass whatever the schema said.
 *
 * It also covers what the script could not: the script enumerated eight tables
 * by hand, and a table added later was simply not audited. Here every table in
 * `public` must either be tenant-scoped or be listed in `UNSCOPED_TABLES` with
 * the reason it has no tenant, so a new table cannot arrive unclassified.
 *
 * `migrate:verify` compares production against the catalog fingerprint this
 * same schema produces, so a green run here plus a green verify is the
 * production statement the script used to make.
 *
 * The mutation cases at the bottom break the schema one way at a time and
 * assert the exact violation reported, so the check is known to be able to
 * fail.
 *
 * Runs under `vitest.node.config.mts` (`*.node.test.ts`, `npm run test:db`)
 * because pglite is WASM and needs a Node runtime.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPgliteHarness, seedOrganization, type PgliteHarness } from './__tests__/pglite-db';

/**
 * Every table with no `organization_id`, and why it has none. Adding a table
 * to the schema means either giving it a constrained `organization_id` or
 * adding it here with a reason a reviewer can disagree with.
 */
const UNSCOPED_TABLES: Readonly<Record<string, string>> = {
  organizations: 'the tenant root itself',
  refresh_tokens: 'scoped through user_id, which cascades from users',
  master_catalogue_entries: 'the shared master catalogue, identical for every tenant',
  catalogue_seed_runs: 'run ledger for seeding the shared master catalogue',
  tier_feature_flags: 'reference data keyed by tier, not by tenant',
  metrics_snapshots: 'platform-wide SaaS metrics, aggregated across tenants',
  webhook_metrics: 'platform-wide webhook counters',
  clerk_webhook_events: 'webhook idempotency ledger keyed by provider event id',
  processed_webhook_events: 'webhook idempotency ledger keyed by provider event id',
  scheduled_job_runs: 'platform job lease table, one row per job',
  schema_migrations: 'migration runner ledger',
  migrations: 'legacy migration ledger carried in the baseline',
};

interface TableScopeRow {
  table_name: string;
  has_column: boolean;
  not_null: boolean;
  has_validated_fk: boolean;
}

async function findTenantScopeViolations(pg: PGlite): Promise<string[]> {
  const result = await pg.query<TableScopeRow>(`
    SELECT
      c.relname AS table_name,
      a.attnum IS NOT NULL AS has_column,
      COALESCE(a.attnotnull, false) AS not_null,
      EXISTS (
        SELECT 1
        FROM pg_constraint con
        JOIN pg_attribute target
          ON target.attrelid = con.confrelid AND target.attname = 'id'
        WHERE con.conrelid = c.oid
          AND con.contype = 'f'
          AND con.convalidated
          AND con.confrelid = 'public.organizations'::regclass
          AND con.conkey = ARRAY[a.attnum]
          AND con.confkey = ARRAY[target.attnum]
      ) AS has_validated_fk
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attribute a
      ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  `);

  const seen = new Set(result.rows.map((row) => row.table_name));
  const staleEntries = Object.keys(UNSCOPED_TABLES)
    .filter((table) => !seen.has(table))
    .map((table) => `${table}: listed in UNSCOPED_TABLES but does not exist`);
  return [...result.rows.flatMap(tableViolations), ...staleEntries];
}

function tableViolations(row: TableScopeRow): string[] {
  const table = row.table_name;
  const unscoped = table in UNSCOPED_TABLES;
  if (!row.has_column) {
    return unscoped
      ? []
      : [`${table}: no organization_id column and not listed in UNSCOPED_TABLES`];
  }
  return [
    unscoped && `${table}: listed in UNSCOPED_TABLES but has organization_id`,
    !row.not_null && `${table}: organization_id is nullable`,
    !row.has_validated_fk &&
      `${table}: organization_id has no validated foreign key to organizations(id)`,
  ].filter((violation): violation is string => typeof violation === 'string');
}

describe('tenant-ID integrity invariant', () => {
  let harness: PgliteHarness;

  beforeEach(async () => {
    harness = await createPgliteHarness();
  }, 120_000);

  afterEach(async () => {
    await harness.close();
  });

  it('every table is tenant-scoped by constraint or explicitly unscoped', async () => {
    expect(await findTenantScopeViolations(harness.pg)).toEqual([]);
  });

  it('rejects a row with no tenant and a row with an unknown tenant', async () => {
    await seedOrganization(harness.pg, 'org-a');
    const insertStoreArea = (name: string, organizationId: string | null) =>
      harness.pg.query(
        `INSERT INTO store_areas (name, organization_id, updated_at) VALUES ($1, $2, NOW())`,
        [name, organizationId],
      );
    // The control: the same statement succeeds for a real tenant, so the two
    // rejections below are about the tenant id and nothing else in the row.
    await insertStoreArea('Aisle 1', 'org-a');

    await expect(insertStoreArea('No tenant', null)).rejects.toMatchObject({
      code: '23502',
      column: 'organization_id',
    });
    await expect(insertStoreArea('Orphan', 'org-that-does-not-exist')).rejects.toMatchObject({
      code: '23503',
      constraint: 'store_areas_organization_id_fkey',
    });
  });

  describe('fails when the schema stops guaranteeing it', () => {
    it('reports a tenant column made nullable', async () => {
      await harness.pg.exec(`ALTER TABLE products ALTER COLUMN organization_id DROP NOT NULL`);
      expect(await findTenantScopeViolations(harness.pg)).toEqual([
        'products: organization_id is nullable',
      ]);
    });

    it('reports a dropped tenant foreign key', async () => {
      await harness.pg.exec(`ALTER TABLE products DROP CONSTRAINT products_organization_id_fkey`);
      expect(await findTenantScopeViolations(harness.pg)).toEqual([
        'products: organization_id has no validated foreign key to organizations(id)',
      ]);
    });

    it('reports a tenant foreign key that was never validated', async () => {
      await harness.pg.exec(`
        ALTER TABLE products DROP CONSTRAINT products_organization_id_fkey;
        ALTER TABLE products ADD CONSTRAINT products_organization_id_fkey
          FOREIGN KEY (organization_id) REFERENCES organizations(id) NOT VALID;
      `);
      expect(await findTenantScopeViolations(harness.pg)).toEqual([
        'products: organization_id has no validated foreign key to organizations(id)',
      ]);
    });

    it('reports a new table that is neither scoped nor listed', async () => {
      await harness.pg.exec(`CREATE TABLE tenant_notes (id SERIAL PRIMARY KEY, body TEXT)`);
      expect(await findTenantScopeViolations(harness.pg)).toEqual([
        'tenant_notes: no organization_id column and not listed in UNSCOPED_TABLES',
      ]);
    });

    it('reports a new table whose tenant column is unconstrained', async () => {
      await harness.pg.exec(
        `CREATE TABLE tenant_notes (id SERIAL PRIMARY KEY, organization_id TEXT)`,
      );
      expect(await findTenantScopeViolations(harness.pg)).toEqual([
        'tenant_notes: organization_id is nullable',
        'tenant_notes: organization_id has no validated foreign key to organizations(id)',
      ]);
    });
  });
});
