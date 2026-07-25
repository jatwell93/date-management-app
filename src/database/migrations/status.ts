/**
 * Phase 1 task 1.5 — read-only migration status.
 *
 * Reports the state of the `schema_migrations` ledger against the authoritative
 * migration history: which migrations are applied, which are pending, and
 * whether any applied row has drifted (checksum mismatch, unknown id, or an
 * interrupted `applying` state). Replaces the backend-owned `migrate:status`
 * and `list-migrations.ts` diagnostics for the new PostgreSQL ledger.
 *
 * Read-only: no advisory lock, no writes. If a concurrent apply is in flight,
 * status reports whatever ledger state it observes, including an `applying`
 * row, which is itself useful diagnostic signal.
 */
import { loadMigrationHistory, type LoadedMigration, type MigrationClient } from './runner';

export interface StatusReport {
  /** Whether the schema_migrations ledger exists on the target. */
  ledgerExists: boolean;
  /** Number of migrations in the authoritative history. */
  historyCount: number;
  /** Applied migration ids in ledger order. */
  applied: string[];
  /** Pending migration ids (history not yet in the ledger). */
  pending: string[];
  /** Applied ids absent from the authoritative history (orphaned). */
  orphaned: string[];
  /** Applied ids whose ledger checksum no longer matches the history checksum. */
  checksumDrift: string[];
  /** Applied ids left in the `applying` state (interrupted non-transactional). */
  interrupted: string[];
  /** True when applied ids are not a contiguous prefix of the history. */
  contiguousPrefix: boolean;
  /** Human-readable report. */
  report: string;
}

interface LedgerRow {
  id: string;
  checksum: string;
  state: string;
}

async function ledgerExists(client: MigrationClient): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 AS exists FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'schema_migrations' LIMIT 1`,
  );
  return (result.rows[0] as { exists?: number } | undefined)?.exists === 1;
}

async function readLedger(client: MigrationClient): Promise<LedgerRow[]> {
  const result = await client.query(
    'SELECT id, checksum, state FROM schema_migrations ORDER BY id',
  );
  return result.rows as LedgerRow[];
}

export async function getMigrationStatus(
  client: MigrationClient,
  historyDirectory: string,
): Promise<StatusReport> {
  const history = await loadMigrationHistory(historyDirectory);
  const historyById = new Map(history.map((migration) => [migration.id, migration]));
  const historyIds = history.map(({ id }) => id);

  const exists = await ledgerExists(client);
  if (!exists) {
    return {
      ledgerExists: false,
      historyCount: history.length,
      applied: [],
      pending: historyIds,
      orphaned: [],
      checksumDrift: [],
      interrupted: [],
      contiguousPrefix: true,
      report: formatReport({
        ledgerExists: false,
        history,
        applied: [],
        pending: historyIds,
        orphaned: [],
        checksumDrift: [],
        interrupted: [],
        contiguousPrefix: true,
      }),
    };
  }

  const rows = await readLedger(client);
  const applied: string[] = [];
  const orphaned: string[] = [];
  const checksumDrift: string[] = [];
  const interrupted: string[] = [];

  for (const row of rows) {
    const migration = historyById.get(row.id);
    if (!migration) {
      orphaned.push(row.id);
      continue;
    }
    if (row.checksum !== migration.checksum) {
      checksumDrift.push(row.id);
    }
    if (row.state !== 'applied') {
      interrupted.push(row.id);
    }
    applied.push(row.id);
  }

  const appliedSet = new Set(applied);
  const pending = historyIds.filter((id) => !appliedSet.has(id));

  // Contiguous-prefix check: applied ids (ignoring orphans) must be the first
  // N entries of the history in order.
  const appliedInHistory = applied.filter((id) => historyById.has(id));
  const expectedPrefix = historyIds.slice(0, appliedInHistory.length);
  const contiguousPrefix =
    expectedPrefix.length === appliedInHistory.length &&
    expectedPrefix.every((id, index) => appliedInHistory[index] === id);

  const report = formatReport({
    ledgerExists: true,
    history,
    applied,
    pending,
    orphaned,
    checksumDrift,
    interrupted,
    contiguousPrefix,
  });

  return {
    ledgerExists: true,
    historyCount: history.length,
    applied,
    pending,
    orphaned,
    checksumDrift,
    interrupted,
    contiguousPrefix,
    report,
  };
}

function formatReport(input: {
  ledgerExists: boolean;
  history: LoadedMigration[];
  applied: string[];
  pending: string[];
  orphaned: string[];
  checksumDrift: string[];
  interrupted: string[];
  contiguousPrefix: boolean;
}): string {
  const {
    ledgerExists,
    history,
    applied,
    pending,
    orphaned,
    checksumDrift,
    interrupted,
    contiguousPrefix,
  } = input;
  const lines: string[] = [];
  lines.push(`Migration status`);
  lines.push(
    `  Ledger: ${ledgerExists ? 'present' : 'not initialized (fresh or pre-adoption target)'}`,
  );
  lines.push(`  Authoritative history: ${history.length} migration(s)`);
  lines.push(`  Applied: ${applied.length === 0 ? '(none)' : applied.join(', ')}`);
  lines.push(`  Pending: ${pending.length === 0 ? '(none — up to date)' : pending.join(', ')}`);
  if (orphaned.length > 0) {
    lines.push(`  Orphaned (in ledger, absent from history): ${orphaned.join(', ')}`);
  }
  if (checksumDrift.length > 0) {
    lines.push(`  Checksum drift: ${checksumDrift.join(', ')}`);
  }
  if (interrupted.length > 0) {
    lines.push(`  Interrupted (left in 'applying' state): ${interrupted.join(', ')}`);
  }
  if (!contiguousPrefix) {
    lines.push(`  WARNING: applied migrations are not a contiguous prefix of the history`);
  }
  const healthy =
    orphaned.length === 0 &&
    checksumDrift.length === 0 &&
    interrupted.length === 0 &&
    contiguousPrefix;
  lines.push(`  Health: ${healthy ? 'OK' : 'ATTENTION REQUIRED'}`);
  return lines.join('\n');
}
