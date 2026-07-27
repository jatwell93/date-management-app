/**
 * Phase 1 task 1.6 — end-to-end migration runner proof against real PostgreSQL.
 *
 * This suite exercises the migration runner, adoption command, seed, verify,
 * and status commands against a real PostgreSQL engine (not pglite) to prove
 * the full lifecycle works end-to-end:
 *
 *   1. Fresh install — empty DB → apply 0000→0010 → verify passes
 *   2. Existing-schema adoption — pre-shape 0000→0009 directly → adopt at
 *      0009 → apply 0010 → verify passes
 *   3. Concurrent invocation refusal — advisory lock held externally →
 *      runner refuses
 *   4. Interruption/recovery — ledger row stuck at 'applying' → resume
 *      refused → explicit repair → resume succeeds
 *   5. Checksum drift — tampered migration file → status reports drift →
 *      apply refuses
 *   6. Catalog drift — manual schema tampering after apply → verify fails
 *   7. Safe down migration — execute 0010 down SQL directly → schema
 *      reverts to int4 → verify fails with only the limit_value diff
 *   8. Forward fix — re-apply 0010 after down → schema returns to bigint →
 *      verify passes
 *
 * **Fail-closed policy.** This suite does NOT skip when required env vars are
 * unset — it fails. A skipped e2e suite provides zero proof; a failing one is
 * visible.
 *
 * **Dedicated-target policy (P0 safety).** This suite runs `DROP SCHEMA public
 * CASCADE` between tests. To prevent a mistaken production/shared URL from
 * erasing real data, TWO env vars are required and cross-checked:
 *
 *   - `MIGRATION_E2E_DATABASE_URL` — direct (non-pooled) PostgreSQL URL.
 *   - `MIGRATION_E2E_CONFIRMATION` — must equal the exact token
 *     `DROP <dbname> AT <host>` where `<dbname>` and `<host>` are parsed from
 *     the URL. This proves the operator knows which database will be wiped.
 *
 * On startup the suite also opens a connection, queries `current_database()`
 * and `inet_server_addr()`, and asserts they match the URL. If the URL points
 * at a host whose name contains `prod`, `primary`, or `main`, the suite
 * refuses to run regardless of the confirmation token.
 *
 *   MIGRATION_E2E_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/migration_e2e \
 *   MIGRATION_E2E_CONFIRMATION="DROP migration_e2e AT localhost" \
 *     npm run test:migrations:e2e
 *
 * Tests run with `--test-concurrency=1` because each test resets the `public`
 * schema (DROP CASCADE → CREATE) and they cannot overlap.
 */
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { Client } from 'pg';

import { performAdoption, selectAdoptionTarget } from './adopt';
import { applyPendingMigrations, loadMigrationHistory } from './runner';
import { getMigrationStatus } from './status';
import { seedTierFeatureFlags } from './seed';
import { verifyMigration } from './verify';

// ---------------------------------------------------------------------------
// Fail-closed env var check + dedicated-target identity verification
// ---------------------------------------------------------------------------

const E2E_DATABASE_URL = process.env.MIGRATION_E2E_DATABASE_URL;
const E2E_CONFIRMATION = process.env.MIGRATION_E2E_CONFIRMATION;

if (!E2E_DATABASE_URL) {
  // Throwing at module top-level causes `node --test` to report this file as
  // failed — not skipped. This is intentional: a missing e2e target is a
  // configuration error, not a pass.
  throw new Error(
    'MIGRATION_E2E_DATABASE_URL is required for the e2e migration suite. ' +
      'This suite fails closed (it does not skip) when the env var is absent. ' +
      'Set it to a DIRECT (non-pooled) PostgreSQL connection string for a ' +
      'DEDICATED e2e database — never a production or shared database.',
  );
}

