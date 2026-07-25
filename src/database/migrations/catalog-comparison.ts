/**
 * Shared catalog comparison logic for structural schema comparison.
 *
 * Used by both the baseline fingerprint test (cross-comparison layers) and
 * the adoption command (catalog verification against the checked-in fingerprint).
 *
 * Two comparison profiles:
 * - **test**: used by the fingerprint test's cross-comparison against the
 *   Prisma-generated schema. Applies broad exception rules (any `updated_at`
 *   default difference, any timestamptz/timestamp(3) difference), filters
 *   migration-only partial indexes and Prisma-only known indexes, and excludes
 *   CHECK/UNIQUE constraints from the main comparison (Prisma cannot express
 *   them; they are verified separately by counting).
 * - **adoption**: used by the adoption command against an existing production
 *   database. Uses strict comparison — all migration-owned indexes and
 *   CHECK/UNIQUE constraints are required, and column exceptions must be
 *   exact table/column/expected/actual tuples. Broad Prisma-comparison rules
 *   do NOT apply to adoption.
 */
import {
  columnStructuralKey,
  constraintStructuralKey,
  functionStructuralKey,
  indexStructuralKey,
  setDifference,
  triggerStructuralKey,
  type NormalizedCatalog,
} from './catalog-introspection';

// ---------------------------------------------------------------------------
// Structural keys
// ---------------------------------------------------------------------------

/**
 * Structural keys for a normalized catalog, excluding:
 * - NOT NULL constraints (contype 'n'): redundant with column nullability.
 * - The runner-owned `schema_migrations` table.
 *
 * CHECK and UNIQUE constraints are separated into their own arrays so the
 * comparison profile can decide whether to include them.
 */
export interface CatalogStructuralKeys {
  tables: string[];
  columns: string[];
  indexes: string[];
  constraints: string[];
  functions: string[];
  triggers: string[];
  checkConstraints: string[];
  uniqueConstraints: string[];
}

/**
 * Compute structural keys for a normalized catalog.
 *
 * Filters out the runner-owned `schema_migrations` table and separates
 * CHECK/UNIQUE constraints for independent verification.
 */
