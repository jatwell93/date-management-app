/**
 * Phase 1 task 1.4 — adoption command tests.
 *
 * Tests the adoption flow against pglite instances that simulate an existing
 * production-shaped database:
 *
 * - Dry-run on a matching database (catalog matches fingerprint) → canAdopt
 * - Dry-run does NOT create the schema_migrations table (read-only)
 * - Approved adoption on a matching database → ledger stamped
 * - Approved adoption stamps correct checksums
 * - Approved adoption requires explicit confirmation
 * - Wrong confirmation is rejected
 * - Dry-run on a mismatched database (only baseline applied) → refused
 * - One-time guard (ledger already populated) → refused
 * - Wrong column definition (object exists but is wrong) → refused
 * - Missing table → refused
 * - Missing CHECK constraint → refused (strict adoption profile)
 * - Missing partial index → refused (strict adoption profile)
 * - Invalid deployment SHA → rejected
 * - Approved adoption does not stamp if the catalog does not match
 * - Exact column exception tuple is accepted
 *
 * The "existing database" is simulated by applying migration SQL files
 * directly to pglite (via pg.exec) WITHOUT going through the runner, so no
 * schema_migrations ledger is created — exactly like a pre-adoption production
 * database shaped by prisma db push + neon-sql deltas.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  adoptExitCode,
  isAdoptionModeMutating,
  performAdoption,
  selectAdoptionTarget,
  type AdoptionColumnException,
  type AdoptionReport,
} from './adopt';
import { assertTargetKind } from './target';
import { applyPendingMigrations, loadMigrationHistory, type MigrationClient } from './runner';

test('adoptExitCode returns 0 only for STATUS: READY (canAdopt true), regardless of mode', () => {
  // Regression for the real Neon migration-role-check finding: the
  // adopt CLI previously exited 0 on a --dry-run refusal (catalog
  // mismatch or populated ledger), treating dry-run refusals as
  // "informational". That let a refused dry-run pass a CI/operator gate
  // silently. The exit code must be non-zero for EVERY refusal and 0
  // ONLY when canAdopt is true (STATUS: READY) — for both dry-run and
  // apply modes.
  const ready: AdoptionReport = {
    canAdopt: true,
    adoptionPoint: '0009',
    wouldStamp: ['0000'],
    ledgerAlreadyPopulated: false,
    diff: { matches: true } as AdoptionReport['diff'],
    report: 'STATUS: READY',
  };
  const catalogMismatch: AdoptionReport = {
    canAdopt: false,
    adoptionPoint: '0009',
    wouldStamp: [],
    ledgerAlreadyPopulated: false,
    diff: { matches: false } as AdoptionReport['diff'],
    report: 'STATUS: REFUSED — catalog does not match',
  };
  const ledgerPopulated: AdoptionReport = {
    canAdopt: false,
    adoptionPoint: '0009',
    wouldStamp: [],
    ledgerAlreadyPopulated: true,
    diff: { matches: true } as AdoptionReport['diff'],
    report: 'STATUS: REFUSED — ledger already populated',
  };

  assert.equal(adoptExitCode(ready), 0, 'READY must exit 0');
  assert.equal(
    adoptExitCode(catalogMismatch),
    1,
    'catalog mismatch must exit non-zero even in dry-run',
  );
  assert.equal(
    adoptExitCode(ledgerPopulated),
    1,
    'populated ledger must exit non-zero even in dry-run',
  );
});

test('adoption target guard treats dry-run as read-only and apply as mutating', () => {
  assert.equal(isAdoptionModeMutating('dry-run'), false);
  assert.equal(isAdoptionModeMutating('apply'), true);

  assert.equal(
    assertTargetKind({
      targetKind: 'development',
      mutating: isAdoptionModeMutating('dry-run'),
    }),
    'development',
  );
  assert.equal(
    assertTargetKind({
      targetKind: 'restore-drill',
      mutating: isAdoptionModeMutating('dry-run'),
    }),
    'restore-drill',
  );
  assert.throws(
    () =>
      assertTargetKind({
        targetKind: 'development',
        mutating: isAdoptionModeMutating('apply'),
      }),
    /only "primary" is allowed/,
  );
  assert.throws(
    () =>
      assertTargetKind({
        targetKind: 'restore-drill',
        mutating: isAdoptionModeMutating('apply'),
      }),
    /only "primary" is allowed/,
  );
  assert.equal(
    assertTargetKind({
      targetKind: 'primary',
      mutating: isAdoptionModeMutating('apply'),
    }),
    'primary',
  );
});

const TEST_DEPLOYMENT_SHA = 'a'.repeat(40);
const HISTORY_DIR = path.resolve('database/migrations');
const FINGERPRINT_PATH = path.resolve('database/migrations/catalog-fingerprint.json');
const FINGERPRINT_0009_PATH = path.resolve('database/migrations/catalog-fingerprint.0009.json');

// ---------------------------------------------------------------------------
// pglite adapter (same pattern as baseline.fingerprint.test.ts)
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
      // Non-SELECT statements (SET, BEGIN, COMMIT, ROLLBACK, CREATE TABLE, etc.)
      // go through pg.exec which handles multi-statement DDL and session commands.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Apply all migration .up.sql files directly to pglite (via pg.exec) WITHOUT
 * going through the runner. This simulates a pre-adoption production database:
 * the schema exists but no schema_migrations ledger has been created.
 */
