/**
 * Regenerate `database/migrations/catalog-fingerprint.json`.
 *
 * Layer 1 of `src/database/migrations/baseline.fingerprint.test.ts` deep-compares
 * a replay of the whole migration series against this checked-in file, so adding
 * a migration makes the file stale by construction. It is **generated, never
 * hand-edited** — a hand-edit that happens to satisfy the diff also silently
 * disarms the drift detection the file exists to provide.
 *
 * Replays 0000→head against in-memory pglite exactly as the test does, then
 * introspects and normalizes the resulting catalog. Must run from the repo root
 * and live inside the repo: `@electric-sql/pglite` is a root dependency and a
 * script in a scratch directory cannot resolve it.
 *
 *   npm run compile && node scripts/regenerate-catalog-fingerprint.js
 *
 * Review the diff before committing: it should contain only the objects your
 * migration adds. Anything else is drift the fingerprint just caught.
 */
const path = require('node:path');
const { writeFileSync } = require('node:fs');

const {
  applyPendingMigrations,
  loadMigrationHistory,
} = require('../build/src/database/migrations/runner');
const {
  introspectCatalog,
  normalizeCatalog,
} = require('../build/src/database/migrations/catalog-introspection');

const HISTORY_DIR = path.resolve('database/migrations');
const FINGERPRINT_PATH = path.resolve('database/migrations/catalog-fingerprint.json');
const DEPLOYMENT_SHA = 'a'.repeat(40);

/**
 * pglite rejects multi-statement SQL through `query`, so DDL is routed through
 * `exec` and SELECTs through `query` — the same split the fingerprint test uses.
 */
function createMigrationClient(pg) {
  return {
    async query(text, values) {
      if (values !== undefined && values.length > 0) {
        return { rows: (await pg.query(text, values)).rows };
      }
      if (text.trimStart().toUpperCase().startsWith('SELECT')) {
        return { rows: (await pg.query(text)).rows };
      }
      await pg.exec(text);
      return { rows: [] };
    },
  };
}

async function main() {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  try {
    const history = await loadMigrationHistory(HISTORY_DIR);
    const result = await applyPendingMigrations(pg && createMigrationClient(pg), history, {
      deploymentSha: DEPLOYMENT_SHA,
    });
    console.log(`Applied ${result.applied.length} migrations: ${result.applied.join(', ')}`);

    const catalog = await introspectCatalog({
      async query(text) {
        return { rows: (await pg.query(text)).rows };
      },
    });
    const normalized = normalizeCatalog(catalog);

    writeFileSync(FINGERPRINT_PATH, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${FINGERPRINT_PATH}`);
  } finally {
    await pg.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
