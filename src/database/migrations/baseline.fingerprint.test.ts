/**
 * Phase 1 task 1.3 — canonical baseline fingerprint test.
 *
 * Three layers of proof:
 *
 * 1. **Checked-in fingerprint**: replay 0000→0009 against pglite, introspect
 *    the full catalog, normalize, and deep-compare every table, column, index,
 *    constraint, function, and trigger against a checked-in JSON file. Catches
 *    drift in any migration after the fingerprint was captured.
 *
 * 2. **Baseline-only cross-comparison**: apply 0000 alone to pglite A; apply
 *    Prisma-generated SQL from the ae26d623~1 schema to pglite B; compare
 *    catalogs structurally. Proves the baseline exactly reproduces the
 *    pre-0001 production schema.
 *
 * 3. **Full-series cross-comparison**: apply 0000→0009 to pglite A; apply
 *    Prisma-generated SQL from the current production schema to pglite B;
 *    compare structurally with an explicit allowlist for known differences.
 *    Catches gaps — Prisma schema objects never captured in a migration.
 *
 * pglite is ESM-only and the root project compiles to CommonJS, so it is
 * loaded via dynamic `import()`. pglite's `query` rejects multi-statement SQL,
 * so the adapter routes DDL through `pg.exec` and SELECTs through `pg.query`.
 */
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  columnStructuralKey,
  constraintStructuralKey,
  functionStructuralKey,
  indexStructuralKey,
  introspectCatalog,
  normalizeCatalog,
  type NormalizedCatalog,
  setDifference,
  triggerStructuralKey,
} from './catalog-introspection';
import { applyPendingMigrations, loadMigrationHistory, type MigrationClient } from './runner';

const TEST_DEPLOYMENT_SHA = 'a'.repeat(40);
const HISTORY_DIR = path.resolve('database/migrations');
const FINGERPRINT_PATH = path.resolve('database/migrations/catalog-fingerprint.json');
const PRODUCTION_SCHEMA_PATH = path.resolve('backend/prisma/production/schema.prisma');
const BASELINE_SOURCE_COMMIT = 'ae26d623~1';

// ---------------------------------------------------------------------------
// pglite adapter
// ---------------------------------------------------------------------------

interface PgliteInstance {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
}

function createPgliteMigrationClient(pg: PgliteInstance): MigrationClient {
  return {
    async query(text: string, values?: readonly unknown[]) {
      if (values !== undefined && values.length > 0) {
        const result = await pg.query(text, values as unknown[]);
        return { rows: result.rows as unknown[] };
      }
      const trimmed = text.trimStart();
      if (trimmed.toUpperCase().startsWith('SELECT')) {
        const result = await pg.query(text);
        return { rows: result.rows as unknown[] };
      }
      await pg.exec(text);
      return { rows: [] };
    },
  };
}

async function createPglite(): Promise<{ pg: PgliteInstance; client: MigrationClient }> {
  const mod = (await import('@electric-sql/pglite')) as {
    PGlite: new () => PgliteInstance;
  };
  const pg = new mod.PGlite();
  return { pg, client: createPgliteMigrationClient(pg) };
}

/** A read-only query client backed by a pglite instance. */
function createPgliteQueryClient(pg: PgliteInstance) {
  return {
    async query(text: string) {
      const result = await pg.query(text);
      return { rows: result.rows as unknown[] };
    },
  };
}

// ---------------------------------------------------------------------------
// Prisma SQL generation (for cross-comparison)
// ---------------------------------------------------------------------------

/**
 * Generate PostgreSQL DDL from a Prisma schema file using `prisma migrate diff`.
 * Uses Prisma 5.22.0 for reproducibility with the historical lockfile.
 */
