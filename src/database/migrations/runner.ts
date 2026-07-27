import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export type TransactionRule = 'required' | 'forbidden';
export type DataLossClass = 'none' | 'possible' | 'destructive';
export type RecoveryStrategy = 'rollback-sql' | 'forward-fix' | 'restore';

export interface MigrationManifestEntry {
  id: string;
  forward: string;
  transaction: TransactionRule;
  compatibility: 'expand';
  dataLoss: DataLossClass;
  recovery: {
    strategy: RecoveryStrategy;
    file: string;
    execution: 'manual-only';
    dataLoss: 'destructive';
    completeness: 'complete' | 'partial';
  };
}

export interface MigrationManifest {
  version: 1;
  migrations: MigrationManifestEntry[];
}

export interface LoadedMigration extends MigrationManifestEntry {
  sql: string;
  recoverySql: string;
  checksum: string;
}

export interface MigrationClient {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: unknown[] }>;
}

export interface MigrationRunOptions {
  deploymentSha: string;
}

export interface MigrationTargetOptions {
  allowedHost?: string;
  allowedDatabase?: string;
  environment?: string;
  productionConfirmation?: string;
}

export interface LedgerRow {
  id: string;
  checksum: string;
  state: 'applying' | 'applied';
}

export const MIGRATION_LOCK_NAMESPACE = 1_146_041_169;
export const MIGRATION_LOCK_KEY = 1;
const MIGRATION_ID_PATTERN = /^\d{4}$/;

export class MigrationExecutionError extends Error {
  constructor(
    message: string,
    readonly errors: unknown[],
  ) {
    super(message);
    this.name = 'MigrationExecutionError';
  }
}

function redactErrorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgresql://[redacted]@')
    .replace(/password=[^\s]+/gi, 'password=[redacted]');
}

export function formatMigrationError(error: unknown): string {
  if (error instanceof MigrationExecutionError) {
    return `${redactErrorMessage(error)}: ${error.errors.map(formatMigrationError).join('; ')}`;
  }
  return redactErrorMessage(error);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  context: string,
): void {
  const expected = new Set(expectedKeys);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  const missing = expectedKeys.filter((key) => !(key in value));
  if (unknown.length > 0) {
    throw new Error(`${context} has unknown field(s): ${unknown.join(', ')}`);
  }
  if (missing.length > 0) {
    throw new Error(`${context} is missing field(s): ${missing.join(', ')}`);
  }
}

function assertManifest(value: unknown): asserts value is MigrationManifest {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Migration manifest must be an object');
  }

  const candidate = value as Record<string, unknown>;
  assertExactKeys(candidate, ['version', 'migrations'], 'Migration manifest');
  if (candidate.version !== 1 || !Array.isArray(candidate.migrations)) {
    throw new Error('Migration manifest must have version 1 and a migrations array');
  }

  candidate.migrations.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Migration manifest entry ${index} must be an object`);
    }
    const migration = entry as Record<string, unknown>;
    assertExactKeys(
      migration,
      ['id', 'forward', 'transaction', 'compatibility', 'dataLoss', 'recovery'],
      `Migration manifest entry ${index}`,
    );
    if (
      typeof migration.id !== 'string' ||
      typeof migration.forward !== 'string' ||
      typeof migration.transaction !== 'string' ||
      typeof migration.compatibility !== 'string' ||
      typeof migration.dataLoss !== 'string' ||
      typeof migration.recovery !== 'object' ||
      migration.recovery === null
    ) {
      throw new Error(`Migration manifest entry ${index} has invalid field types`);
    }
    const recovery = migration.recovery as Record<string, unknown>;
    assertExactKeys(
      recovery,
      ['strategy', 'file', 'execution', 'dataLoss', 'completeness'],
      `Migration manifest entry ${index} recovery`,
    );
    if (Object.values(recovery).some((item) => typeof item !== 'string' || item.length === 0)) {
      throw new Error(`Migration manifest entry ${index} recovery has invalid field types`);
    }
  });
}

function assertSafeHistoryFile(file: string, id: string, purpose: 'forward' | 'recovery'): void {
  const requiredSuffix = purpose === 'forward' ? '.up.sql' : '.down.sql';
  if (
    path.basename(file) !== file ||
    !file.startsWith(`${id}_`) ||
    !file.endsWith(requiredSuffix)
  ) {
    throw new Error(`Migration ${id} ${purpose} must be an id-prefixed SQL filename`);
  }
}

function calculateChecksum(
  entry: MigrationManifestEntry,
  sql: string,
  recoverySql: string,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: entry.id,
        forward: entry.forward,
        transaction: entry.transaction,
        compatibility: entry.compatibility,
        dataLoss: entry.dataLoss,
        recovery: entry.recovery,
      }),
    )
    .update('\0')
    .update(sql)
    .update('\0')
    .update(recoverySql)
    .digest('hex');
}

async function readRequiredSql(
  directory: string,
  file: string,
  id: string,
  purpose: string,
): Promise<string> {
  try {
    return await readFile(path.join(directory, file), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Migration ${id} ${purpose} file does not exist: ${file}`);
    }
    throw error;
  }
}

