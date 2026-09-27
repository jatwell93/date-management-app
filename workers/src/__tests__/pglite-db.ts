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
 *
 * The schema comes from `database/migrations/` — applied by the real migration
 * runner (`src/database/migrations/runner.ts`) through the shared pglite
 * adapter — and must never be restated here. If a test needs a table or column
 * the migrations do not create, the test is wrong, not the harness.
 *
 * The migrated database is built once per `through` value per test process and
 * cloned via `PGlite.create({ loadDataDir })`, so suites that create a harness
 * in `beforeEach` pay the migration replay cost only once.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  applyPendingMigrations,
  loadMigrationHistory,
} from '../../../src/database/migrations/runner';
import { createPgliteMigrationClient } from '../../../src/database/migrations/pglite-client';
import type { Database } from '../database';

export interface PgliteHarness {
  db: Database;
  pg: PGlite;
  close: () => Promise<void>;
}

const TEST_DEPLOYMENT_SHA = 'a'.repeat(40);
const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../database/migrations',
);

// One migrated data directory per `through` value, shared by every harness in
// this test process. Memoized as a promise so concurrent first callers share
// the single replay.
const snapshotPromises = new Map<string, Promise<Blob | File>>();

async function buildMigratedSnapshot(through: string | undefined): Promise<Blob | File> {
  const history = await loadMigrationHistory(MIGRATIONS_DIR);
  const selected =
    through === undefined ? history : history.filter((migration) => migration.id <= through);
  if (through !== undefined && !selected.some((migration) => migration.id === through)) {
    throw new Error(`createPgliteHarness: unknown migration id in 'through': ${through}`);
  }
  const pg = await PGlite.create();
  try {
    await pg.exec(`SET TIME ZONE 'UTC'`);
    await applyPendingMigrations(createPgliteMigrationClient(pg), selected, {
      deploymentSha: TEST_DEPLOYMENT_SHA,
    });
    return await pg.dumpDataDir();
  } finally {
    await pg.close();
  }
}

function migratedSnapshot(through: string | undefined): Promise<Blob | File> {
  const key = through ?? 'all';
  let promise = snapshotPromises.get(key);
  if (promise === undefined) {
    promise = buildMigratedSnapshot(through);
    snapshotPromises.set(key, promise);
  }
  return promise;
}

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

/**
 * Seed an organization row for tests — most tenant tables carry a real FK to
 * `organizations(id)` now, so fixtures need the parent row first.
 */
export async function seedOrganization(pg: PGlite, id: string, name = id): Promise<void> {
  await pg.query(
    `INSERT INTO organizations (id, name, slug, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [id, name, id.replace(/_/g, '-')],
  );
}

export async function createPgliteHarness(options?: { through?: string }): Promise<PgliteHarness> {
  const snapshot = await migratedSnapshot(options?.through);
  const pg = await PGlite.create({ loadDataDir: snapshot });
  // Production Neon sessions run in UTC; pin every harness connection the same
  // way so TIMESTAMP(3)-without-tz values never depend on the machine's zone.
  await pg.exec(`SET TIME ZONE 'UTC'`);
  const db = { sql: createTaggedSql(pg) } as unknown as Database;
  return {
    db,
    pg,
    close: () => pg.close(),
  };
}