function generatePrismaSql(schemaPath: string): string {
  const env = { ...process.env, DATABASE_URL: 'postgresql://placeholder@localhost/db' };
  const cmd = `npx prisma@5.22.0 migrate diff --from-empty --to-schema-datamodel "${schemaPath}" --script`;
  return execSync(cmd, { env, encoding: 'utf8', cwd: process.cwd(), timeout: 60000 });
}

/**
 * Extract the Prisma production schema at a specific git revision and write it
 * to a temporary file. Returns the path to the temp file.
 */
function extractHistoricalPrismaSchema(revision: string): string {
  const schema = execSync(`git show ${revision}:backend/prisma/production/schema.prisma`, {
    encoding: 'utf8',
    cwd: process.cwd(),
    timeout: 30000,
  });
  const tempPath = path.join(process.cwd(), '.tmp-baseline-schema.prisma');
  writeFileSync(tempPath, schema, 'utf8');
  return tempPath;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function applyAllMigrations(client: MigrationClient) {
  const history = await loadMigrationHistory(HISTORY_DIR);
  return applyPendingMigrations(client, history, { deploymentSha: TEST_DEPLOYMENT_SHA });
}

/**
 * Apply raw SQL (potentially multi-statement) to a pglite instance.
 */
async function applyRawSql(pg: PgliteInstance, sql: string): Promise<void> {
  await pg.exec(sql);
}

/**
 * Compute structural keys for a normalized catalog, excluding:
 * - NOT NULL constraints (contype 'n'): redundant with column nullability.
 * - CHECK constraints (contype 'c'): Prisma cannot express them; they are
 *   migration-only by design. Verified separately by counting.
 * - UNIQUE constraints (contype 'u'): Prisma generates `CREATE UNIQUE INDEX`
 *   instead of `ALTER TABLE ADD CONSTRAINT UNIQUE`. The index comparison
 *   already covers these functionally.
 * - The runner-owned `schema_migrations` table.
 */
function computeStructuralKeys(catalog: NormalizedCatalog) {
  const tables = catalog.tables.filter((t) => t !== 'schema_migrations');
  const columns = catalog.columns.filter((c) => c.table !== 'schema_migrations');
  const indexes = catalog.indexes.filter((i) => i.table !== 'schema_migrations');
  const constraints = catalog.constraints.filter(
    (c) => c.table !== 'schema_migrations' && c.type !== 'n' && c.type !== 'c' && c.type !== 'u',
  );
  const triggers = catalog.triggers.filter((t) => t.table !== 'schema_migrations');

  return {
    tables: [...tables].sort(),
    columns: columns.map(columnStructuralKey).sort(),
    indexes: indexes.map(indexStructuralKey).sort(),
    constraints: constraints.map(constraintStructuralKey).sort(),
    functions: catalog.functions.map(functionStructuralKey).sort(),
    triggers: triggers.map(triggerStructuralKey).sort(),
    // CHECK and UNIQUE constraints are kept for separate verification.
    checkConstraints: catalog.constraints
      .filter((c) => c.table !== 'schema_migrations' && c.type === 'c')
      .map(constraintStructuralKey)
      .sort(),
    uniqueConstraints: catalog.constraints
      .filter((c) => c.table !== 'schema_migrations' && c.type === 'u')
      .map(constraintStructuralKey)
      .sort(),
  };
}

// ===========================================================================
// Layer 1: Checked-in fingerprint deep comparison
// ===========================================================================

test('checked-in catalog fingerprint matches the migrated schema exactly', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyAllMigrations(client);

    const catalog = await introspectCatalog(createPgliteQueryClient(pg));
    const normalized = normalizeCatalog(catalog);

    const expected = JSON.parse(readFileSync(FINGERPRINT_PATH, 'utf8')) as NormalizedCatalog;

    // Deep-compare every dimension.
    assert.deepEqual(
      normalized.tables,
      expected.tables,
      'Table set mismatch — a table was added or removed',
    );

    assert.deepEqual(
      normalized.columns,
      expected.columns,
      'Column mismatch — a column, type, nullability, or default differs',
    );

    assert.deepEqual(
      normalized.indexes,
      expected.indexes,
      'Index mismatch — an index definition, uniqueness, or partial predicate differs',
    );

    assert.deepEqual(
      normalized.constraints,
      expected.constraints,
      'Constraint mismatch — a constraint type or definition differs',
    );

    assert.deepEqual(
      normalized.functions,
      expected.functions,
      'Function mismatch — a function body differs',
    );

    assert.deepEqual(
      normalized.triggers,
      expected.triggers,
      'Trigger mismatch — a trigger timing, events, or statement differs',
    );
  } finally {
    await pg.close();
  }
});

