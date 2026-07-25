/**
 * Phase 1 task 1.5 — idempotent reference-data seed.
 *
 * Replaces the backend-owned `seed-tier-flags.js` (Prisma-based) with a
 * Prisma-independent raw-SQL upsert of the required 48-row `tier_feature_flags`
 * reference set: eight feature keys for each of the six current and transitional
 * tiers validated by backend startup health checks.
 *
 * Idempotent: `INSERT ... ON CONFLICT (tier_level, feature_key) DO UPDATE` so
 * re-running after a migration converges the reference set to the declared
 * values without duplicating rows. After upserting, the seed verifies the row
 * count is exactly 20 and every row matches the declared value, then reports.
 *
 * Uses the same advisory lock as the migration runner so a seed cannot race a
 * concurrent apply. Mutating: requires a primary target and explicit production
 * confirmation (`MIGRATION_SEED_CONFIRMATION`) when run against production.
 */
import {
  configureSession,
  MIGRATION_LOCK_KEY,
  MIGRATION_LOCK_NAMESPACE,
  MigrationExecutionError,
  type MigrationClient,
} from './runner';

export interface TierFeatureFlag {
  tierLevel: string;
  featureKey: string;
  enabled: boolean;
  limitValue: number | null;
}

/**
 * The authoritative 48-row reference set. This is the single source of truth
 * for tier feature flags in the Postgres migration path; the backend-owned
 * Prisma seed is retired with the backend.
 */
export const TIER_FEATURE_FLAGS: readonly TierFeatureFlag[] = (() => {
  const tiers = [
    ['free', 500, 1, 500],
    ['starter', 5_000, 3, 5_000],
    ['professional', 50_000, 10, 50_000],
    ['enterprise', 250_000, 10, 250_000],
    ['premium', 50_000, 10, 50_000],
    ['concierge', 250_000, 10, 250_000],
  ] as const;
  const unlimitedFeatures = [
    'advanced_analytics',
    'api_access',
    'priority_support',
    'dedicated_support',
    'custom_integrations',
  ] as const;

  return tiers.flatMap(([tierLevel, maxSkus, maxUsers, maxInventoryItems]) => [
    { tierLevel, featureKey: 'max_skus', enabled: true, limitValue: maxSkus },
    { tierLevel, featureKey: 'max_users', enabled: true, limitValue: maxUsers },
    {
      tierLevel,
      featureKey: 'max_inventory_items',
      enabled: true,
      limitValue: maxInventoryItems,
    },
    ...unlimitedFeatures.map((featureKey) => ({
      tierLevel,
      featureKey,
      enabled: tierLevel !== 'free',
      limitValue: null,
    })),
  ]);
})();

export function tierLimitValuesEqual(actual: unknown, expected: number | null): boolean {
  if (actual === null || expected === null) return actual === expected;
  if (typeof actual === 'number') return actual === expected;
  if (typeof actual !== 'string' || !/^-?\d+$/.test(actual)) return false;
  return BigInt(actual) === BigInt(expected);
}

export interface SeedReport {
  upserted: number;
  verified: boolean;
  rowCount: number;
  mismatches: string[];
  report: string;
}

interface FlagRow {
  tier_level: string;
  feature_key: string;
  enabled: boolean;
  limit_value: string | number | null;
}