export async function loadMigrationHistory(directory: string): Promise<LoadedMigration[]> {
  const manifestPath = path.join(directory, 'manifest.json');
  const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  assertManifest(parsed);

  let previousId: string | undefined;
  const loaded: LoadedMigration[] = [];

  for (const entry of parsed.migrations) {
    if (
      !MIGRATION_ID_PATTERN.test(entry.id) ||
      (previousId !== undefined && entry.id <= previousId)
    ) {
      throw new Error('Migration ids must be strictly increasing and unique four-digit numbers');
    }
    if (
      previousId === undefined
        ? !['0000', '0001'].includes(entry.id)
        : Number(entry.id) !== Number(previousId) + 1
    ) {
      throw new Error('Migration ids must be contiguous');
    }
    previousId = entry.id;

    assertSafeHistoryFile(entry.forward, entry.id, 'forward');
    assertSafeHistoryFile(entry.recovery.file, entry.id, 'recovery');

    if (!['required', 'forbidden'].includes(entry.transaction)) {
      throw new Error(`Migration ${entry.id} has an invalid transaction rule`);
    }
    if (entry.compatibility !== 'expand') {
      throw new Error(`Migration ${entry.id} must declare expand compatibility`);
    }
    if (!['none', 'possible', 'destructive'].includes(entry.dataLoss)) {
      throw new Error(`Migration ${entry.id} has an invalid data-loss class`);
    }
    if (!['rollback-sql', 'forward-fix', 'restore'].includes(entry.recovery.strategy)) {
      throw new Error(`Migration ${entry.id} has an invalid recovery strategy`);
    }
    if (
      entry.recovery.execution !== 'manual-only' ||
      entry.recovery.dataLoss !== 'destructive' ||
      !['complete', 'partial'].includes(entry.recovery.completeness)
    ) {
      throw new Error(`Migration ${entry.id} has invalid recovery safety metadata`);
    }

    const sql = await readRequiredSql(directory, entry.forward, entry.id, 'forward');
    const recoverySql = await readRequiredSql(directory, entry.recovery.file, entry.id, 'recovery');
    loaded.push({
      ...entry,
      sql,
      recoverySql,
      checksum: calculateChecksum(entry, sql, recoverySql),
    });
  }

  const declaredFiles = new Set(
    parsed.migrations.flatMap(({ forward, recovery }) => [forward, recovery.file]),
  );
  const sqlFiles = (await readdir(directory)).filter((file) => file.endsWith('.sql'));
  const undeclaredFiles = sqlFiles.filter((file) => !declaredFiles.has(file));
  if (undeclaredFiles.length > 0) {
    throw new Error(`SQL files are missing from manifest: ${undeclaredFiles.join(', ')}`);
  }

  return loaded;
}

export async function configureSession(client: MigrationClient): Promise<void> {
  await client.query(`SET lock_timeout = '10s'`);
  await client.query(`SET statement_timeout = '5min'`);
  await client.query(`SET idle_in_transaction_session_timeout = '1min'`);
}