// ===========================================================================
// Layer 2: Baseline-only cross-comparison against pre-0001 Prisma schema
// ===========================================================================

test('baseline-only schema (0000) matches the pre-0001 Prisma production schema', async () => {
  const { pg: migrationPg, client: migrationClient } = await createPglite();
  const { pg: prismaPg } = await createPglite();
  let tempSchemaPath: string | null = null;
  try {
    // Side A: apply only migration 0000.
    const history = await loadMigrationHistory(HISTORY_DIR);
    const baselineOnly = history.slice(0, 1); // just 0000
    await applyPendingMigrations(migrationClient, baselineOnly, {
      deploymentSha: TEST_DEPLOYMENT_SHA,
    });

    // Side B: generate SQL from the Prisma schema at ae26d623~1 and apply it.
    tempSchemaPath = extractHistoricalPrismaSchema(BASELINE_SOURCE_COMMIT);
    const prismaSql = generatePrismaSql(tempSchemaPath);
    await applyRawSql(prismaPg, prismaSql);

    // Introspect both and compare structurally.
    const migrationCatalog = normalizeCatalog(
      await introspectCatalog(createPgliteQueryClient(migrationPg)),
    );
    const prismaCatalog = normalizeCatalog(
      await introspectCatalog(createPgliteQueryClient(prismaPg)),
    );

    const migrationKeys = computeStructuralKeys(migrationCatalog);
    const prismaKeys = computeStructuralKeys(prismaCatalog);

    // Tables should match exactly.
    assert.deepEqual(
      migrationKeys.tables,
      prismaKeys.tables,
      'Baseline table set differs from Prisma-generated schema',
    );

    // Columns should match exactly (both generated by the same Prisma version).
    assert.deepEqual(
      migrationKeys.columns,
      prismaKeys.columns,
      'Baseline columns differ from Prisma-generated schema',
    );

    // Indexes: Prisma generates names like "organizations_slug_key" while the
    // baseline (also Prisma-generated) uses the same names. So they should match.
    assert.deepEqual(
      migrationKeys.indexes,
      prismaKeys.indexes,
      'Baseline indexes differ from Prisma-generated schema',
    );

    // Constraints: same — both Prisma-generated, so names and definitions match.
    assert.deepEqual(
      migrationKeys.constraints,
      prismaKeys.constraints,
      'Baseline constraints differ from Prisma-generated schema',
    );

    // No functions or triggers in the baseline.
    assert.deepEqual(migrationKeys.functions, [], 'Baseline should have no functions');
    assert.deepEqual(migrationKeys.triggers, [], 'Baseline should have no triggers');
    assert.deepEqual(prismaKeys.functions, [], 'Prisma baseline should have no functions');
    assert.deepEqual(prismaKeys.triggers, [], 'Prisma baseline should have no triggers');
  } finally {
    await migrationPg.close();
    await prismaPg.close();
    if (tempSchemaPath) {
      const fs = await import('node:fs');
      fs.unlinkSync(tempSchemaPath);
    }
  }
});

// ===========================================================================
// Layer 3: Full-series cross-comparison against current Prisma schema
// ===========================================================================

