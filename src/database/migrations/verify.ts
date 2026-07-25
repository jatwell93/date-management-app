/**
 * Phase 1 task 1.5 — schema and reference-data verification.
 *
 * Replaces the backend-owned `verify-migration.js` (count-only) and the
 * `migrate-production.ts` named-table + exact-reference-count assertions with
 * a fail-closed post-migration verification that:
 *
 *   1. confirms every expected table (from the checked-in catalog fingerprint)
 *      exists in the `public` schema;
 *   2. verifies the `tier_feature_flags` reference set is exactly 48 rows and
 *      every row matches the declared value (reuses the seed's source of
 *      truth so seed and verify cannot drift);
 *   3. structurally compares the live catalog against the checked-in
 *      `catalog-fingerprint.json` using the strict ADOPTION_COMPARISON profile
 *      (the same comparison adoption uses), so any column/index/constraint/
 *      function/trigger drift fails verification.
 *
 * Read-only: no advisory lock, no writes. Reports a single PASS/FAIL verdict
 * with the specific failures.
 */
import { readFile } from 'node:fs/promises';

import {
  ADOPTION_COMPARISON,
  compareCatalogs,
  computeStructuralKeys,
  formatCatalogDiff,
  type CatalogDiff,
  type CatalogStructuralKeys,
} from './catalog-comparison';
import {
  introspectCatalog,
  normalizeCatalog,
  type NormalizedCatalog,
  type QueryClient,
} from './catalog-introspection';
import { tierLimitValuesEqual, TIER_FEATURE_FLAGS } from './seed';
import type { MigrationClient } from './runner';

export interface VerifyReport {
  /** All expected tables were present. */
  tablesOk: boolean;
  /** Missing table names (empty when tablesOk is true). */
  missingTables: string[];
  /** Reference-data set exactly matches the declared 20 rows. */
  referenceDataOk: boolean;
  /** Reference-data mismatch descriptions (empty when referenceDataOk is true). */
  referenceDataMismatches: string[];
  /** Catalog structural comparison matches the fingerprint. */
  catalogOk: boolean;
  /** Catalog diff (empty/summary when catalogOk is true). */
  catalogDiff: CatalogDiff | null;
  /** Overall verdict. */
  verified: boolean;
  /** Human-readable report. */
  report: string;
}

interface FlagRow {
  tier_level: string;
  feature_key: string;
  enabled: boolean;
  limit_value: string | number | null;
}

async function loadExpectedCatalog(fingerprintPath: string): Promise<CatalogStructuralKeys> {
  const json = await readFile(fingerprintPath, 'utf8');
  const normalized = JSON.parse(json) as NormalizedCatalog;
  return computeStructuralKeys(normalized);
}

async function introspectActual(client: MigrationClient): Promise<CatalogStructuralKeys> {
  const queryClient: QueryClient = client;
  const catalog = await introspectCatalog(queryClient);
  const normalized = normalizeCatalog(catalog);
  return computeStructuralKeys(normalized);
}

export async function verifyMigration(
  client: MigrationClient,
  fingerprintPath: string,
): Promise<VerifyReport> {
  // 1. Expected tables from the fingerprint.
  const fingerprintJson = JSON.parse(await readFile(fingerprintPath, 'utf8')) as NormalizedCatalog;
  const expectedTables = fingerprintJson.tables as readonly string[];
  const tableRows = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' ORDER BY table_name`,
  );
  const actualTables = new Set(
    (tableRows.rows as { table_name?: string }[])
      .map((row) => row.table_name)
      .filter((name): name is string => typeof name === 'string'),
  );
  const missingTables = expectedTables.filter((name) => !actualTables.has(name));
  const tablesOk = missingTables.length === 0;

  // 2. Reference data: tier_feature_flags must be exactly the declared 48 rows.
  const flagRows = await client.query(
    `SELECT tier_level, feature_key, enabled, limit_value
     FROM tier_feature_flags
     ORDER BY tier_level, feature_key`,
  );
  const actualFlags = flagRows.rows as FlagRow[];
  const referenceDataMismatches: string[] = [];
  const expectedByKey = new Map(
    TIER_FEATURE_FLAGS.map((flag) => [`${flag.tierLevel}/${flag.featureKey}`, flag]),
  );
  for (const row of actualFlags) {
    const expected = expectedByKey.get(`${row.tier_level}/${row.feature_key}`);
    if (!expected) {
      referenceDataMismatches.push(`unexpected row ${row.tier_level}/${row.feature_key}`);
      continue;
    }
    if (row.enabled !== expected.enabled) {
      referenceDataMismatches.push(
        `${row.tier_level}/${row.feature_key} enabled=${row.enabled} expected ${expected.enabled}`,
      );
    }
    if (!tierLimitValuesEqual(row.limit_value, expected.limitValue)) {
      referenceDataMismatches.push(
        `${row.tier_level}/${row.feature_key} limit_value=${row.limit_value} expected ${expected.limitValue}`,
      );
    }
  }
  if (actualFlags.length !== TIER_FEATURE_FLAGS.length) {
    referenceDataMismatches.push(
      `row count ${actualFlags.length} expected ${TIER_FEATURE_FLAGS.length}`,
    );
  }
  const referenceDataOk = referenceDataMismatches.length === 0;

  // 3. Catalog structural comparison against the fingerprint (strict profile).
  const expectedKeys = await loadExpectedCatalog(fingerprintPath);
  const actualKeys = await introspectActual(client);
  const diff = compareCatalogs(expectedKeys, actualKeys, ADOPTION_COMPARISON);
  const catalogOk = diff.matches;
  const catalogDiff = catalogOk ? null : diff;

  const verified = tablesOk && referenceDataOk && catalogOk;
  const report = formatVerifyReport({
    tablesOk,
    missingTables,
    referenceDataOk,
    referenceDataMismatches,
    catalogOk,
    catalogDiff,
    verified,
  });

  return {
    tablesOk,
    missingTables,
    referenceDataOk,
    referenceDataMismatches,
    catalogOk,
    catalogDiff,
    verified,
    report,
  };
}

function formatVerifyReport(input: {
  tablesOk: boolean;
  missingTables: string[];
  referenceDataOk: boolean;
  referenceDataMismatches: string[];
  catalogOk: boolean;
  catalogDiff: CatalogDiff | null;
  verified: boolean;
}): string {
  const lines: string[] = [];
  lines.push(`Migration verification`);
  lines.push(`  Tables: ${input.tablesOk ? 'OK' : 'MISSING ' + input.missingTables.join(', ')}`);
  lines.push(
    `  Reference data (tier_feature_flags): ${input.referenceDataOk ? 'OK (20 rows)' : 'MISMATCH'}`,
  );
  if (input.referenceDataMismatches.length > 0) {
    for (const mismatch of input.referenceDataMismatches) lines.push(`    - ${mismatch}`);
  }
  lines.push(`  Catalog vs fingerprint: ${input.catalogOk ? 'OK' : 'DRIFT'}`);
  if (input.catalogDiff) {
    lines.push(formatCatalogDiff(input.catalogDiff));
  }
  lines.push(`  Verdict: ${input.verified ? 'PASS' : 'FAIL'}`);
  return lines.join('\n');
}