export async function seedTierFeatureFlags(client: MigrationClient): Promise<SeedReport> {
  await configureSession(client);

  const lockResult = await client.query('SELECT pg_try_advisory_lock($1, $2) AS acquired', [
    MIGRATION_LOCK_NAMESPACE,
    MIGRATION_LOCK_KEY,
  ]);
  const lockRow = lockResult.rows[0] as { acquired?: boolean } | undefined;
  if (lockRow?.acquired !== true) {
    throw new Error('Refusing to seed because another migration process holds the advisory lock');
  }

  let primaryError: unknown;
  let report: SeedReport | undefined;
  try {
    await client.query('BEGIN');
    for (const flag of TIER_FEATURE_FLAGS) {
      await client.query(
        `INSERT INTO tier_feature_flags (tier_level, feature_key, enabled, limit_value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tier_level, feature_key)
         DO UPDATE SET enabled = EXCLUDED.enabled, limit_value = EXCLUDED.limit_value`,
        [flag.tierLevel, flag.featureKey, flag.enabled, flag.limitValue],
      );
    }
    await client.query('COMMIT');

    // Verification: exactly 48 rows, each matching the declared value.
    const rows = await client.query(
      `SELECT tier_level, feature_key, enabled, limit_value
       FROM tier_feature_flags
       ORDER BY tier_level, feature_key`,
    );
    const actual = rows.rows as FlagRow[];
    const mismatches: string[] = [];
    const expectedByKey = new Map(
      TIER_FEATURE_FLAGS.map((flag) => [`${flag.tierLevel}/${flag.featureKey}`, flag]),
    );
    for (const row of actual) {
      const expected = expectedByKey.get(`${row.tier_level}/${row.feature_key}`);
      if (!expected) {
        mismatches.push(`unexpected row ${row.tier_level}/${row.feature_key}`);
        continue;
      }
      if (row.enabled !== expected.enabled) {
        mismatches.push(
          `${row.tier_level}/${row.feature_key} enabled=${row.enabled} expected ${expected.enabled}`,
        );
      }
      if (!tierLimitValuesEqual(row.limit_value, expected.limitValue)) {
        mismatches.push(
          `${row.tier_level}/${row.feature_key} limit_value=${row.limit_value} expected ${expected.limitValue}`,
        );
      }
    }
    if (actual.length !== TIER_FEATURE_FLAGS.length) {
      mismatches.push(`row count ${actual.length} expected ${TIER_FEATURE_FLAGS.length}`);
    }

    const verified = mismatches.length === 0;
    report = {
      upserted: TIER_FEATURE_FLAGS.length,
      verified,
      rowCount: actual.length,
      mismatches,
      report: formatSeedReport({
        upserted: TIER_FEATURE_FLAGS.length,
        verified,
        rowCount: actual.length,
        mismatches,
      }),
    };
  } catch (error) {
    primaryError = error;
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new MigrationExecutionError('Seed failed and rollback also failed', [
        error,
        rollbackError,
      ]);
    }
  } finally {
    try {
      const unlockResult = await client.query('SELECT pg_advisory_unlock($1, $2) AS unlocked', [
        MIGRATION_LOCK_NAMESPACE,
        MIGRATION_LOCK_KEY,
      ]);
      const unlockRow = unlockResult.rows[0] as { unlocked?: boolean } | undefined;
      if (unlockRow?.unlocked !== true) {
        throw new Error('PostgreSQL advisory unlock failed');
      }
    } catch (unlockError) {
      const precedingErrors =
        primaryError instanceof MigrationExecutionError ? primaryError.errors : [primaryError];
      throw new MigrationExecutionError(
        primaryError === undefined
          ? 'Seed completed but advisory unlock failed'
          : 'Seed failed and advisory unlock also failed',
        [...precedingErrors.filter((error) => error !== undefined), unlockError],
      );
    }
  }

  if (primaryError !== undefined) throw primaryError;
  if (report === undefined) throw new Error('Seed command finished without a report');
  return report;
}

/**
 * Validates the seed-specific production confirmation token. Separate from
 * `MIGRATION_CONFIRM_PRODUCTION` so confirming the target is production does
 * not also authorize the reference-data write — mirroring adoption's separate
 * confirmation.
 */
export function validateSeedConfirmation(
  confirmation: string | undefined,
  host: string,
  database: string,
  environment: string | undefined,
): void {
  if (environment !== 'production') return;
  const expected = `SEED ${host}/${database}`;
  if (confirmation !== expected) {
    throw new Error(`Explicit seed confirmation is required for production: ${expected}`);
  }
}

function formatSeedReport(input: {
  upserted: number;
  verified: boolean;
  rowCount: number;
  mismatches: string[];
}): string {
  const lines: string[] = [];
  lines.push(`Reference-data seed (tier_feature_flags)`);
  lines.push(`  Upserted: ${input.upserted} row(s)`);
  lines.push(`  Row count after seed: ${input.rowCount}`);
  if (input.mismatches.length > 0) {
    lines.push(`  Mismatches:`);
    for (const mismatch of input.mismatches) lines.push(`    - ${mismatch}`);
  }
  lines.push(`  Verified: ${input.verified ? 'YES' : 'NO'}`);
  return lines.join('\n');
}
