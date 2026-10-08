/**
 * Shared catalog comparison logic for structural schema comparison.
 *
 * Used by the adoption command and the post-adoption verifier, which compare
 * the migration-replayed catalog against an existing production database.
 * The comparison is strict: all migration-owned indexes and CHECK/UNIQUE
 * constraints are required, and column exceptions must be exact
 * table/column/expected/actual tuples.
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
 */
export interface ComparisonConfig {
  /** Include CHECK constraints in the mismatch check. */
  includeCheckConstraints: boolean;
  /** Include UNIQUE constraints in the mismatch check. */
  includeUniqueConstraints: boolean;
}

/**
 * Adoption comparison profile: used by the adoption command against an
 * existing production database. Strict: all migration-owned indexes and
 * CHECK/UNIQUE constraints are required.
 */
export const ADOPTION_COMPARISON: ComparisonConfig = {
  includeCheckConstraints: true,
  includeUniqueConstraints: true,
};

// ---------------------------------------------------------------------------
// Exact adoption column exceptions
// ---------------------------------------------------------------------------

/**
 * An exact column exception for the adoption profile: the exact table, column,
 * and expected/actual definitions. An adoption exception must be investigated
 * and documented before being added.
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
 * `adoptionColumnExceptions` provides exact table/column/expected/actual
 * tuples for accepted column differences.
 */
export function compareCatalogs(
  expected: CatalogStructuralKeys,
  actual: CatalogStructuralKeys,
  config: ComparisonConfig,
  adoptionColumnExceptions: readonly AdoptionColumnException[] = [],
): CatalogDiff {
  // Tables
  const expectedTables = new Set(expected.tables);
  const actualTables = new Set(actual.tables);
  const tablesOnlyInExpected = [...expectedTables].filter((t) => !actualTables.has(t)).sort();
  const tablesOnlyInActual = [...actualTables].filter((t) => !expectedTables.has(t)).sort();

  // Columns
  const expectedColKeys = new Set(expected.columns);
  const actualColKeys = new Set(actual.columns);
  const colsOnlyInExpectedRaw = [...expectedColKeys].filter((k) => !actualColKeys.has(k));
  const colsOnlyInActualRaw = [...actualColKeys].filter((k) => !expectedColKeys.has(k));

  const colsOnlyInExpectedFiltered = colsOnlyInExpectedRaw;
  const colsOnlyInActualFiltered = colsOnlyInActualRaw;

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
      const isKnown = matchesAdoptionException(expKey, matchingActual, adoptionColumnExceptions);
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

  const idxOnlyInExpected = [...idxOnlyInExpectedRaw].sort();
  const idxOnlyInActual = [...idxOnlyInActualRaw].sort();

  // Constraints (FK + PK)
  const conOnlyInExpected = setDifference(expected.constraints, actual.constraints).sort();
  const conOnlyInActual = setDifference(actual.constraints, expected.constraints).sort();

  // CHECK constraints
  const checkOnlyInExpected = config.includeCheckConstraints
    ? setDifference(expected.checkConstraints, actual.checkConstraints).sort()
    : [];
  const checkOnlyInActual = config.includeCheckConstraints
    ? setDifference(actual.checkConstraints, expected.checkConstraints).sort()
    : [];

  // UNIQUE constraints
  const uniqueOnlyInExpected = config.includeUniqueConstraints
    ? setDifference(expected.uniqueConstraints, actual.uniqueConstraints).sort()
    : [];
  const uniqueOnlyInActual = config.includeUniqueConstraints
    ? setDifference(actual.uniqueConstraints, expected.uniqueConstraints).sort()
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