/**
 * Known, accepted differences between the migration-derived schema and the
 * current Prisma production schema. Each entry is documented with its cause.
 *
 * 1. **`updated_at` default**: migration-added tables set
 *    `DEFAULT CURRENT_TIMESTAMP` on `updated_at` columns; Prisma's `@updatedAt`
 *    directive does not generate a database-level default (the application
 *    layer sets the value). The migration approach is safer (the database
 *    always has a value) and is accepted.
 *
 * 2. **Timestamp type**: migration-added columns use `timestamp with time zone`
 *    (TIMESTAMPTZ) while the Prisma schema declares them as `DateTime` which
 *    Prisma maps to `timestamp(3) without time zone`. These are semantically
 *    different but accepted because the migrations deliberately chose TIMESTAMPTZ
 *    for timezone-aware storage.
 */
function isKnownDifference(migKey: string, prismaKey: string): boolean {
  const m = migKey.split('|');
  const p = prismaKey.split('|');
  const column = m[1];

  // `updated_at` default: migration has CURRENT_TIMESTAMP, Prisma has no default.
  if (
    column === 'updated_at' &&
    m[2] === p[2] && // same type
    m[3] === p[3] && // same nullability
    m[4] === 'CURRENT_TIMESTAMP' &&
    p[4] === 'null'
  ) {
    return true;
  }

  // Timestamp type: migration uses timestamptz, Prisma uses timestamp(3).
  if (
    m[2] === 'timestamp with time zone' &&
    p[2] === 'timestamp(3) without time zone' &&
    m[3] === p[3] && // same nullability
    m[4] === p[4] // same default
  ) {
    return true;
  }

  // `expired_item_transactions.markdown_level`: migration 0002 uses `smallint`,
  // Prisma schema declares `Int` (maps to `integer`). The migration was already
  // applied to production with `smallint`; the Prisma schema does not reflect
  // this. This is a pre-existing drift, not introduced by the baseline. Flagged
  // for reconciliation in a future task.
  if (
    m[0] === 'expired_item_transactions' &&
    m[1] === 'markdown_level' &&
    m[2] === 'smallint' &&
    p[2] === 'integer' &&
    m[3] === p[3] &&
    m[4] === p[4]
  ) {
    return true;
  }

  return false;
}