async function applyMigrationsDirectly(pg: PgliteInstance): Promise<void> {
  const history = await loadMigrationHistory(HISTORY_DIR);
  for (const migration of history) {
    const sqlPath = path.join(HISTORY_DIR, migration.forward);
    const sql = await readFile(sqlPath, 'utf8');
    await pg.exec(sql);
  }
}

/**
 * Apply only the first N migrations directly to pglite.
 */
async function applyMigrationsDirectlyUpTo(pg: PgliteInstance, count: number): Promise<void> {
  const history = await loadMigrationHistory(HISTORY_DIR);
  for (let i = 0; i < count && i < history.length; i++) {
    const sqlPath = path.join(HISTORY_DIR, history[i].forward);
    const sql = await readFile(sqlPath, 'utf8');
    await pg.exec(sql);
  }
}

async function queryLedger(pg: PgliteInstance): Promise<Array<{ id: string; state: string }>> {
  const result = await pg.query('SELECT id, state FROM schema_migrations ORDER BY id');
  return result.rows as Array<{ id: string; state: string }>;
}

async function ledgerTableExists(pg: PgliteInstance): Promise<boolean> {
  const result = await pg.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'schema_migrations'`,
  );
  return result.rows.length > 0;
}

/** Common options for dry-run adoption tests. */
function dryRunOptions() {
  return {
    deploymentSha: TEST_DEPLOYMENT_SHA,
    mode: 'dry-run' as const,
    fingerprintPath: FINGERPRINT_PATH,
  };
}

/** Common options for apply-mode adoption tests with valid confirmation. */
function applyOptions() {
  return {
    deploymentSha: TEST_DEPLOYMENT_SHA,
    mode: 'apply' as const,
    fingerprintPath: FINGERPRINT_PATH,
    adoptionConfirmation: 'ADOPT test-host/test-db AT 0011',
    targetHost: 'test-host',
    targetDatabase: 'test-db',
  };
}

// ---------------------------------------------------------------------------
// Tests: dry-run (read-only)
// ---------------------------------------------------------------------------

test('dry-run adoption on a matching database reports canAdopt', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyMigrationsDirectly(pg);

    const history = await loadMigrationHistory(HISTORY_DIR);
    const report = await performAdoption(client, history, dryRunOptions());

    assert.equal(report.canAdopt, true);
    assert.equal(report.ledgerAlreadyPopulated, false);
    assert.equal(report.adoptionPoint, '0011');
    assert.deepEqual(
      report.wouldStamp,
      history.map(({ id }) => id),
    );
    assert.match(report.report, /READY/);
  } finally {
    await pg.close();
  }
});

test('dry-run does NOT create the schema_migrations table (read-only)', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyMigrationsDirectly(pg);

    // Verify the ledger table does NOT exist before dry-run.
    assert.equal(await ledgerTableExists(pg), false);

    const history = await loadMigrationHistory(HISTORY_DIR);
    await performAdoption(client, history, dryRunOptions());

    // Verify the ledger table STILL does NOT exist after dry-run.
    assert.equal(await ledgerTableExists(pg), false);
  } finally {
    await pg.close();
  }
});

test('dry-run on a partial database (only baseline) refuses with mismatches', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyMigrationsDirectlyUpTo(pg, 1);

    const history = await loadMigrationHistory(HISTORY_DIR);
    const report = await performAdoption(client, history, dryRunOptions());

    assert.equal(report.canAdopt, false);
    assert.equal(report.ledgerAlreadyPopulated, false);
    assert.equal(report.diff.matches, false);
    assert.ok(report.diff.tablesOnlyInExpected.length > 0, 'Expected missing tables in the diff');
    assert.match(report.report, /REFUSED/);

    // Dry-run must not have created the ledger.
    assert.equal(await ledgerTableExists(pg), false);
  } finally {
    await pg.close();
  }
});

test('a pre-0010 database can adopt through 0009 before applying 0010', async () => {
  const { pg, client } = await createPglite();
  try {
    const history = await loadMigrationHistory(HISTORY_DIR);
    const historyThrough0009 = history.slice(
      0,
      history.findIndex((migration) => migration.id === '0009') + 1,
    );
    await applyMigrationsDirectlyUpTo(pg, historyThrough0009.length);

    const report = await performAdoption(client, historyThrough0009, {
      ...dryRunOptions(),
      fingerprintPath: FINGERPRINT_0009_PATH,
    });

    assert.equal(report.canAdopt, true);
    assert.equal(report.adoptionPoint, '0009');
    assert.deepEqual(
      report.wouldStamp,
      historyThrough0009.map((migration) => migration.id),
    );
  } finally {
    await pg.close();
  }
});

test('selectAdoptionTarget selects the requested history prefix and historical fingerprint', async () => {
  const history = await loadMigrationHistory(HISTORY_DIR);
  const target = selectAdoptionTarget(history, HISTORY_DIR, '0009');

  assert.deepEqual(
    target.history.map((migration) => migration.id),
    history
      .slice(0, history.findIndex((migration) => migration.id === '0009') + 1)
      .map((migration) => migration.id),
  );
  assert.equal(target.fingerprintPath, FINGERPRINT_0009_PATH);
});

// ---------------------------------------------------------------------------
// Tests: apply (approved stamping)
// ---------------------------------------------------------------------------

test('approved adoption on a matching database stamps the ledger', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyMigrationsDirectly(pg);

    const history = await loadMigrationHistory(HISTORY_DIR);
    const report = await performAdoption(client, history, applyOptions());

    assert.equal(report.canAdopt, true);

    const ledgerRows = await queryLedger(pg);
    assert.equal(ledgerRows.length, history.length);
    for (let i = 0; i < history.length; i++) {
      assert.equal(ledgerRows[i].id, history[i].id);
      assert.equal(ledgerRows[i].state, 'applied');
    }
  } finally {
    await pg.close();
  }
});

test('approved adoption stamps correct checksums that match the runner', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyMigrationsDirectly(pg);

    const history = await loadMigrationHistory(HISTORY_DIR);
    await performAdoption(client, history, applyOptions());

    const result = await pg.query('SELECT id, checksum FROM schema_migrations ORDER BY id');
    const rows = result.rows as Array<{ id: string; checksum: string }>;
    for (let i = 0; i < history.length; i++) {
      assert.equal(rows[i].id, history[i].id);
      assert.equal(rows[i].checksum, history[i].checksum);
    }
  } finally {
    await pg.close();
  }
});

test('approved adoption requires explicit confirmation', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyMigrationsDirectly(pg);

    const history = await loadMigrationHistory(HISTORY_DIR);
    // Missing confirmation → rejected.
    await assert.rejects(
      performAdoption(client, history, {
        deploymentSha: TEST_DEPLOYMENT_SHA,
        mode: 'apply',
        fingerprintPath: FINGERPRINT_PATH,
        targetHost: 'test-host',
        targetDatabase: 'test-db',
      }),
      /Explicit adoption confirmation is required/,
    );

    // Missing target host/database → rejected.
    await assert.rejects(
      performAdoption(client, history, {
        deploymentSha: TEST_DEPLOYMENT_SHA,
        mode: 'apply',
        fingerprintPath: FINGERPRINT_PATH,
        adoptionConfirmation: 'ADOPT test-host/test-db AT 0011',
      }),
      /requires targetHost and targetDatabase/,
    );
  } finally {
    await pg.close();
  }
});

test('wrong adoption confirmation is rejected', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyMigrationsDirectly(pg);

    const history = await loadMigrationHistory(HISTORY_DIR);
    await assert.rejects(
      performAdoption(client, history, {
        deploymentSha: TEST_DEPLOYMENT_SHA,
        mode: 'apply',
        fingerprintPath: FINGERPRINT_PATH,
        adoptionConfirmation: 'ADOPT wrong-host/wrong-db AT 0011',
        targetHost: 'test-host',
        targetDatabase: 'test-db',
      }),
      /Explicit adoption confirmation is required/,
    );

    // Wrong migration ID in confirmation → rejected.
    await assert.rejects(
      performAdoption(client, history, {
        deploymentSha: TEST_DEPLOYMENT_SHA,
        mode: 'apply',
        fingerprintPath: FINGERPRINT_PATH,
        adoptionConfirmation: 'ADOPT test-host/test-db AT 0008',
        targetHost: 'test-host',
        targetDatabase: 'test-db',
      }),
      /Explicit adoption confirmation is required/,
    );
  } finally {
    await pg.close();
  }
});

test('approved adoption does not stamp if the catalog does not match', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyMigrationsDirectlyUpTo(pg, 1);

    const history = await loadMigrationHistory(HISTORY_DIR);
    const report = await performAdoption(client, history, applyOptions());

    assert.equal(report.canAdopt, false);

    // Verify the ledger was NOT stamped (table may not even exist).
    const exists = await ledgerTableExists(pg);
    if (exists) {
      const ledgerRows = await queryLedger(pg);
      assert.equal(ledgerRows.length, 0);
    }
  } finally {
    await pg.close();
  }
});

// ---------------------------------------------------------------------------
// Tests: one-time guard
// ---------------------------------------------------------------------------

test('adoption refuses if the ledger is already populated (one-time guard)', async () => {
  const { pg, client } = await createPglite();
  try {
    // Apply migrations through the runner — this creates the ledger with rows.
    const history = await loadMigrationHistory(HISTORY_DIR);
    await applyPendingMigrations(client, history, { deploymentSha: TEST_DEPLOYMENT_SHA });

    const report = await performAdoption(client, history, dryRunOptions());

    assert.equal(report.canAdopt, false);
    assert.equal(report.ledgerAlreadyPopulated, true);
    assert.equal(report.wouldStamp.length, 0);
    // diff.matches is true because no catalog comparison was performed — the
    // refusal reason is the populated ledger, not a catalog mismatch.
    assert.equal(report.diff.matches, true);
    assert.match(report.report, /REFUSED/);
    assert.match(report.report, /ledger already populated/);
  } finally {
    await pg.close();
  }
});

// ---------------------------------------------------------------------------
// Tests: strict adoption profile (CHECK/UNIQUE/indexes required)
// ---------------------------------------------------------------------------

test('adoption refuses when an object exists but has the wrong definition', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyMigrationsDirectly(pg);
    // Add an unexpected column that is not in the fingerprint.
    await pg.exec('ALTER TABLE organizations ADD COLUMN adoption_test_extra text');

    const history = await loadMigrationHistory(HISTORY_DIR);
    const report = await performAdoption(client, history, dryRunOptions());

    assert.equal(report.canAdopt, false);
    assert.equal(report.diff.matches, false);
    assert.ok(
      report.diff.columnsOnlyInActual.length > 0,
      'Expected the extra column to appear in the diff',
    );
    assert.match(report.report, /REFUSED/);
  } finally {
    await pg.close();
  }
});

test('adoption refuses when a table is missing from the existing database', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyMigrationsDirectly(pg);
    await pg.exec('DROP TABLE IF EXISTS suppliers CASCADE');

    const history = await loadMigrationHistory(HISTORY_DIR);
    const report = await performAdoption(client, history, dryRunOptions());

    assert.equal(report.canAdopt, false);
    assert.equal(report.diff.matches, false);
    assert.ok(
      report.diff.tablesOnlyInExpected.length > 0,
      'Expected the missing table to appear in the diff',
    );
  } finally {
    await pg.close();
  }
});

test('adoption refuses when a CHECK constraint is missing (strict profile)', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyMigrationsDirectly(pg);
    // Drop a CHECK constraint that the migrations created.
    // suppliers has a credit_type_check constraint from the baseline.
    await pg.exec('ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_credit_type_check');

    const history = await loadMigrationHistory(HISTORY_DIR);
    const report = await performAdoption(client, history, dryRunOptions());

    assert.equal(report.canAdopt, false);
    assert.equal(report.diff.matches, false);
    // The strict adoption profile includes CHECK constraints in the mismatch check.
    assert.ok(
      report.diff.checkConstraintsOnlyInExpected.length > 0,
      'Expected the missing CHECK constraint to appear in the diff',
    );
  } finally {
    await pg.close();
  }
});

test('adoption refuses when a migration-owned partial index is missing (strict profile)', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyMigrationsDirectly(pg);
    // Drop a migration-owned partial index (0001: one active catalogue import per org).
    await pg.exec('DROP INDEX IF EXISTS uploads_one_active_catalogue_per_org');

    const history = await loadMigrationHistory(HISTORY_DIR);
    const report = await performAdoption(client, history, dryRunOptions());

    assert.equal(report.canAdopt, false);
    assert.equal(report.diff.matches, false);
    // The strict adoption profile requires all migration-owned indexes.
    assert.ok(
      report.diff.indexesOnlyInExpected.length > 0,
      'Expected the missing partial index to appear in the diff',
    );
  } finally {
    await pg.close();
  }
});

// ---------------------------------------------------------------------------
// Tests: validation
// ---------------------------------------------------------------------------

test('adoption rejects an invalid deployment SHA', async () => {
  const { pg, client } = await createPglite();
  try {
    const history = await loadMigrationHistory(HISTORY_DIR);
    await assert.rejects(
      performAdoption(client, history, {
        ...dryRunOptions(),
        deploymentSha: 'not-a-sha',
      }),
      /valid Git commit SHA/,
    );
  } finally {
    await pg.close();
  }
});

test('adoption rejects an empty migration history', async () => {
  const { pg, client } = await createPglite();
  try {
    await assert.rejects(
      performAdoption(client, [], dryRunOptions()),
      /Migration history is empty/,
    );
  } finally {
    await pg.close();
  }
});

// ---------------------------------------------------------------------------
// Tests: exact column exceptions
// ---------------------------------------------------------------------------

test('exact column exception tuple is accepted in adoption', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyMigrationsDirectly(pg);
    // Drop the default on brands.source to create a real difference.
    // brands.source has DEFAULT 'REFERENCE'::text in the fingerprint.
    await pg.exec('ALTER TABLE brands ALTER COLUMN source DROP DEFAULT');

    const history = await loadMigrationHistory(HISTORY_DIR);

    // First, verify that without an exception, the adoption refuses.
    const reportWithoutException = await performAdoption(client, history, dryRunOptions());
    assert.equal(reportWithoutException.canAdopt, false);

    // Find the expected default from the fingerprint.
    const fingerprint = JSON.parse(await readFile(FINGERPRINT_PATH, 'utf8')) as {
      columns: Array<{
        table: string;
        name: string;
        type: string;
        not_null: boolean;
        default: string | null;
      }>;
    };
    const brandsSource = fingerprint.columns.find(
      (c) => c.table === 'brands' && c.name === 'source',
    );
    assert.ok(brandsSource, 'brands.source must be in the fingerprint');
    assert.ok(brandsSource.default, 'brands.source must have a default in the fingerprint');

    const exception: AdoptionColumnException = {
      table: 'brands',
      column: 'source',
      expectedType: brandsSource.type,
      actualType: brandsSource.type,
      expectedNotNull: brandsSource.not_null,
      actualNotNull: brandsSource.not_null,
      expectedDefault: brandsSource.default,
      actualDefault: null,
    };

    const reportWithException = await performAdoption(client, history, {
      ...dryRunOptions(),
      columnExceptions: [exception],
    });

    assert.equal(reportWithException.canAdopt, true);
    assert.equal(reportWithException.diff.matches, true);
    assert.ok(
      reportWithException.diff.columnsWithKnownDifferences.length > 0,
      'Expected the known difference to be listed',
    );
  } finally {
    await pg.close();
  }
});
