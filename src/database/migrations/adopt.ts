/**
 * Phase 1 task 1.4 — explicit one-time adoption command for an existing
 * production-shaped database.
 *
 * The existing production database was shaped by `prisma db push` plus the
 * hand-written neon-sql deltas. Adoption transitions it from Prisma-managed
 * to migration-runner-managed by verifying the catalog matches the expected
 * migration-derived schema and stamping the `schema_migrations` ledger.
 *
 * Adoption never treats "object already exists" as proof the object is correct.
 * It introspects PostgreSQL catalogs and structurally compares every table,
 * column, index, constraint (including CHECK and UNIQUE), function, and
 * trigger against the expected catalog (the checked-in fingerprint, which is
 * itself verified by the baseline fingerprint test against a pglite replay of
 * 0000→latest). The comparison uses the strict ADOPTION_COMPARISON profile:
 * all migration-owned indexes and CHECK/UNIQUE constraints are required, and
 * column exceptions must be exact table/column/expected/actual tuples.
 *
 * Flow:
 *   dry-run  -> read-only catalog check (no writes, no ledger creation) -> report
 *   apply    -> single transaction: introspect + verify + stamp ledger -> report
 *
 * Both modes acquire the advisory lock. The approved adoption performs
 * introspection and stamping inside a single REPEATABLE READ transaction so
 * the catalog snapshot used for verification is the same one the stamp writes
 * to. A schema-change deployment freeze must be in effect during adoption —
 * the advisory lock only coordinates programs using the same lock (the
 * migration runner); Prisma, manual SQL, and legacy deployment tooling can
 * still modify the schema unless externally frozen.
 *
 * Adoption is one-time: if the ledger already has rows, it refuses.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ADOPTION_COMPARISON,
  compareCatalogs,
  computeStructuralKeys,
  formatCatalogDiff,
  type AdoptionColumnException,
  type CatalogDiff,
  type CatalogStructuralKeys,
} from './catalog-comparison';
import {
  introspectCatalog,
  normalizeCatalog,
  type NormalizedCatalog,
  type QueryClient,
} from './catalog-introspection';
import {
  configureSession,
  ensureLedger,
  formatMigrationError,
  loadMigrationHistory,
  MIGRATION_LOCK_KEY,
  MIGRATION_LOCK_NAMESPACE,
  MigrationExecutionError,
  recordMigration,
  type LoadedMigration,
  type MigrationClient,
} from './runner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdoptionMode = 'dry-run' | 'apply';

/**
 * The result of an adoption check. Describes whether the existing database
 * matches the expected schema, what would be stamped, and any differences.
 */
export interface AdoptionReport {
  /** True if the catalog matches the expected schema (modulo exceptions). */
  canAdopt: boolean;
  /** The latest migration ID that the existing database has been shaped to. */
  adoptionPoint: string;
  /** Migration IDs that would be stamped into the ledger. */
  wouldStamp: string[];
  /** True if the ledger already contains rows (adoption already done). */
  ledgerAlreadyPopulated: boolean;
  /** Structural diff between expected and actual catalogs. */
  diff: CatalogDiff;
  /** Human-readable report string. */
  report: string;
}

export function selectAdoptionTarget(
  history: LoadedMigration[],
  historyDirectory: string,
  requestedPoint?: string,
): { history: LoadedMigration[]; fingerprintPath: string } {
  if (history.length === 0) {
    throw new Error('Migration history is empty — cannot select an adoption point');
  }

  const latestId = history[history.length - 1].id;
  const adoptionPoint = requestedPoint ?? latestId;
  const adoptionIndex = history.findIndex((migration) => migration.id === adoptionPoint);
  if (adoptionIndex < 0) {
    throw new Error(
      `Unknown migration adoption point ${adoptionPoint}; expected one of: ${history
        .map((migration) => migration.id)
        .join(', ')}`,
    );
  }

  return {
    history: history.slice(0, adoptionIndex + 1),
    fingerprintPath: path.join(
      historyDirectory,
      adoptionPoint === latestId
        ? 'catalog-fingerprint.json'
        : `catalog-fingerprint.${adoptionPoint}.json`,
    ),
  };
}

