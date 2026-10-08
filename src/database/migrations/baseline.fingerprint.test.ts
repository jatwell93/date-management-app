/**
 * Phase 1 task 1.3: canonical baseline fingerprint test.
 *
 * Replays 0000 to latest against pglite, introspects the full catalog,
 * normalizes it, and deep-compares every table, column, index, constraint,
 * function, and trigger against a checked-in JSON file. Catches drift in any
 * migration after the fingerprint was captured.
 *
 * The Prisma cross-comparison layers were retired with the Prisma schema
 * (OpenSpec change retire-express-unify-on-postgres, task 4.1). The tag
 * `express-sqlite-last` holds the last revision that had them.
 *
 * pglite is ESM-only and the root project compiles to CommonJS, so it is
 * loaded via dynamic `import()`. pglite's `query` rejects multi-statement SQL,
 * so the adapter routes DDL through `pg.exec` and SELECTs through `pg.query`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  introspectCatalog,
  normalizeCatalog,
  type NormalizedCatalog,
} from './catalog-introspection';
import { createPgliteMigrationClient, type PgliteInstance } from './pglite-client';
import { applyPendingMigrations, loadMigrationHistory, type MigrationClient } from './runner';

const TEST_DEPLOYMENT_SHA = 'a'.repeat(40);
const HISTORY_DIR = path.resolve('database/migrations');
const FINGERPRINT_PATH = path.resolve('database/migrations/catalog-fingerprint.json');

// ---------------------------------------------------------------------------
// pglite adapter
// ---------------------------------------------------------------------------

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
// Helpers
// ---------------------------------------------------------------------------

async function applyAllMigrations(client: MigrationClient) {
  const history = await loadMigrationHistory(HISTORY_DIR);
  return applyPendingMigrations(client, history, { deploymentSha: TEST_DEPLOYMENT_SHA });
}

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