export function computeStructuralKeys(catalog: NormalizedCatalog): CatalogStructuralKeys {
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

// ---------------------------------------------------------------------------
// Comparison profiles
// ---------------------------------------------------------------------------

/**
 * Configuration controlling how two catalogs are compared.
 *
 * The test profile applies broad exception rules for Prisma-vs-migration
 * differences. The adoption profile is strict — all migration-owned objects
 * are required, and exceptions must be exact tuples.
 */
export interface ComparisonConfig {
  /** Include CHECK constraints in the mismatch check. */
  includeCheckConstraints: boolean;
  /** Include UNIQUE constraints in the mismatch check. */
  includeUniqueConstraints: boolean;
  /** Filter migration-only partial indexes (test profile only). */
  filterMigrationOnlyIndexes: boolean;
  /** Filter Prisma-only known indexes (test profile only). */
  filterPrismaOnlyIndexes: boolean;
  /** Filter migration-only tables like legacy `migrations` (test profile only). */
  filterMigrationOnlyTables: boolean;
  /** Apply broad column exception rules (test profile only). */
  applyBroadColumnExceptions: boolean;
}

/**
 * Test comparison profile: used by the fingerprint test's cross-comparison
 * against the Prisma-generated schema. Broad exception rules, filtered
 * indexes, CHECK/UNIQUE excluded from main comparison.
 */
export const TEST_COMPARISON: ComparisonConfig = {
  includeCheckConstraints: false,
  includeUniqueConstraints: false,
  filterMigrationOnlyIndexes: true,
  filterPrismaOnlyIndexes: true,
  filterMigrationOnlyTables: true,
  applyBroadColumnExceptions: true,
};

/**
 * Adoption comparison profile: used by the adoption command against an
 * existing production database. Strict — all migration-owned indexes and
 * CHECK/UNIQUE constraints are required, no broad exception rules.
 */
export const ADOPTION_COMPARISON: ComparisonConfig = {
  includeCheckConstraints: true,
  includeUniqueConstraints: true,
  filterMigrationOnlyIndexes: false,
  filterPrismaOnlyIndexes: false,
  filterMigrationOnlyTables: false,
  applyBroadColumnExceptions: false,
};

// ---------------------------------------------------------------------------
// Allowlist for known, accepted differences (test profile only)
// ---------------------------------------------------------------------------

/**
 * Known, accepted differences between the migration-derived schema and the
 * Prisma-shaped production schema. Each entry is documented with its cause.
 *
 * These broad rules apply ONLY to the test comparison profile. The adoption
 * profile uses exact tuple exceptions instead.
 *
 * 1. **`updated_at` default**: migration-added tables set
 *    `DEFAULT CURRENT_TIMESTAMP` on `updated_at` columns; Prisma's `@updatedAt`
 *    directive does not generate a database-level default.
 *
 * 2. **Timestamp type**: migration-added columns use `timestamp with time zone`
 *    (TIMESTAMPTZ) while the Prisma schema declares them as `DateTime` which
 *    Prisma maps to `timestamp(3) without time zone`.
 *
 * 3. **`expired_item_transactions.markdown_level`**: migration 0002 uses
 *    `smallint`, Prisma schema declares `Int` (maps to `integer`).
 */
export function isKnownColumnDifference(migrationKey: string, productionKey: string): boolean {
  const m = migrationKey.split('|');
  const p = productionKey.split('|');
  const column = m[1];

  // `updated_at` default: migration has CURRENT_TIMESTAMP, Prisma has no default.
  if (
    column === 'updated_at' &&
    m[2] === p[2] &&
    m[3] === p[3] &&
    m[4] === 'CURRENT_TIMESTAMP' &&
    p[4] === 'null'
  ) {
    return true;
  }

  // Timestamp type: migration uses timestamptz, Prisma uses timestamp(3).
  if (
    m[2] === 'timestamp with time zone' &&
    p[2] === 'timestamp(3) without time zone' &&
    m[3] === p[3] &&
    m[4] === p[4]
  ) {
    return true;
  }

  // `expired_item_transactions.markdown_level`: migration 0002 uses `smallint`,
  // Prisma schema declares `Int` (maps to `integer`).
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

  // `tier_feature_flags.limit_value`: migration 0010 widens the column to
  // `bigint` so it can hold storage_bytes tier limits (up to 100 GB) that
  // exceed the int4 range. The Prisma production schema still declares `Int`
  // (int4), so the migration-derived schema is intentionally wider. This is an
  // expand-compatible widening with no data loss.
  if (
    m[0] === 'tier_feature_flags' &&
    m[1] === 'limit_value' &&
    m[2] === 'bigint' &&
    p[2] === 'integer' &&
    m[3] === p[3] &&
    m[4] === p[4]
  ) {
    return true;
  }

  return false;
}

/**
 * Migration-only partial indexes that Prisma cannot express in the schema
 * definition. These are created by the migrations but absent from the
 * Prisma-generated schema.
 *
 * For the test profile, these are filtered from the index comparison.
 * For the adoption profile, these are REQUIRED — if they're missing from
 * the production database, that's a mismatch.
 */
export const MIGRATION_ONLY_PARTIAL_INDEXES = new Set([
  // 0004: one active cycle per org
  "check_cycles|ON public.check_cycles USING btree (organization_id) WHERE (status = 'active'::text)|true|false|(status = 'active'::text)",
  // 0001: one active catalogue import per org
  "uploads|ON public.uploads USING btree (organization_id) WHERE ((import_type = 'product-catalog'::text) AND (status = ANY (ARRAY['pending'::text, 'queued'::text, 'validating'::text, 'processing'::text])))|true|false|((import_type = 'product-catalog'::text) AND (status = ANY (ARRAY['pending'::text, 'queued'::text, 'validating'::text, 'processing'::text])))",
]);

/**
 * Prisma-only indexes that the migration series does not create. These are
 * known gaps — the Prisma schema declares an index that no migration adds.
 *
 * For the test profile, these are filtered from the index comparison.
 * For the adoption profile, these are NOT filtered — if the production
 * database has an index that the migration series doesn't create, it must
 * be listed as an explicit adoption exception.
 */
export const PRISMA_ONLY_KNOWN_INDEXES = new Set([
  'check_cycles|ON public.check_cycles USING btree (status)|false|false|null',
]);

/**
 * Tables that may exist in the migration-derived schema but not in the
 * Prisma-generated schema (or vice versa). The legacy `migrations` table
 * records the retired SQLite migration runner's history.
 *
 * For the test profile, these are filtered. For the adoption profile, they
 * are NOT filtered — both sides are migration-derived and should match.
 */
export const MIGRATION_ONLY_TABLES = new Set(['migrations']);

// ---------------------------------------------------------------------------
// Exact adoption column exceptions
// ---------------------------------------------------------------------------

/**
 * An exact column exception for the adoption profile. Unlike the broad test
 * profile rules, this specifies the exact table, column, and expected/actual
 * definitions. An adoption exception must be investigated and documented
 * before being added.
 */
export interface AdoptionColumnException {
  table: string;
  column: string;
  expectedType: string;
  actualType: string;
  expectedNotNull: boolean;
  actualNotNull: boolean;
  expectedDefault: string | null;
  actualDefault: string | null;
}

/**
 * Check whether a column difference matches an exact adoption exception tuple.
 */
function matchesAdoptionException(
  expectedKey: string,
  actualKey: string,
  exceptions: readonly AdoptionColumnException[],
): boolean {
  const e = expectedKey.split('|');
  const a = actualKey.split('|');
  const table = e[0];
  const column = e[1];

  for (const ex of exceptions) {
    // Structural keys represent null defaults as the string "null".
    const expectedDefaultStr = ex.expectedDefault === null ? 'null' : ex.expectedDefault;
    const actualDefaultStr = ex.actualDefault === null ? 'null' : ex.actualDefault;
    if (
      ex.table === table &&
      ex.column === column &&
      ex.expectedType === e[2] &&
      ex.actualType === a[2] &&
      ex.expectedNotNull === (e[3] === 'true') &&
      ex.actualNotNull === (a[3] === 'true') &&
      expectedDefaultStr === e[4] &&
      actualDefaultStr === a[4]
    ) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Catalog diff
// ---------------------------------------------------------------------------

/**
 * The result of comparing two catalogs. Each field lists the structural keys
 * that differ, separated by direction (only in expected vs only in actual).
 *
 * A clean diff (all arrays empty, `matches: true`) means the two catalogs are
 * structurally equivalent modulo the allowlist/exceptions.
 */
export interface CatalogDiff {
  matches: boolean;
  tablesOnlyInExpected: string[];
  tablesOnlyInActual: string[];
  columnsOnlyInExpected: string[];
  columnsOnlyInActual: string[];
  columnsWithKnownDifferences: string[];
  indexesOnlyInExpected: string[];
  indexesOnlyInActual: string[];
  constraintsOnlyInExpected: string[];
  constraintsOnlyInActual: string[];
  checkConstraintsOnlyInExpected: string[];
  checkConstraintsOnlyInActual: string[];
  uniqueConstraintsOnlyInExpected: string[];
  uniqueConstraintsOnlyInActual: string[];
  functionsOnlyInExpected: string[];
  functionsOnlyInActual: string[];
  triggersOnlyInExpected: string[];
  triggersOnlyInActual: string[];
}

/**
 * Compare two sets of structural keys and return the diff.
 *
 * `expected` is the migration-replayed catalog (what the migrations produce).
 * `actual` is the existing database's catalog (what's in production).
 *
 * The `config` parameter controls which exception rules and filters apply:
 * - `TEST_COMPARISON`: broad rules for Prisma-vs-migration comparison.
 * - `ADOPTION_COMPARISON`: strict rules for production database adoption.
 *
 * For the adoption profile, `adoptionColumnExceptions` provides exact
 * table/column/expected/actual tuples for accepted column differences.
 */
export function compareCatalogs(
  expected: CatalogStructuralKeys,
  actual: CatalogStructuralKeys,
  config: ComparisonConfig = TEST_COMPARISON,
  adoptionColumnExceptions: readonly AdoptionColumnException[] = [],
): CatalogDiff {
  // Tables
  const expectedTables = config.filterMigrationOnlyTables
    ? new Set(expected.tables.filter((t) => !MIGRATION_ONLY_TABLES.has(t)))
    : new Set(expected.tables);
  const actualTables = config.filterMigrationOnlyTables
    ? new Set(actual.tables.filter((t) => !MIGRATION_ONLY_TABLES.has(t)))
    : new Set(actual.tables);
  const tablesOnlyInExpected = [...expectedTables].filter((t) => !actualTables.has(t)).sort();
  const tablesOnlyInActual = [...actualTables].filter((t) => !expectedTables.has(t)).sort();

  // Columns
  const expectedColKeys = new Set(expected.columns);
  const actualColKeys = new Set(actual.columns);
  const colsOnlyInExpectedRaw = [...expectedColKeys].filter((k) => !actualColKeys.has(k));
  const colsOnlyInActualRaw = [...actualColKeys].filter((k) => !expectedColKeys.has(k));

  const colsOnlyInExpectedFiltered = config.filterMigrationOnlyTables
    ? colsOnlyInExpectedRaw.filter((k) => !k.startsWith('migrations|'))
    : colsOnlyInExpectedRaw;
  const colsOnlyInActualFiltered = config.filterMigrationOnlyTables
    ? colsOnlyInActualRaw.filter((k) => !k.startsWith('migrations|'))
    : colsOnlyInActualRaw;

  const columnsOnlyInExpected: string[] = [];
  const columnsOnlyInActual: string[] = [];
  const columnsWithKnownDifferences: string[] = [];

  for (const expKey of colsOnlyInExpectedFiltered) {
    const parts = expKey.split('|');
    const tableCol = `${parts[0]}|${parts[1]}`;
    const matchingActual = colsOnlyInActualFiltered.find((a) => {
      const aParts = a.split('|');
      return `${aParts[0]}|${aParts[1]}` === tableCol;
    });
    if (matchingActual) {
      const isKnown = config.applyBroadColumnExceptions
        ? isKnownColumnDifference(expKey, matchingActual)
        : matchesAdoptionException(expKey, matchingActual, adoptionColumnExceptions);
      if (isKnown) {
        columnsWithKnownDifferences.push(
          `${tableCol}: expected=${parts.slice(2).join(',')} vs actual=${matchingActual.split('|').slice(2).join(',')}`,
        );
      } else {
        columnsOnlyInExpected.push(
          `${tableCol}: expected=${parts.slice(2).join(',')} vs actual=${matchingActual.split('|').slice(2).join(',')}`,
        );
      }
    } else {
      columnsOnlyInExpected.push(`Only in expected: ${expKey}`);
    }
  }

  for (const actKey of colsOnlyInActualFiltered) {
    const parts = actKey.split('|');
    const tableCol = `${parts[0]}|${parts[1]}`;
    const matchingExpected = colsOnlyInExpectedFiltered.find((e) => {
      const eParts = e.split('|');
      return `${eParts[0]}|${eParts[1]}` === tableCol;
    });
    if (!matchingExpected) {
      columnsOnlyInActual.push(`Only in actual: ${actKey}`);
    }
  }

  // Indexes
  const idxOnlyInExpectedRaw = setDifference(expected.indexes, actual.indexes);
  const idxOnlyInActualRaw = setDifference(actual.indexes, expected.indexes);

  const idxOnlyInExpected = idxOnlyInExpectedRaw
    .filter((k) => {
      if (config.filterMigrationOnlyTables && k.startsWith('migrations|')) return false;
      if (config.filterMigrationOnlyIndexes && MIGRATION_ONLY_PARTIAL_INDEXES.has(k)) return false;
      return true;
    })
    .sort();
  const idxOnlyInActual = idxOnlyInActualRaw
    .filter((k) => {
      if (config.filterMigrationOnlyTables && k.startsWith('migrations|')) return false;
      if (config.filterPrismaOnlyIndexes && PRISMA_ONLY_KNOWN_INDEXES.has(k)) return false;
      return true;
    })
    .sort();

  // Constraints (FK + PK)
  const conOnlyInExpected = setDifference(expected.constraints, actual.constraints)
    .filter((k) => !config.filterMigrationOnlyTables || !k.startsWith('migrations|'))
    .sort();
  const conOnlyInActual = setDifference(actual.constraints, expected.constraints)
    .filter((k) => !config.filterMigrationOnlyTables || !k.startsWith('migrations|'))
    .sort();

  // CHECK constraints
  const checkOnlyInExpected = config.includeCheckConstraints
    ? setDifference(expected.checkConstraints, actual.checkConstraints)
        .filter((k) => !config.filterMigrationOnlyTables || !k.startsWith('migrations|'))
        .sort()
    : [];
  const checkOnlyInActual = config.includeCheckConstraints
    ? setDifference(actual.checkConstraints, expected.checkConstraints)
        .filter((k) => !config.filterMigrationOnlyTables || !k.startsWith('migrations|'))
        .sort()
    : [];

  // UNIQUE constraints
  const uniqueOnlyInExpected = config.includeUniqueConstraints
    ? setDifference(expected.uniqueConstraints, actual.uniqueConstraints)
        .filter((k) => !config.filterMigrationOnlyTables || !k.startsWith('migrations|'))
        .sort()
    : [];
  const uniqueOnlyInActual = config.includeUniqueConstraints
    ? setDifference(actual.uniqueConstraints, expected.uniqueConstraints)
        .filter((k) => !config.filterMigrationOnlyTables || !k.startsWith('migrations|'))
        .sort()
    : [];

  // Functions and triggers
  const functionsOnlyInExpected = setDifference(expected.functions, actual.functions).sort();
  const functionsOnlyInActual = setDifference(actual.functions, expected.functions).sort();
  const triggersOnlyInExpected = setDifference(expected.triggers, actual.triggers).sort();
  const triggersOnlyInActual = setDifference(actual.triggers, expected.triggers).sort();

  const hasMismatches =
    tablesOnlyInExpected.length > 0 ||
    tablesOnlyInActual.length > 0 ||
    columnsOnlyInExpected.length > 0 ||
    columnsOnlyInActual.length > 0 ||
    idxOnlyInExpected.length > 0 ||
    idxOnlyInActual.length > 0 ||
    conOnlyInExpected.length > 0 ||
    conOnlyInActual.length > 0 ||
    checkOnlyInExpected.length > 0 ||
    checkOnlyInActual.length > 0 ||
    uniqueOnlyInExpected.length > 0 ||
    uniqueOnlyInActual.length > 0 ||
    functionsOnlyInExpected.length > 0 ||
    functionsOnlyInActual.length > 0 ||
    triggersOnlyInExpected.length > 0 ||
    triggersOnlyInActual.length > 0;

  return {
    matches: !hasMismatches,
    tablesOnlyInExpected,
    tablesOnlyInActual,
    columnsOnlyInExpected,
    columnsOnlyInActual,
    columnsWithKnownDifferences,
    indexesOnlyInExpected: idxOnlyInExpected,
    indexesOnlyInActual: idxOnlyInActual,
    constraintsOnlyInExpected: conOnlyInExpected,
    constraintsOnlyInActual: conOnlyInActual,
    checkConstraintsOnlyInExpected: checkOnlyInExpected,
    checkConstraintsOnlyInActual: checkOnlyInActual,
    uniqueConstraintsOnlyInExpected: uniqueOnlyInExpected,
    uniqueConstraintsOnlyInActual: uniqueOnlyInActual,
    functionsOnlyInExpected,
    functionsOnlyInActual,
    triggersOnlyInExpected,
    triggersOnlyInActual,
  };
}

/**
 * Format a catalog diff as a human-readable report string.
 */
export function formatCatalogDiff(diff: CatalogDiff): string {
  const lines: string[] = [];

  if (diff.matches) {
    lines.push('Catalog comparison: MATCH (no unexpected differences)');
    if (diff.columnsWithKnownDifferences.length > 0) {
      lines.push(`  Known/accepted differences (${diff.columnsWithKnownDifferences.length}):`);
      for (const d of diff.columnsWithKnownDifferences) {
        lines.push(`    - ${d}`);
      }
    }
    return lines.join('\n');
  }

  lines.push('Catalog comparison: MISMATCH');
  lines.push('');

  const sections: Array<[string, string[], string]> = [
    ['Tables only in expected (missing from actual)', diff.tablesOnlyInExpected, '  '],
    ['Tables only in actual (unexpected)', diff.tablesOnlyInActual, '  '],
    ['Columns only in expected (missing or different)', diff.columnsOnlyInExpected, '  '],
    ['Columns only in actual (unexpected or different)', diff.columnsOnlyInActual, '  '],
    ['Indexes only in expected (missing)', diff.indexesOnlyInExpected, '  '],
    ['Indexes only in actual (unexpected)', diff.indexesOnlyInActual, '  '],
    ['Constraints only in expected (missing)', diff.constraintsOnlyInExpected, '  '],
    ['Constraints only in actual (unexpected)', diff.constraintsOnlyInActual, '  '],
    ['CHECK constraints only in expected (missing)', diff.checkConstraintsOnlyInExpected, '  '],
    ['CHECK constraints only in actual (unexpected)', diff.checkConstraintsOnlyInActual, '  '],
    ['UNIQUE constraints only in expected (missing)', diff.uniqueConstraintsOnlyInExpected, '  '],
    ['UNIQUE constraints only in actual (unexpected)', diff.uniqueConstraintsOnlyInActual, '  '],
    ['Functions only in expected (missing)', diff.functionsOnlyInExpected, '  '],
    ['Functions only in actual (unexpected)', diff.functionsOnlyInActual, '  '],
    ['Triggers only in expected (missing)', diff.triggersOnlyInExpected, '  '],
    ['Triggers only in actual (unexpected)', diff.triggersOnlyInActual, '  '],
  ];

  for (const [label, items, indent] of sections) {
    if (items.length > 0) {
      lines.push(`${label} (${items.length}):`);
      for (const item of items) {
        lines.push(`${indent}- ${item}`);
      }
      lines.push('');
    }
  }

  if (diff.columnsWithKnownDifferences.length > 0) {
    lines.push(`Known/accepted differences (${diff.columnsWithKnownDifferences.length}):`);
    for (const d of diff.columnsWithKnownDifferences) {
      lines.push(`  - ${d}`);
    }
  }

  return lines.join('\n');
}