export async function ensureLedger(client: MigrationClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      checksum text NOT NULL,
      state text NOT NULL CHECK (state IN ('applying', 'applied')),
      transaction_rule text NOT NULL CHECK (transaction_rule IN ('required', 'forbidden')),
      data_loss_class text NOT NULL CHECK (data_loss_class IN ('none', 'possible', 'destructive')),
      recovery_strategy text NOT NULL CHECK (recovery_strategy IN ('rollback-sql', 'forward-fix', 'restore')),
      migration_name text NOT NULL,
      deployment_sha text NOT NULL,
      started_at timestamptz NOT NULL,
      applied_at timestamptz,
      runner_version integer NOT NULL DEFAULT 1
    )
  `);
}

function parseLedgerRows(rows: unknown[]): LedgerRow[] {
  return rows.map((row) => {
    if (typeof row !== 'object' || row === null) {
      throw new Error('schema_migrations contains an invalid row');
    }
    return row as LedgerRow;
  });
}

function validateLedger(history: LoadedMigration[], rows: LedgerRow[]): Set<string> {
  const historyById = new Map(history.map((migration) => [migration.id, migration]));
  const applied = new Set<string>();

  for (const row of rows) {
    const migration = historyById.get(row.id);
    if (!migration) {
      throw new Error(`Applied migration ${row.id} is absent from authoritative history`);
    }
    if (row.checksum !== migration.checksum) {
      throw new Error(`Applied migration ${row.id} checksum mismatch`);
    }
    if (row.state !== 'applied') {
      throw new Error(
        `Migration ${row.id} was interrupted outside a transaction; repair it explicitly before resuming`,
      );
    }
    applied.add(row.id);
  }

  const expectedPrefix = history.slice(0, applied.size).map(({ id }) => id);
  if (expectedPrefix.some((id) => !applied.has(id))) {
    throw new Error('Applied migrations are not a contiguous prefix of authoritative history');
  }

  return applied;
}

export async function recordMigration(
  client: MigrationClient,
  migration: LoadedMigration,
  state: LedgerRow['state'],
  deploymentSha: string,
  startedAt: string,
): Promise<void> {
  await client.query(
    `
      INSERT INTO schema_migrations (
        id, checksum, state, transaction_rule, data_loss_class, recovery_strategy,
        migration_name, deployment_sha, started_at, applied_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, CASE WHEN $3 = 'applied' THEN now() ELSE NULL END)
      ON CONFLICT (id) DO UPDATE
      SET checksum = EXCLUDED.checksum,
          state = EXCLUDED.state,
          transaction_rule = EXCLUDED.transaction_rule,
          data_loss_class = EXCLUDED.data_loss_class,
          recovery_strategy = EXCLUDED.recovery_strategy,
          migration_name = schema_migrations.migration_name,
          deployment_sha = schema_migrations.deployment_sha,
          started_at = schema_migrations.started_at,
          applied_at = EXCLUDED.applied_at
    `,
    [
      migration.id,
      migration.checksum,
      state,
      migration.transaction,
      migration.dataLoss,
      migration.recovery.strategy,
      migration.forward.replace(/\.up\.sql$/, ''),
      deploymentSha,
      startedAt,
    ],
  );
}

async function applyTransactional(
  client: MigrationClient,
  migration: LoadedMigration,
  deploymentSha: string,
): Promise<void> {
  const startedAt = new Date().toISOString();
  await client.query('BEGIN');
  try {
    await recordMigration(client, migration, 'applying', deploymentSha, startedAt);
    await client.query(migration.sql);
    await recordMigration(client, migration, 'applied', deploymentSha, startedAt);
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new MigrationExecutionError('Migration failed and rollback also failed', [
        error,
        rollbackError,
      ]);
    }
    throw error;
  }
}

async function applyNonTransactional(
  client: MigrationClient,
  migration: LoadedMigration,
  deploymentSha: string,
): Promise<void> {
  const startedAt = new Date().toISOString();
  await recordMigration(client, migration, 'applying', deploymentSha, startedAt);
  await client.query(migration.sql);
  await recordMigration(client, migration, 'applied', deploymentSha, startedAt);
}

export async function applyPendingMigrations(
  client: MigrationClient,
  history: LoadedMigration[],
  options: MigrationRunOptions,
): Promise<{ applied: string[]; alreadyApplied: string[] }> {
  if (!/^[0-9a-f]{7,64}$/i.test(options.deploymentSha)) {
    throw new Error('A valid Git commit SHA is required');
  }
  const deploymentSha = options.deploymentSha.toLowerCase();
  await configureSession(client);
  const lockResult = await client.query('SELECT pg_try_advisory_lock($1, $2) AS acquired', [
    MIGRATION_LOCK_NAMESPACE,
    MIGRATION_LOCK_KEY,
  ]);
  const lockRow = lockResult.rows[0] as { acquired?: boolean } | undefined;
  if (lockRow?.acquired !== true) {
    throw new Error('Refusing to run because another migration process holds the advisory lock');
  }

  let result: { applied: string[]; alreadyApplied: string[] } | undefined;
  let primaryError: unknown;
  try {
    await ensureLedger(client);
    const ledgerResult = await client.query(
      'SELECT id, checksum, state FROM schema_migrations ORDER BY id',
    );
    const applied = validateLedger(history, parseLedgerRows(ledgerResult.rows));
    const pending = history.filter(({ id }) => !applied.has(id));

    for (const migration of pending) {
      if (migration.transaction === 'required') {
        await applyTransactional(client, migration, deploymentSha);
      } else {
        await applyNonTransactional(client, migration, deploymentSha);
      }
    }

    result = {
      applied: pending.map(({ id }) => id),
      alreadyApplied: history.filter(({ id }) => applied.has(id)).map(({ id }) => id),
    };
  } catch (error) {
    primaryError = error;
  }

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
        ? 'Migration completed but advisory unlock failed'
        : 'Migration failed and advisory unlock also failed',
      [...precedingErrors.filter((error) => error !== undefined), unlockError],
    );
  }

  if (primaryError !== undefined) throw primaryError;
  if (result === undefined) throw new Error('Migration runner finished without a result');
  return result;
}

export function validateMigrationTarget(
  connectionString: string,
  options: MigrationTargetOptions,
): { host: string; database: string } {
  const target = new URL(connectionString);
  const host = target.hostname.toLowerCase();
  const database = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (host.includes('-pooler.')) {
    throw new Error('Migrations require a direct, non-pooled PostgreSQL connection');
  }
  if (!options.allowedHost || !options.allowedDatabase) {
    throw new Error('Migration target host and database allowlist values are required');
  }
  if (!['development', 'test', 'staging', 'production'].includes(options.environment ?? '')) {
    throw new Error(
      'Migration environment must be one of development, test, staging, or production',
    );
  }
  if (host !== options.allowedHost.toLowerCase() || database !== options.allowedDatabase) {
    throw new Error('Migration target does not match the allowlist');
  }
  if (
    options.environment === 'production' &&
    options.productionConfirmation !== `APPLY ${host}/${database}`
  ) {
    throw new Error(`Explicit production confirmation is required: APPLY ${host}/${database}`);
  }
  return { host, database };
}