test('full-series schema (0000-0009) matches the current Prisma production schema', async () => {
  const { pg: migrationPg, client: migrationClient } = await createPglite();
  const { pg: prismaPg } = await createPglite();
  try {
    // Side A: apply all migrations 0000-0009.
    await applyAllMigrations(migrationClient);

    // Side B: generate SQL from the current Prisma production schema.
    const prismaSql = generatePrismaSql(PRODUCTION_SCHEMA_PATH);
    await applyRawSql(prismaPg, prismaSql);

    // Introspect both.
    const migrationCatalog = normalizeCatalog(
      await introspectCatalog(createPgliteQueryClient(migrationPg)),
    );
    const prismaCatalog = normalizeCatalog(
      await introspectCatalog(createPgliteQueryClient(prismaPg)),
    );

    const migrationKeys = computeStructuralKeys(migrationCatalog);
    const prismaKeys = computeStructuralKeys(prismaCatalog);

    // Tables: the migration-derived schema has `migrations` (legacy Prisma
    // table) which may not be in the current Prisma schema. The Prisma-derived
    // schema may have tables that were added via db push without a migration.
    const migrationTables = new Set(migrationKeys.tables);
    const prismaTables = new Set(prismaKeys.tables);
    const tablesOnlyInMigrations = [...migrationTables].filter((t) => !prismaTables.has(t));
    const tablesOnlyInPrisma = [...prismaTables].filter((t) => !migrationTables.has(t));

    // The `migrations` table is the legacy SQLite migration table created by
    // the baseline. It may have been removed from the current Prisma schema.
    const expectedMigrationOnlyTables = new Set(['migrations']);
    const unexpectedMigrationOnly = tablesOnlyInMigrations.filter(
      (t) => !expectedMigrationOnlyTables.has(t),
    );
    assert.equal(
      unexpectedMigrationOnly.length,
      0,
      `Tables in migrations but not in Prisma schema: ${unexpectedMigrationOnly.join(', ')}`,
    );
    assert.equal(
      tablesOnlyInPrisma.length,
      0,
      `Tables in Prisma schema but not in migrations (gaps): ${tablesOnlyInPrisma.join(', ')}`,
    );

    // Columns: compare structurally, allowing known differences.
    const migrationColKeys = new Set(migrationKeys.columns);
    const prismaColKeys = new Set(prismaKeys.columns);
    const colsOnlyInMigrations = [...migrationColKeys].filter((k) => !prismaColKeys.has(k));
    const colsOnlyInPrisma = [...prismaColKeys].filter((k) => !migrationColKeys.has(k));

    // Filter out columns from the `migrations` table (legacy, not in current Prisma).
    const migrationOnlyColsFiltered = colsOnlyInMigrations.filter(
      (k) => !k.startsWith('migrations|'),
    );

    // For each column only in migrations, check if there's a matching column
    // in Prisma with the same table|column but a known difference.
    const knownDifferences: string[] = [];
    const realColDifferences: string[] = [];

    for (const migKey of migrationOnlyColsFiltered) {
      const parts = migKey.split('|');
      const tableCol = `${parts[0]}|${parts[1]}`;
      const matchingPrisma = colsOnlyInPrisma.find((p) => {
        const pParts = p.split('|');
        return `${pParts[0]}|${pParts[1]}` === tableCol;
      });
      if (matchingPrisma) {
        if (isKnownDifference(migKey, matchingPrisma)) {
          knownDifferences.push(
            `${tableCol}: migration=${parts.slice(2).join(',')} vs prisma=${matchingPrisma.split('|').slice(2).join(',')}`,
          );
        } else {
          realColDifferences.push(
            `${tableCol}: migration=${parts.slice(2).join(',')} vs prisma=${matchingPrisma.split('|').slice(2).join(',')}`,
          );
        }
      } else {
        realColDifferences.push(`Only in migrations: ${migKey}`);
      }
    }

    // Check for columns only in Prisma (gaps — not captured by any migration).
    for (const prismaKey of colsOnlyInPrisma) {
      const parts = prismaKey.split('|');
      const tableCol = `${parts[0]}|${parts[1]}`;
      const matchingMigration = migrationOnlyColsFiltered.find((m) => {
        const mParts = m.split('|');
        return `${mParts[0]}|${mParts[1]}` === tableCol;
      });
      if (!matchingMigration && !prismaKey.startsWith('migrations|')) {
        realColDifferences.push(`Only in Prisma: ${prismaKey}`);
      }
    }

    // Known differences are expected and accepted. Real differences are gaps.
    assert.equal(
      realColDifferences.length,
      0,
      `Column differences (not in allowlist):\n${realColDifferences.join('\n')}`,
    );

    // Indexes: compare structurally (ignoring names).
    // Migrations create partial indexes with WHERE clauses that Prisma cannot
    // express in the schema definition. These are migration-only by design.
    const MIGRATION_ONLY_PARTIAL_INDEXES = new Set([
      // 0004: one active cycle per org
      "check_cycles|ON public.check_cycles USING btree (organization_id) WHERE (status = 'active'::text)|true|false|(status = 'active'::text)",
      // 0001: one active catalogue import per org
      "uploads|ON public.uploads USING btree (organization_id) WHERE ((import_type = 'product-catalog'::text) AND (status = ANY (ARRAY['pending'::text, 'queued'::text, 'validating'::text, 'processing'::text])))|true|false|((import_type = 'product-catalog'::text) AND (status = ANY (ARRAY['pending'::text, 'queued'::text, 'validating'::text, 'processing'::text])))",
    ]);
    // Prisma declares @@index([status]) on CheckCycle but migration 0004 does not
    // create it. This is a known gap — the Prisma schema has an index that the
    // migration series doesn't create. Flagged for a future migration to add it.
    const PRISMA_ONLY_KNOWN_INDEXES = new Set([
      'check_cycles|ON public.check_cycles USING btree (status)|false|false|null',
    ]);
    const idxOnlyInMigrations = setDifference(migrationKeys.indexes, prismaKeys.indexes);
    const idxOnlyInPrisma = setDifference(prismaKeys.indexes, migrationKeys.indexes);
    // Filter out indexes on the `migrations` table and known migration-only partial indexes.
    const idxMigFiltered = idxOnlyInMigrations.filter(
      (k) => !k.startsWith('migrations|') && !MIGRATION_ONLY_PARTIAL_INDEXES.has(k),
    );
    // Filter out known Prisma-only indexes (gaps to be addressed by future migrations).
    const idxPrismaFiltered = idxOnlyInPrisma.filter((k) => !PRISMA_ONLY_KNOWN_INDEXES.has(k));
    assert.equal(
      idxMigFiltered.length,
      0,
      `Indexes only in migrations (not in Prisma, not in allowlist):\n${idxMigFiltered.join('\n')}`,
    );
    assert.equal(
      idxPrismaFiltered.length,
      0,
      `Indexes only in Prisma (not in migrations, not in allowlist):\n${idxPrismaFiltered.join('\n')}`,
    );

    // Constraints (FK + PK only): compare structurally (ignoring names).
    // CHECK and UNIQUE constraints are excluded — Prisma cannot express CHECK,
    // and uses CREATE UNIQUE INDEX instead of ADD CONSTRAINT UNIQUE.
    // CHECK constraints are verified to exist in the migration-derived schema
    // below; UNIQUE constraints are covered by the index comparison above.
    const conOnlyInMigrations = setDifference(migrationKeys.constraints, prismaKeys.constraints);
    const conOnlyInPrisma = setDifference(prismaKeys.constraints, migrationKeys.constraints);
    // Filter out constraints on the `migrations` table.
    const conMigFiltered = conOnlyInMigrations.filter((k) => !k.startsWith('migrations|'));
    assert.equal(
      conMigFiltered.length,
      0,
      `Constraints only in migrations (not in Prisma, not in allowlist):\n${conMigFiltered.join('\n')}`,
    );
    assert.equal(
      conOnlyInPrisma.length,
      0,
      `Constraints only in Prisma (not in migrations):\n${conOnlyInPrisma.join('\n')}`,
    );

    // CHECK constraints: Prisma cannot express them. Verify they exist in the
    // migration-derived schema (they should all be migration-only).
    assert.ok(
      migrationKeys.checkConstraints.length >= 14,
      `Migration-derived schema must have at least 14 CHECK constraints (got ${migrationKeys.checkConstraints.length})`,
    );

    // UNIQUE constraints: verify they exist in the migration-derived schema.
    // Their functional equivalents (unique indexes) are checked in the index
    // comparison above.
    assert.ok(
      migrationKeys.uniqueConstraints.length >= 6,
      `Migration-derived schema must have at least 6 UNIQUE constraints (got ${migrationKeys.uniqueConstraints.length})`,
    );

    // Functions and triggers: migration 0004 adds one function and one trigger.
    // The Prisma-generated schema has none.
    // This is expected — Prisma doesn't generate functions/triggers.
    // We verify they exist in the migration-derived schema.
    assert.ok(
      migrationKeys.functions.length >= 1,
      'Migration-derived schema must have the 0004 function',
    );
    assert.ok(
      migrationKeys.triggers.length >= 1,
      'Migration-derived schema must have the 0004 trigger',
    );
  } finally {
    await migrationPg.close();
    await prismaPg.close();
  }
});