export interface AdoptionOptions {
  /** Git commit SHA for the audit ledger. */
  deploymentSha: string;
  /** Adoption mode: 'dry-run' (read-only) or 'apply' (stamp ledger). */
  mode: AdoptionMode;
  /** Path to the checked-in catalog fingerprint JSON (expected schema). */
  fingerprintPath: string;
  /**
   * Required for 'apply' mode: must match "ADOPT <host>/<database> AT <migration-id>".
   * Validated against targetHost, targetDatabase, and the latest migration ID.
   */
  adoptionConfirmation?: string;
  /** Target host, for confirmation validation (apply mode). */
  targetHost?: string;
  /** Target database, for confirmation validation (apply mode). */
  targetDatabase?: string;
  /** Exact column exceptions for adoption (default: none). */
  columnExceptions?: AdoptionColumnException[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function acquireAdvisoryLock(client: MigrationClient): Promise<void> {
  const lockResult = await client.query('SELECT pg_try_advisory_lock($1, $2) AS acquired', [
    MIGRATION_LOCK_NAMESPACE,
    MIGRATION_LOCK_KEY,
  ]);
  const lockRow = lockResult.rows[0] as { acquired?: boolean } | undefined;
  if (lockRow?.acquired !== true) {
    throw new Error('Refusing to run because another migration process holds the advisory lock');
  }
}

async function releaseAdvisoryLock(client: MigrationClient): Promise<void> {
  const unlockResult = await client.query('SELECT pg_advisory_unlock($1, $2) AS unlocked', [
    MIGRATION_LOCK_NAMESPACE,
    MIGRATION_LOCK_KEY,
  ]);
  const unlockRow = unlockResult.rows[0] as { unlocked?: boolean } | undefined;
  if (unlockRow?.unlocked !== true) {
    throw new Error('PostgreSQL advisory unlock failed');
  }
}

/**
 * Check whether the `schema_migrations` ledger table exists by querying
 * `information_schema.tables`. This is read-only and does NOT create the
 * table — critical for dry-run mode.
 */
async function ledgerExists(client: MigrationClient): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'schema_migrations'`,
  );
  return result.rows.length > 0;
}

async function readLedgerRows(
  client: MigrationClient,
): Promise<Array<{ id: string; checksum: string; state: string }>> {
  const result = await client.query(
    'SELECT id, checksum, state FROM schema_migrations ORDER BY id',
  );
  return result.rows as Array<{ id: string; checksum: string; state: string }>;
}

/**
 * Load the checked-in fingerprint JSON and compute structural keys for the
 * expected catalog. The fingerprint is the normalized catalog from a pglite
 * replay of the full migration series (0000→latest), verified by the baseline
 * fingerprint test in CI.
 */
async function loadExpectedCatalog(fingerprintPath: string): Promise<CatalogStructuralKeys> {
  const json = await readFile(fingerprintPath, 'utf8');
  const normalized = JSON.parse(json) as NormalizedCatalog;
  return computeStructuralKeys(normalized);
}

/**
 * Introspect the existing database and compute structural keys for the actual
 * catalog. Must be called inside a transaction for a consistent snapshot.
 */
async function introspectActualCatalog(client: MigrationClient): Promise<CatalogStructuralKeys> {
  const queryClient: QueryClient = {
    query: (text: string, params?: readonly unknown[]) => client.query(text, params),
  };
  const catalog = await introspectCatalog(queryClient);
  const normalized = normalizeCatalog(catalog);
  return computeStructuralKeys(normalized);
}

function emptyDiff(): CatalogDiff {
  return {
    // No comparison was performed, so there are zero differences. The
    // ledgerAlreadyPopulated flag (not diff.matches) signals why adoption
    // was refused in the one-time-guard path. Setting matches: true avoids
    // misleading an API consumer into thinking a catalog mismatch occurred.
    matches: true,
    tablesOnlyInExpected: [],
    tablesOnlyInActual: [],
    columnsOnlyInExpected: [],
    columnsOnlyInActual: [],
    columnsWithKnownDifferences: [],
    indexesOnlyInExpected: [],
    indexesOnlyInActual: [],
    constraintsOnlyInExpected: [],
    constraintsOnlyInActual: [],
    checkConstraintsOnlyInExpected: [],
    checkConstraintsOnlyInActual: [],
    uniqueConstraintsOnlyInExpected: [],
    uniqueConstraintsOnlyInActual: [],
    functionsOnlyInExpected: [],
    functionsOnlyInActual: [],
    triggersOnlyInExpected: [],
    triggersOnlyInActual: [],
  };
}

function validateAdoptionConfirmation(options: AdoptionOptions, latestMigrationId: string): void {
  if (!options.targetHost || !options.targetDatabase) {
    throw new Error('Adoption apply mode requires targetHost and targetDatabase');
  }
  const expected = `ADOPT ${options.targetHost}/${options.targetDatabase} AT ${latestMigrationId}`;
  if (options.adoptionConfirmation !== expected) {
    throw new Error(
      `Explicit adoption confirmation is required: ${expected}` +
        (options.adoptionConfirmation ? ` (got: ${options.adoptionConfirmation})` : ''),
    );
  }
}

function buildReport(
  canAdopt: boolean,
  adoptionPoint: string,
  wouldStamp: string[],
  ledgerAlreadyPopulated: boolean,
  diff: CatalogDiff,
  mode: AdoptionMode,
): string {
  const lines: string[] = [];
  lines.push('=== Adoption Report ===');
  lines.push(`Mode: ${mode}`);
  lines.push('');

  if (ledgerAlreadyPopulated) {
    lines.push('STATUS: REFUSED — ledger already populated');
    lines.push('Adoption is a one-time operation. The schema_migrations ledger');
    lines.push('already contains rows, so this database has already been adopted.');
    lines.push('Use `migrate:apply` to apply pending migrations instead.');
    lines.push('');
    return lines.join('\n');
  }

  if (canAdopt) {
    lines.push('STATUS: READY — catalog matches expected schema');
    lines.push(`Adoption point: ${adoptionPoint}`);
    lines.push(`Migrations to stamp: ${wouldStamp.join(', ')}`);
    lines.push('');
    lines.push(formatCatalogDiff(diff));
    lines.push('');
    if (mode === 'dry-run') {
      lines.push('To complete adoption, run with --apply and');
      lines.push('MIGRATION_ADOPT_CONFIRMATION="ADOPT <host>/<database> AT <migration-id>"');
    }
  } else {
    lines.push('STATUS: REFUSED — catalog does not match expected schema');
    lines.push(`Expected adoption point: ${adoptionPoint}`);
    lines.push('');
    lines.push(formatCatalogDiff(diff));
    lines.push('');
    lines.push('The existing database catalog does not match the expected schema');
    lines.push('produced by the migration series. Review the differences above.');
    lines.push('If a difference is expected and accepted, add it as an exact');
    lines.push('adoption column exception. Otherwise, fix the production database');
    lines.push('or apply the missing migrations via the current production path.');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Perform an adoption check against an existing database.
 *
 * In dry-run mode: introspects the catalog inside a ROLLBACK-only transaction,
 * compares against the expected fingerprint using the strict ADOPTION_COMPARISON
 * profile, and returns a report. No writes — no ledger creation, no stamping.
 *
 * In apply mode: validates the adoption confirmation, then opens a single
 * REPEATABLE READ transaction that introspects the catalog, verifies it
 * matches, creates the ledger if needed, stamps all migrations as 'applied',
 * and commits. If the catalog does not match, rolls back and refuses.
 * If the ledger already has rows, rolls back and refuses (one-time guard).
 *
 * Both modes acquire the advisory lock. The lock is released in a finally
 * block — no early return bypasses it.
 */
export async function performAdoption(
  client: MigrationClient,
  history: LoadedMigration[],
  options: AdoptionOptions,
): Promise<AdoptionReport> {
  if (!/^[0-9a-f]{7,64}$/i.test(options.deploymentSha)) {
    throw new Error('A valid Git commit SHA is required');
  }
  if (history.length === 0) {
    throw new Error('Migration history is empty — cannot adopt without a baseline migration');
  }
  const deploymentSha = options.deploymentSha.toLowerCase();
  const latestId = history[history.length - 1].id;

  if (options.mode === 'apply') {
    validateAdoptionConfirmation(options, latestId);
  }

  await configureSession(client);
  await acquireAdvisoryLock(client);

  let primaryError: unknown;
  let result: AdoptionReport | undefined;
  let transactionActive = false;

  try {
    // Open a transaction for a consistent catalog snapshot.
    // REPEATABLE READ ensures all catalog reads see the same snapshot.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    transactionActive = true;

    // Check if the ledger already exists (read-only — no CREATE TABLE).
    const hasLedger = await ledgerExists(client);
    const ledgerRows = hasLedger ? await readLedgerRows(client) : [];

    if (ledgerRows.length > 0) {
      // One-time guard: ledger already populated.
      await client.query('ROLLBACK');
      transactionActive = false;
      result = {
        canAdopt: false,
        adoptionPoint: latestId,
        wouldStamp: [],
        ledgerAlreadyPopulated: true,
        diff: emptyDiff(),
        report: buildReport(false, latestId, [], true, emptyDiff(), options.mode),
      };
    } else {
      // Introspect the catalog inside the transaction (consistent snapshot).
      const expectedKeys = await loadExpectedCatalog(options.fingerprintPath);
      const actualKeys = await introspectActualCatalog(client);
      const diff = compareCatalogs(
        expectedKeys,
        actualKeys,
        ADOPTION_COMPARISON,
        options.columnExceptions ?? [],
      );

      const wouldStamp = history.map(({ id }) => id);

      if (!diff.matches) {
        // Catalog mismatch — refuse, do not stamp.
        await client.query('ROLLBACK');
        transactionActive = false;
        result = {
          canAdopt: false,
          adoptionPoint: latestId,
          wouldStamp: [],
          ledgerAlreadyPopulated: false,
          diff,
          report: buildReport(false, latestId, [], false, diff, options.mode),
        };
      } else if (options.mode === 'dry-run') {
        // Dry-run: report readiness, do not stamp, roll back.
        await client.query('ROLLBACK');
        transactionActive = false;
        result = {
          canAdopt: true,
          adoptionPoint: latestId,
          wouldStamp,
          ledgerAlreadyPopulated: false,
          diff,
          report: buildReport(true, latestId, wouldStamp, false, diff, options.mode),
        };
      } else {
        // Approved adoption: create the ledger (if needed) and stamp.
        // ensureLedger is CREATE TABLE IF NOT EXISTS — safe inside the
        // transaction. If the ledger didn't exist, this creates it; if it
        // existed but was empty, this is a no-op.
        await ensureLedger(client);
        for (const migration of history) {
          const startedAt = new Date().toISOString();
          await recordMigration(client, migration, 'applied', deploymentSha, startedAt);
        }
        await client.query('COMMIT');
        transactionActive = false;
        result = {
          canAdopt: true,
          adoptionPoint: latestId,
          wouldStamp,
          ledgerAlreadyPopulated: false,
          diff,
          report: buildReport(true, latestId, wouldStamp, false, diff, options.mode),
        };
      }
    }
  } catch (error) {
    primaryError = error;
    if (transactionActive) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        // Preserve both the primary error and the rollback failure.
        primaryError = new MigrationExecutionError(
          'Adoption failed and transaction rollback also failed',
          [error, rollbackError],
        );
      }
    }
  } finally {
    // Always release the advisory lock — no early return bypasses this.
    try {
      await releaseAdvisoryLock(client);
    } catch (unlockError) {
      if (primaryError !== undefined) {
        const precedingErrors =
          primaryError instanceof MigrationExecutionError ? primaryError.errors : [primaryError];
        primaryError = new MigrationExecutionError(
          'Adoption failed and advisory unlock also failed',
          [...precedingErrors, unlockError],
        );
      } else {
        primaryError = unlockError;
      }
    }
  }

  if (primaryError !== undefined) throw primaryError;
  if (result === undefined) throw new Error('Adoption finished without a report');
  return result;
}

/**
 * Convenience wrapper: load migration history from a directory and perform
 * adoption against the given client.
 */
export async function performAdoptionFromDirectory(
  client: MigrationClient,
  historyDirectory: string,
  options: AdoptionOptions,
): Promise<AdoptionReport> {
  const history = await loadMigrationHistory(historyDirectory);
  return performAdoption(client, history, options);
}

export { formatMigrationError };
export type { AdoptionColumnException };