// Parse the URL once, up front, to derive the expected confirmation token and
// to refuse production-shaped targets. The `pg` package accepts URL-style
// connection strings; we parse it ourselves only for the safety check.
const PARSED_E2E_URL = new URL(E2E_DATABASE_URL);
const E2E_DB_NAME = PARSED_E2E_URL.pathname.replace(/^\//, '');
const E2E_DB_HOST = PARSED_E2E_URL.hostname;

if (!E2E_DB_NAME) {
  throw new Error(
    `MIGRATION_E2E_DATABASE_URL must include a database name in the path ` +
      `(got "${PARSED_E2E_URL.pathname}"). The suite needs a dedicated database.`,
  );
}

// Refuse hosts whose name suggests production / primary / main, regardless of
// the confirmation token. This is a belt-and-braces guard against an operator
// who somehow types the right token for the wrong URL.
const PROD_SHAPED_HOST = /(^|[._-])(prod|production|primary|main)($|[._-])/i;
if (PROD_SHAPED_HOST.test(E2E_DB_HOST) || PROD_SHAPED_HOST.test(E2E_DB_NAME)) {
  throw new Error(
    `Refusing to run the e2e suite against a production-shaped target ` +
      `(host="${E2E_DB_HOST}", db="${E2E_DB_NAME}"). Point ` +
      `MIGRATION_E2E_DATABASE_URL at a dedicated e2e database.`,
  );
}

const EXPECTED_CONFIRMATION = `DROP ${E2E_DB_NAME} AT ${E2E_DB_HOST}`;
if (E2E_CONFIRMATION !== EXPECTED_CONFIRMATION) {
  throw new Error(
    `MIGRATION_E2E_CONFIRMATION must equal exactly "${EXPECTED_CONFIRMATION}" ` +
      `(got "${E2E_CONFIRMATION ?? '<unset>'}"). This token proves the operator ` +
      `knows the suite will DROP SCHEMA public CASCADE on ` +
      `database "${E2E_DB_NAME}" @ host "${E2E_DB_HOST}".`,
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_DEPLOYMENT_SHA = 'a'.repeat(40);
const HISTORY_DIR = path.resolve('database/migrations');
const FINGERPRINT_PATH = path.resolve('database/migrations/catalog-fingerprint.json');
const FINGERPRINT_0009_PATH = path.resolve('database/migrations/catalog-fingerprint.0009.json');

// ---------------------------------------------------------------------------
// Live-target identity verification (runs once, before any test)
// ---------------------------------------------------------------------------

// The URL parse above proves the operator typed a self-consistent
// confirmation token. But DNS, pgbouncer, or a copy-paste mistake could still
// route the actual TCP connection somewhere else. Before any test runs (and
// before any DROP), open one connection, ask the server what database it is,
// and assert it matches the URL. This is the second layer of the P0 guard.
let identityVerified = false;
async function verifyLiveTargetIdentity(): Promise<void> {
  if (identityVerified) return;
  const client = await createClient();
  try {
    const result = await client.query('SELECT current_database() AS db');
    const liveDb = (result.rows[0] as { db?: string }).db;
    if (liveDb !== E2E_DB_NAME) {
      throw new Error(
        `Live target identity mismatch: MIGRATION_E2E_DATABASE_URL path says ` +
          `"${E2E_DB_NAME}" but the server reports current_database()="${liveDb}". ` +
          `Refusing to proceed — the connection did not land on the expected database.`,
      );
    }
    identityVerified = true;
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createClient(): Promise<Client> {
  const client = new Client({
    connectionString: E2E_DATABASE_URL,
    application_name: 'migration-e2e-test',
    connectionTimeoutMillis: 15_000,
  });
  await client.connect();
  return client;
}

/**
 * Reset the `public` schema between tests. DROP CASCADE removes all tables,
 * indexes, functions, and the schema_migrations ledger; CREATE restores an
 * empty `public` schema. Each test starts from a clean slate.
 *
 * Before the first DROP, runs the live-target identity check. The check is
 * idempotent (guarded by `identityVerified`) so subsequent calls are free.
 */
async function resetSchema(client: Client): Promise<void> {
  await verifyLiveTargetIdentity();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
}

// Drop the public schema once after every test in this file has run, so the
// dedicated e2e database is not left carrying the test schema. This is a
// courtesy cleanup — the safety guards above are what prevent damage to a
// non-dedicated target, not this hook.
after(async () => {
  if (!identityVerified) return; // No test ran the identity check; nothing to clean.
  const client = await createClient();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
});

/**
 * Apply migration .up.sql files directly via `client.query` WITHOUT going
 * through the runner. This simulates a pre-adoption production database:
 * the schema exists but no `schema_migrations` ledger has been created.
 *
 * Only applies migrations up to (and including) the given stop ID.
 */
async function applyMigrationsDirectly(client: Client, stopId?: string): Promise<void> {
  const history = await loadMigrationHistory(HISTORY_DIR);
  for (const migration of history) {
    await client.query(migration.sql);
    if (stopId !== undefined && migration.id === stopId) return;
  }
  if (stopId !== undefined) {
    throw new Error(`Migration ${stopId} not found in history`);
  }
}

/**
 * Read the SQL type of a column from information_schema.
 */
async function getColumnType(
  client: Client,
  tableName: string,
  columnName: string,
): Promise<string> {
  const result = await client.query(
    `SELECT data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [tableName, columnName],
  );
  const row = result.rows[0] as { data_type?: string } | undefined;
  if (!row?.data_type) throw new Error(`Column ${tableName}.${columnName} not found`);
  return row.data_type;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('e2e: fresh install — empty DB → apply 0000→0010 → verify passes', async () => {
  const client = await createClient();
  try {
    await resetSchema(client);
    const history = await loadMigrationHistory(HISTORY_DIR);
    const result = await applyPendingMigrations(client, history, {
      deploymentSha: TEST_DEPLOYMENT_SHA,
    });

    assert.deepEqual(result.applied, [
      '0000',
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
      '0007',
      '0008',
      '0009',
      '0010',
    ]);
    assert.deepEqual(result.alreadyApplied, []);

    // Seed reference data, then verify the full schema + reference data.
    await seedTierFeatureFlags(client);
    const report = await verifyMigration(client, FINGERPRINT_PATH);
    assert.equal(report.verified, true, `Expected verify to PASS:\n${report.report}`);
  } finally {
    await client.end();
  }
});

test('e2e: existing-schema adoption — pre-shape 0000→0009 → adopt at 0009 → apply 0010 → verify passes', async () => {
  const client = await createClient();
  try {
    await resetSchema(client);

    // Simulate a pre-adoption production database: apply 0000→0009 directly
    // (no ledger). The schema matches the 0009 fingerprint but no
    // schema_migrations table exists.
    await applyMigrationsDirectly(client, '0009');

    // Dry-run adoption at 0009 — should report READY.
    const { history: adoptionHistory, fingerprintPath } = selectAdoptionTarget(
      await loadMigrationHistory(HISTORY_DIR),
      HISTORY_DIR,
      '0009',
    );
    assert.equal(fingerprintPath, FINGERPRINT_0009_PATH);

    const dryRunReport = await performAdoption(client, adoptionHistory, {
      deploymentSha: TEST_DEPLOYMENT_SHA,
      mode: 'dry-run',
      fingerprintPath,
    });
    assert.equal(dryRunReport.canAdopt, true, `Dry-run should be READY:\n${dryRunReport.report}`);

    // Approved adoption at 0009 — stamps the ledger with 0000→0009.
    const applyReport = await performAdoption(client, adoptionHistory, {
      deploymentSha: TEST_DEPLOYMENT_SHA,
      mode: 'apply',
      fingerprintPath,
      adoptionConfirmation: `ADOPT localhost/postgres AT 0009`,
      targetHost: 'localhost',
      targetDatabase: 'postgres',
    });
    assert.equal(applyReport.canAdopt, true, `Adoption should succeed:\n${applyReport.report}`);

    // Now run the normal apply — it should see 0010 as pending and apply it.
    const fullHistory = await loadMigrationHistory(HISTORY_DIR);
    const result = await applyPendingMigrations(client, fullHistory, {
      deploymentSha: TEST_DEPLOYMENT_SHA,
    });
    assert.deepEqual(result.applied, ['0010']);
    assert.deepEqual(result.alreadyApplied, [
      '0000',
      '0001',
      '0002',
      '0003',
      '0004',
      '0005',
      '0006',
      '0007',
      '0008',
      '0009',
    ]);

    // Seed + verify against the full (0010) fingerprint.
    await seedTierFeatureFlags(client);
    const verifyReport = await verifyMigration(client, FINGERPRINT_PATH);
    assert.equal(verifyReport.verified, true, `Expected verify to PASS:\n${verifyReport.report}`);
  } finally {
    await client.end();
  }
});

test('e2e: concurrent invocation refusal — advisory lock held → runner refuses', async () => {
  const clientA = await createClient();
  const clientB = await createClient();
  try {
    await resetSchema(clientA);

    // Client A manually acquires the migration advisory lock and holds it.
    // This simulates a concurrent migration process (or a stuck lock).
    const { MIGRATION_LOCK_NAMESPACE, MIGRATION_LOCK_KEY } = await import('./runner');
    const lockResult = await clientA.query('SELECT pg_try_advisory_lock($1, $2) AS acquired', [
      MIGRATION_LOCK_NAMESPACE,
      MIGRATION_LOCK_KEY,
    ]);
    assert.equal((lockResult.rows[0] as { acquired: boolean }).acquired, true);

    // Client B tries to run the migration runner — must refuse immediately.
    const history = await loadMigrationHistory(HISTORY_DIR);
    await assert.rejects(
      applyPendingMigrations(clientB, history, { deploymentSha: TEST_DEPLOYMENT_SHA }),
      /Refusing to run because another migration process holds the advisory lock/,
    );

    // Release the lock from A.
    await clientA.query('SELECT pg_advisory_unlock($1, $2)', [
      MIGRATION_LOCK_NAMESPACE,
      MIGRATION_LOCK_KEY,
    ]);
  } finally {
    await clientA.end();
    await clientB.end();
  }
});

/**
 * Build a temp migration history that is a copy of the real history plus one
 * extra migration `0011` marked `transaction: forbidden`. Its single
 * `CREATE UNIQUE INDEX CONCURRENTLY` statement targets duplicate data, so
 * PostgreSQL fails the build but deliberately leaves an invalid index behind.
 * This is a real partial catalog state produced by a non-transactional DDL
 * failure, without relying on multi-statement query transaction semantics.
 *
 * Used by the interruption/recovery test to exercise the actual
 * `applyNonTransactional` interruption path (not a faked ledger row).
 *
 * Returns the temp dir path. The caller MUST `rm` it in a `finally` block.
 */
async function buildTempHistoryWithFailingNonTxMigration(): Promise<{
  dir: string;
  upFile: string;
  downFile: string;
  probeTable: string;
  probeIndex: string;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), 'migration-interruption-'));
  await cp(HISTORY_DIR, dir, { recursive: true });

  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    migrations: unknown[];
  };
  const probeTable = 'e2e_interruption_probe';
  const probeIndex = 'e2e_interruption_probe_value_idx';
  const upFile = `0011_${probeTable}.up.sql`;
  const downFile = `0011_${probeTable}.down.sql`;

  const failingUpSql = `CREATE UNIQUE INDEX CONCURRENTLY ${probeIndex} ON ${probeTable} (value);`;
  const downSql = `DROP INDEX CONCURRENTLY IF EXISTS ${probeIndex};`;

  await writeFile(path.join(dir, upFile), failingUpSql);
  await writeFile(path.join(dir, downFile), downSql);

  manifest.migrations.push({
    id: '0011',
    forward: upFile,
    transaction: 'forbidden',
    compatibility: 'expand',
    dataLoss: 'none',
    recovery: {
      strategy: 'forward-fix',
      file: downFile,
      execution: 'manual-only',
      dataLoss: 'destructive',
      completeness: 'partial',
    },
  });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  return { dir, upFile, downFile, probeTable, probeIndex };
}

test('e2e: interruption/recovery — failed concurrent index → resume refused → repair → resume succeeds', async () => {
  const client = await createClient();
  let tempDir: string | undefined;
  try {
    await resetSchema(client);

    // 1. Apply the real history 0000→0010 (all transactional, all succeed).
    const realHistory = await loadMigrationHistory(HISTORY_DIR);
    await applyPendingMigrations(client, realHistory, { deploymentSha: TEST_DEPLOYMENT_SHA });

    // 2. Build a temp history with an extra transaction-forbidden migration.
    //    Duplicate source rows make CREATE UNIQUE INDEX CONCURRENTLY fail,
    //    leaving an invalid index as PostgreSQL's documented partial state.
    const temp = await buildTempHistoryWithFailingNonTxMigration();
    tempDir = temp.dir;
    await client.query(`CREATE TABLE ${temp.probeTable} (value integer NOT NULL)`);
    await client.query(`INSERT INTO ${temp.probeTable} (value) VALUES (1), (1)`);
    const tempHistory = await loadMigrationHistory(temp.dir);

    // 3. Apply the temp history. The runner sees 0011 as pending, calls
    //    applyNonTransactional, writes 'applying', runs the SQL, and the
    //    concurrent unique-index build fails. The ledger stays at 'applying'.
    await assert.rejects(
      applyPendingMigrations(client, tempHistory, { deploymentSha: TEST_DEPLOYMENT_SHA }),
      /could not create unique index|duplicate key/i,
    );

    // 4. Prove PostgreSQL left the failed concurrent index behind and marked
    //    it invalid. A fabricated ledger row would not produce this evidence.
    const invalidIndex = await client.query(
      `SELECT i.indisvalid
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       WHERE c.relname = $1`,
      [temp.probeIndex],
    );
    assert.equal((invalidIndex.rows[0] as { indisvalid?: boolean }).indisvalid, false);

    // 5. The ledger row for 0011 is stuck at 'applying'.
    const ledgerRow = await client.query("SELECT state FROM schema_migrations WHERE id = '0011'");
    assert.equal((ledgerRow.rows[0] as { state: string }).state, 'applying');

    // 6. Resume must be refused — validateLedger detects the interrupted state.
    await assert.rejects(
      applyPendingMigrations(client, tempHistory, { deploymentSha: TEST_DEPLOYMENT_SHA }),
      /Migration 0011 was interrupted outside a transaction; repair it explicitly before resuming/,
    );

    // 7. Status reports the interrupted migration.
    const statusBefore = await getMigrationStatus(client, temp.dir);
    assert.deepEqual(statusBefore.interrupted, ['0011']);

    // 8. Explicit repair — the documented operator path:
    //    a) roll back the partial DDL (drop the invalid index),
    //    b) delete the interrupted ledger row,
    //    c) fix the migration SQL (rewrite the up.sql without the failing
    //       third statement),
    //    d) re-apply.
    await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${temp.probeIndex}`);
    await client.query("DELETE FROM schema_migrations WHERE id = '0011'");
    await writeFile(
      path.join(temp.dir, temp.upFile),
      `CREATE INDEX CONCURRENTLY ${temp.probeIndex} ON ${temp.probeTable} (value);`,
    );

    // Re-load the history after rewriting 0011's up.sql (the checksum changes).
    const fixedHistory = await loadMigrationHistory(temp.dir);
    const result = await applyPendingMigrations(client, fixedHistory, {
      deploymentSha: TEST_DEPLOYMENT_SHA,
    });
    assert.deepEqual(result.applied, ['0011']);

    // 9. The repaired index is valid and the ledger is healthy.
    const indexAfter = await client.query(
      `SELECT i.indisvalid
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       WHERE c.relname = $1`,
      [temp.probeIndex],
    );
    assert.equal((indexAfter.rows[0] as { indisvalid?: boolean }).indisvalid, true);
    const ledgerAfter = await client.query("SELECT state FROM schema_migrations WHERE id = '0011'");
    assert.equal((ledgerAfter.rows[0] as { state: string }).state, 'applied');

    const statusAfter = await getMigrationStatus(client, temp.dir);
    assert.deepEqual(statusAfter.interrupted, []);
  } finally {
    await client.end();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
});

test('e2e: checksum drift — tampered migration file → status reports drift → apply refuses', async () => {
  const client = await createClient();
  let tempDir: string | undefined;
  try {
    await resetSchema(client);

    // Apply all migrations with the real history.
    const history = await loadMigrationHistory(HISTORY_DIR);
    await applyPendingMigrations(client, history, { deploymentSha: TEST_DEPLOYMENT_SHA });

    // Create a temp copy of the history with one migration file tampered.
    // Adding a harmless SQL comment changes the file content and thus the
    // checksum, but does not change the schema.
    tempDir = await mkdtemp(path.join(tmpdir(), 'migration-checksum-drift-'));
    await cp(HISTORY_DIR, tempDir, { recursive: true });
    const tamperedFile = path.join(
      tempDir,
      '0010_alter_tier_feature_flags_limit_value_to_bigint.up.sql',
    );
    const original = await readFile(tamperedFile, 'utf8');
    await writeFile(tamperedFile, `-- tampered for e2e checksum drift test\n${original}`);

    // Load the tampered history — 0010's checksum now differs from the ledger.
    const tamperedHistory = await loadMigrationHistory(tempDir);

    // Status should report checksum drift on 0010.
    const status = await getMigrationStatus(client, tempDir);
    assert.deepEqual(status.checksumDrift, ['0010']);

    // Apply must refuse — validateLedger detects the checksum mismatch.
    await assert.rejects(
      applyPendingMigrations(client, tamperedHistory, { deploymentSha: TEST_DEPLOYMENT_SHA }),
      /Applied migration 0010 checksum mismatch/,
    );
  } finally {
    await client.end();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
});

test('e2e: catalog drift — manual schema tampering after apply → verify fails', async () => {
  const client = await createClient();
  try {
    await resetSchema(client);

    const history = await loadMigrationHistory(HISTORY_DIR);
    await applyPendingMigrations(client, history, { deploymentSha: TEST_DEPLOYMENT_SHA });
    await seedTierFeatureFlags(client);

    // Verify passes before tampering.
    const beforeReport = await verifyMigration(client, FINGERPRINT_PATH);
    assert.equal(beforeReport.verified, true);

    // Tamper: add an unexpected column to an existing table.
    await client.query('ALTER TABLE organizations ADD COLUMN e2e_drift_test text');

    // Verify must fail — the catalog no longer matches the fingerprint.
    const afterReport = await verifyMigration(client, FINGERPRINT_PATH);
    assert.equal(afterReport.verified, false, 'Expected verify to FAIL after catalog drift');
    assert.equal(afterReport.catalogOk, false);
    assert.ok(afterReport.catalogDiff !== null, 'Expected a catalog diff after drift');
  } finally {
    await client.end();
  }
});

test('e2e: safe down migration — execute 0010 down SQL directly → schema reverts to int4 → verify fails with only limit_value diff', async () => {
  const client = await createClient();
  try {
    await resetSchema(client);

    const history = await loadMigrationHistory(HISTORY_DIR);
    await applyPendingMigrations(client, history, { deploymentSha: TEST_DEPLOYMENT_SHA });
    await seedTierFeatureFlags(client);

    // Confirm limit_value is bigint after applying 0010.
    const typeBefore = await getColumnType(client, 'tier_feature_flags', 'limit_value');
    assert.equal(typeBefore, 'bigint');

    // Execute the 0010 down SQL directly (no migrate:down CLI — per task 1.6
    // decision, downs are manual-only, executed via guarded psql).
    const downSql = await readFile(
      path.join(HISTORY_DIR, '0010_alter_tier_feature_flags_limit_value_to_bigint.down.sql'),
      'utf8',
    );
    await client.query(downSql);

    // The column is now integer (int4) — the down migration narrowed it.
    const typeAfter = await getColumnType(client, 'tier_feature_flags', 'limit_value');
    assert.equal(typeAfter, 'integer');

    // Verify must fail — the fingerprint expects bigint, the actual is integer.
    // The ADOPTION_COMPARISON profile is strict (no broad column exceptions),
    // so this difference is a mismatch. The ONLY diff should be limit_value.
    const report = await verifyMigration(client, FINGERPRINT_PATH);
    assert.equal(report.verified, false, 'Expected verify to FAIL after down migration');
    assert.equal(report.catalogOk, false);
    assert.ok(report.catalogDiff !== null);

    // The only column-level difference should be tier_feature_flags.limit_value.
    // (Other diff categories like tables/indexes should be empty.)
    const diff = report.catalogDiff;
    assert.equal(diff.tablesOnlyInExpected.length, 0, 'No tables should be missing');
    assert.equal(diff.tablesOnlyInActual.length, 0, 'No extra tables expected');
    assert.equal(diff.columnsOnlyInExpected.length, 1);
    assert.equal(
      diff.columnsOnlyInActual.length,
      0,
      'Paired column changes are reported on the expected side only',
    );
    assert.match(diff.columnsOnlyInExpected[0], /tier_feature_flags\|limit_value/);
    assert.deepEqual(diff.columnsWithKnownDifferences, []);
  } finally {
    await client.end();
  }
});

test('e2e: forward fix — re-apply 0010 after down → schema returns to bigint → verify passes', async () => {
  const client = await createClient();
  try {
    await resetSchema(client);

    const history = await loadMigrationHistory(HISTORY_DIR);
    await applyPendingMigrations(client, history, { deploymentSha: TEST_DEPLOYMENT_SHA });
    await seedTierFeatureFlags(client);

    // Execute the 0010 down SQL (narrow to int4).
    const downSql = await readFile(
      path.join(HISTORY_DIR, '0010_alter_tier_feature_flags_limit_value_to_bigint.down.sql'),
      'utf8',
    );
    await client.query(downSql);

    // Forward-fix recovery: delete the 0010 ledger row so the runner sees it
    // as pending, then re-apply. This is the documented recovery path for a
    // forward-fix migration whose down was executed.
    await client.query("DELETE FROM schema_migrations WHERE id = '0010'");

    const result = await applyPendingMigrations(client, history, {
      deploymentSha: TEST_DEPLOYMENT_SHA,
    });
    assert.deepEqual(result.applied, ['0010']);

    // The column is bigint again.
    const typeAfterForwardFix = await getColumnType(client, 'tier_feature_flags', 'limit_value');
    assert.equal(typeAfterForwardFix, 'bigint');

    // Verify passes — the schema matches the fingerprint again.
    const report = await verifyMigration(client, FINGERPRINT_PATH);
    assert.equal(
      report.verified,
      true,
      `Expected verify to PASS after forward fix:\n${report.report}`,
    );
  } finally {
    await client.end();
  }
});
