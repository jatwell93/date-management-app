/**
 * Phase 1 task 1.5 — ordered migration commands tests.
 *
 * Covers the new status / preflight / seed / verify commands and the shared
 * target guards (role + target-kind) against pglite instances, mirroring the
 * adopt.test.ts adapter pattern. The core command functions do not perform the
 * role check themselves (that is a CLI-layer concern), so they are exercised
 * directly; `verifyMigrationRole` is tested separately against a pglite
 * session whose `current_user` is `postgres`.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  applyPendingMigrations,
  loadMigrationHistory,
  MigrationExecutionError,
  type MigrationClient,
} from './runner';
import { assertTargetKind, verifyMigrationRole, type TargetKind } from './target';
import { getMigrationStatus } from './status';
import { runPreflight } from './preflight';
import { seedTierFeatureFlags, TIER_FEATURE_FLAGS, validateSeedConfirmation } from './seed';
import { verifyMigration } from './verify';

const TEST_DEPLOYMENT_SHA = 'a'.repeat(40);
const HISTORY_DIR = path.resolve('database/migrations');
const FINGERPRINT_PATH = path.resolve('database/migrations/catalog-fingerprint.json');

// ---------------------------------------------------------------------------
// pglite adapter (same pattern as adopt.test.ts)
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

function decodeBigintsAsStrings(client: MigrationClient): MigrationClient {
  return {
    async query(text: string, values?: readonly unknown[]) {
      const result = await client.query(text, values);
      if (!text.includes('FROM tier_feature_flags')) return result;
      return {
        rows: result.rows.map((value) => {
          const row = value as Record<string, unknown>;
          return {
            ...row,
            limit_value:
              typeof row.limit_value === 'number' ? String(row.limit_value) : row.limit_value,
          };
        }),
      };
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

async function applyAllMigrations(client: MigrationClient): Promise<void> {
  const history = await loadMigrationHistory(HISTORY_DIR);
  await applyPendingMigrations(client, history, { deploymentSha: TEST_DEPLOYMENT_SHA });
}

// ===========================================================================
// Tests: target guards (assertTargetKind — pure)
// ===========================================================================

test('assertTargetKind rejects a missing target kind', () => {
  assert.throws(
    () => assertTargetKind({ targetKind: undefined, mutating: false }),
    /MIGRATION_TARGET_KIND is required/,
  );
});

test('assertTargetKind rejects an invalid target kind', () => {
  assert.throws(
    () => assertTargetKind({ targetKind: 'production', mutating: false }),
    /must be one of/,
  );
});

test('assertTargetKind accepts primary for mutating commands', () => {
  assert.equal(assertTargetKind({ targetKind: 'primary', mutating: true }), 'primary');
});

test('assertTargetKind rejects development for mutating commands', () => {
  assert.throws(
    () => assertTargetKind({ targetKind: 'development', mutating: true }),
    /only "primary" is allowed for apply\/seed/,
  );
});

test('assertTargetKind rejects restore-drill for mutating commands', () => {
  assert.throws(
    () => assertTargetKind({ targetKind: 'restore-drill', mutating: true }),
    /only "primary" is allowed for apply\/seed/,
  );
});

test('assertTargetKind accepts development and restore-drill for read-only commands', () => {
  const dev = assertTargetKind({ targetKind: 'development', mutating: false }) as TargetKind;
  const restore = assertTargetKind({ targetKind: 'restore-drill', mutating: false }) as TargetKind;
  assert.equal(dev, 'development');
  assert.equal(restore, 'restore-drill');
});

// ===========================================================================
// Tests: target guards (verifyMigrationRole — async, against pglite)
// ===========================================================================

test('verifyMigrationRole returns the role when it matches current_user', async () => {
  const { pg, client } = await createPglite();
  try {
    const role = await verifyMigrationRole(client, 'postgres');
    assert.equal(role, 'postgres');
  } finally {
    await pg.close();
  }
});

test('verifyMigrationRole rejects when the role does not match current_user', async () => {
  const { pg, client } = await createPglite();
  try {
    await assert.rejects(verifyMigrationRole(client, 'migration_dedicated'), /does not match/);
  } finally {
    await pg.close();
  }
});

test('verifyMigrationRole rejects when no expected role is provided', async () => {
  const { pg, client } = await createPglite();
  try {
    await assert.rejects(verifyMigrationRole(client, undefined), /MIGRATION_ROLE is required/);
  } finally {
    await pg.close();
  }
});

// ===========================================================================
// Tests: status (read-only ledger state)
// ===========================================================================

test('status on a fresh database reports no ledger and all migrations pending', async () => {
  const { pg, client } = await createPglite();
  try {
    const report = await getMigrationStatus(client, HISTORY_DIR);
    assert.equal(report.ledgerExists, false);
    assert.equal(report.applied.length, 0);
    assert.equal(report.pending.length, report.historyCount);
    assert.equal(report.orphaned.length, 0);
    assert.match(report.report, /not initialized/);
  } finally {
    await pg.close();
  }
});

test('status on a fully migrated database reports all applied and no pending', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyAllMigrations(client);
    const report = await getMigrationStatus(client, HISTORY_DIR);
    assert.equal(report.ledgerExists, true);
    assert.equal(report.applied.length, report.historyCount);
    assert.equal(report.pending.length, 0);
    assert.equal(report.orphaned.length, 0);
    assert.equal(report.checksumDrift.length, 0);
    assert.equal(report.interrupted.length, 0);
    assert.equal(report.contiguousPrefix, true);
    assert.match(report.report, /Health: OK/);
  } finally {
    await pg.close();
  }
});

test('status reports pending migrations when only the baseline is applied', async () => {
  const { pg, client } = await createPglite();
  try {
    const history = await loadMigrationHistory(HISTORY_DIR);
    await applyPendingMigrations(client, history.slice(0, 1), {
      deploymentSha: TEST_DEPLOYMENT_SHA,
    });
    const report = await getMigrationStatus(client, HISTORY_DIR);
    assert.deepEqual(report.applied, ['0000']);
    assert.equal(report.pending.length, history.length - 1);
    assert.equal(report.pending[0], '0001');
  } finally {
    await pg.close();
  }
});

test('status reports checksum drift when a ledger checksum is corrupted', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyAllMigrations(client);
    await pg.exec(`UPDATE schema_migrations SET checksum = 'deadbeef' WHERE id = '0010'`);
    const report = await getMigrationStatus(client, HISTORY_DIR);
    assert.deepEqual(report.checksumDrift, ['0010']);
    assert.match(report.report, /Checksum drift/);
    assert.match(report.report, /ATTENTION REQUIRED/);
  } finally {
    await pg.close();
  }
});

// ===========================================================================
// Tests: preflight (read-only target/role/privilege/ledger checks)
// ===========================================================================

test('preflight is ready on a migrated database with the correct role', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyAllMigrations(client);
    const report = await runPreflight(client, 'postgres');
    assert.equal(report.connected, true);
    assert.equal(report.role, 'postgres');
    assert.equal(report.canCreateOnSchema, true);
    assert.equal(report.canCreateOnDatabase, true);
    assert.equal(report.writeProbeOk, true);
    assert.equal(report.ledgerExists, true);
    assert.equal(report.interrupted.length, 0);
    assert.equal(report.ready, true);
    assert.match(report.report, /Ready: YES/);
  } finally {
    await pg.close();
  }
});

test('preflight reports a not-initialized ledger on a fresh database', async () => {
  const { pg, client } = await createPglite();
  try {
    const report = await runPreflight(client, 'postgres');
    assert.equal(report.ledgerExists, false);
    assert.equal(report.ready, true);
    assert.match(report.report, /not initialized/);
  } finally {
    await pg.close();
  }
});

test('preflight reports interrupted migrations left in the applying state', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyAllMigrations(client);
    await pg.exec(`UPDATE schema_migrations SET state = 'applying' WHERE id = '0010'`);
    const report = await runPreflight(client, 'postgres');
    assert.deepEqual(report.interrupted, ['0010']);
    assert.equal(report.ready, false);
    assert.match(report.report, /Ready: NO/);
  } finally {
    await pg.close();
  }
});

// ===========================================================================
// Tests: seed (idempotent reference-data)
// ===========================================================================

test('seed declares all eight required features for all six tiers', () => {
  const requiredTiers = ['free', 'starter', 'professional', 'enterprise', 'premium', 'concierge'];
  const requiredFeatures = [
    'max_skus',
    'max_users',
    'max_inventory_items',
    'advanced_analytics',
    'api_access',
    'priority_support',
    'dedicated_support',
    'custom_integrations',
  ];

  assert.equal(TIER_FEATURE_FLAGS.length, 48);
  assert.deepEqual(
    new Set(TIER_FEATURE_FLAGS.map((flag) => flag.tierLevel)),
    new Set(requiredTiers),
  );
  for (const tier of requiredTiers) {
    assert.deepEqual(
      new Set(
        TIER_FEATURE_FLAGS.filter((flag) => flag.tierLevel === tier).map((flag) => flag.featureKey),
      ),
      new Set(requiredFeatures),
    );
  }
});

test('seed preserves seed, rollback, and advisory-unlock errors when all three fail', async () => {
  const seedError = new Error('seed failure');
  const rollbackError = new Error('rollback failure');
  const unlockError = new Error('unlock failure');
  const client: MigrationClient = {
    async query(sql: string) {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
      if (sql.startsWith('INSERT INTO tier_feature_flags')) throw seedError;
      if (sql === 'ROLLBACK') throw rollbackError;
      if (sql.includes('pg_advisory_unlock')) throw unlockError;
      return { rows: [] };
    },
  };

  await assert.rejects(
    seedTierFeatureFlags(client),
    (error: unknown) =>
      error instanceof MigrationExecutionError &&
      error.errors.length === 3 &&
      error.errors.includes(seedError) &&
      error.errors.includes(rollbackError) &&
      error.errors.includes(unlockError),
  );
});

test('seed upserts the 48 tier_feature_flags rows and verifies them', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyAllMigrations(client);
    const report = await seedTierFeatureFlags(client);
    assert.equal(report.upserted, TIER_FEATURE_FLAGS.length);
    assert.equal(report.rowCount, 48);
    assert.equal(report.verified, true);
    assert.equal(report.mismatches.length, 0);
    assert.match(report.report, /Verified: YES/);
  } finally {
    await pg.close();
  }
});

test('seed is idempotent — running twice leaves exactly 48 rows', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyAllMigrations(client);
    await seedTierFeatureFlags(client);
    const second = await seedTierFeatureFlags(client);
    assert.equal(second.rowCount, 48);
    assert.equal(second.verified, true);
    const countResult = await pg.query('SELECT COUNT(*)::int AS count FROM tier_feature_flags');
    assert.equal((countResult.rows[0] as { count: number }).count, 48);
  } finally {
    await pg.close();
  }
});

test('seed and verify accept node-postgres bigint string decoding', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyAllMigrations(client);
    const postgresClient = decodeBigintsAsStrings(client);
    const seedReport = await seedTierFeatureFlags(postgresClient);
    assert.equal(seedReport.verified, true);
    const verifyReport = await verifyMigration(postgresClient, FINGERPRINT_PATH);
    assert.equal(verifyReport.referenceDataOk, true);
  } finally {
    await pg.close();
  }
});

test('seed converges a pre-existing incorrect row to the declared value', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyAllMigrations(client);
    // Insert a wrong-value row that collides on the unique key.
    await pg.exec(
      `INSERT INTO tier_feature_flags (tier_level, feature_key, enabled, limit_value)
       VALUES ('starter', 'max_skus', false, 999)`,
    );
    const report = await seedTierFeatureFlags(client);
    assert.equal(report.verified, true);
    const row = await pg.query(
      `SELECT enabled, limit_value FROM tier_feature_flags
       WHERE tier_level = 'starter' AND feature_key = 'max_skus'`,
    );
    const r = row.rows[0] as { enabled: boolean; limit_value: number };
    assert.equal(r.enabled, true);
    assert.equal(r.limit_value, 5_000);
  } finally {
    await pg.close();
  }
});

// ===========================================================================
// Tests: validateSeedConfirmation (production gate)
// ===========================================================================

test('validateSeedConfirmation requires an explicit token for production', () => {
  assert.throws(
    () => validateSeedConfirmation(undefined, 'host', 'db', 'production'),
    /Explicit seed confirmation is required/,
  );
  assert.throws(
    () => validateSeedConfirmation('SEED wrong/db', 'host', 'db', 'production'),
    /Explicit seed confirmation is required/,
  );
  // Does not throw:
  validateSeedConfirmation('SEED host/db', 'host', 'db', 'production');
});

test('validateSeedConfirmation is a no-op for non-production environments', () => {
  validateSeedConfirmation(undefined, 'host', 'db', 'development');
  validateSeedConfirmation(undefined, 'host', 'db', 'test');
});

// ===========================================================================
// Tests: verify (schema + reference-data verification)
// ===========================================================================

test('verify passes on a migrated and seeded database', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyAllMigrations(client);
    await seedTierFeatureFlags(client);
    const report = await verifyMigration(client, FINGERPRINT_PATH);
    assert.equal(report.tablesOk, true);
    assert.equal(report.referenceDataOk, true);
    assert.equal(report.catalogOk, true);
    assert.equal(report.verified, true);
    assert.match(report.report, /Reference data \(tier_feature_flags\): OK \(48 rows\)/);
    assert.match(report.report, /Verdict: PASS/);
  } finally {
    await pg.close();
  }
});

test('verify fails when an expected table is missing', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyAllMigrations(client);
    await seedTierFeatureFlags(client);
    await pg.exec('DROP TABLE "organization_invites" CASCADE');
    const report = await verifyMigration(client, FINGERPRINT_PATH);
    assert.equal(report.tablesOk, false);
    assert.ok(report.missingTables.includes('organization_invites'));
    assert.equal(report.verified, false);
    assert.match(report.report, /Verdict: FAIL/);
  } finally {
    await pg.close();
  }
});

test('verify fails when the tier_feature_flags row count is wrong', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyAllMigrations(client);
    await seedTierFeatureFlags(client);
    await pg.exec(
      `DELETE FROM tier_feature_flags WHERE tier_level = 'starter' AND feature_key = 'max_skus'`,
    );
    const report = await verifyMigration(client, FINGERPRINT_PATH);
    assert.equal(report.referenceDataOk, false);
    assert.equal(report.verified, false);
    assert.match(report.report, /row count 47 expected 48/);
  } finally {
    await pg.close();
  }
});

test('verify fails when the catalog has drifted (dropped index)', async () => {
  const { pg, client } = await createPglite();
  try {
    await applyAllMigrations(client);
    await seedTierFeatureFlags(client);
    // Drop a non-constraint index that the fingerprint expects.
    await pg.exec('DROP INDEX "tier_feature_flags_tier_level_idx"');
    const report = await verifyMigration(client, FINGERPRINT_PATH);
    assert.equal(report.catalogOk, false);
    assert.equal(report.verified, false);
    assert.match(report.report, /Catalog vs fingerprint: DRIFT/);
  } finally {
    await pg.close();
  }
});
