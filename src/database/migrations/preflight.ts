/**
 * Phase 1 task 1.5 — read-only migration preflight.
 *
 * Verifies the target is ready to accept a migration run without writing any
 * persistent schema object. Replaces the backend-owned `verify-neon*.ts`,
 * `test-connection.ts`, `test-write-permissions.ts`, and `check-tables.ts`
 * preflight helpers with a single fail-closed check that:
 *
 *   - confirms connectivity and reports the PostgreSQL version;
 *   - verifies the connected role is the dedicated DDL migration role;
 *   - verifies the role has CREATE privilege on the `public` schema and on the
 *     database (DDL readiness) via `has_schema_privilege` /
 *     `has_database_privilege` — no persistent object is created;
 *   - performs a real but self-cleaning write probe by creating and dropping a
 *     TEMPORARY table (session-local, auto-dropped on disconnect) so the role
 *     is proven able to execute DDL, not just that a privilege bit is set;
 *   - reports whether the `schema_migrations` ledger exists and, if it does,
 *     whether any migration is left in the interrupted `applying` state.
 *
 * Read-only with respect to persistent catalog state. The temporary table is
 * session-local and never visible to other sessions or after disconnect.
 */
import type { MigrationClient } from './runner';
import { verifyMigrationRole } from './target';

export interface PreflightReport {
  connected: boolean;
  version: string | null;
  role: string;
  canCreateOnSchema: boolean;
  canCreateOnDatabase: boolean;
  writeProbeOk: boolean;
  ledgerExists: boolean;
  interrupted: string[];
  ready: boolean;
  report: string;
}

async function ledgerExists(client: MigrationClient): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 AS exists FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'schema_migrations' LIMIT 1`,
  );
  return (result.rows[0] as { exists?: number } | undefined)?.exists === 1;
}

async function readInterrupted(client: MigrationClient): Promise<string[]> {
  const result = await client.query(
    `SELECT id FROM schema_migrations WHERE state = 'applying' ORDER BY id`,
  );
  return (result.rows as { id?: string }[])
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string');
}

export async function runPreflight(
  client: MigrationClient,
  expectedRole: string,
): Promise<PreflightReport> {
  // Connectivity + version.
  const versionResult = await client.query('SELECT version() AS version');
  const version = (versionResult.rows[0] as { version?: string } | undefined)?.version ?? null;

  // Role verification (delegates to target.ts for the exact-match check).
  const role = await verifyMigrationRole(client, expectedRole);

  // DDL privilege checks (read-only catalog queries).
  const schemaPrivResult = await client.query(
    `SELECT has_schema_privilege($1, 'public', 'CREATE') AS can_create`,
    [role],
  );
  const canCreateOnSchema =
    (schemaPrivResult.rows[0] as { can_create?: boolean } | undefined)?.can_create === true;

  const dbPrivResult = await client.query(
    `SELECT has_database_privilege($1, current_database(), 'CREATE') AS can_create`,
    [role],
  );
  const canCreateOnDatabase =
    (dbPrivResult.rows[0] as { can_create?: boolean } | undefined)?.can_create === true;

  // Real but self-cleaning write probe: a TEMPORARY table is session-local and
  // auto-dropped on disconnect, so it proves DDL execution without touching the
  // persistent catalog. Wrap in a savepoint so a failure cannot leak state.
  let writeProbeOk = false;
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMPORARY TABLE _migration_preflight_probe (id int)');
    await client.query('DROP TABLE _migration_preflight_probe');
    await client.query('COMMIT');
    writeProbeOk = true;
  } catch {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Best-effort rollback; the temp table is session-local anyway.
    }
  }

  // Ledger state.
  const exists = await ledgerExists(client);
  const interrupted = exists ? await readInterrupted(client) : [];

  const ready =
    canCreateOnSchema && canCreateOnDatabase && writeProbeOk && interrupted.length === 0;

  const report = formatReport({
    version,
    role,
    canCreateOnSchema,
    canCreateOnDatabase,
    writeProbeOk,
    ledgerExists: exists,
    interrupted,
    ready,
  });

  return {
    connected: true,
    version,
    role,
    canCreateOnSchema,
    canCreateOnDatabase,
    writeProbeOk,
    ledgerExists: exists,
    interrupted,
    ready,
    report,
  };
}

function formatReport(input: {
  version: string | null;
  role: string;
  canCreateOnSchema: boolean;
  canCreateOnDatabase: boolean;
  writeProbeOk: boolean;
  ledgerExists: boolean;
  interrupted: string[];
  ready: boolean;
}): string {
  const lines: string[] = [];
  lines.push(`Migration preflight`);
  lines.push(`  Connectivity: OK`);
  lines.push(`  PostgreSQL version: ${input.version ?? '(unknown)'}`);
  lines.push(`  Connected role: ${input.role}`);
  lines.push(`  CREATE on public schema: ${input.canCreateOnSchema ? 'OK' : 'MISSING'}`);
  lines.push(`  CREATE on database: ${input.canCreateOnDatabase ? 'OK' : 'MISSING'}`);
  lines.push(`  DDL write probe (temp table): ${input.writeProbeOk ? 'OK' : 'FAILED'}`);
  lines.push(`  schema_migrations ledger: ${input.ledgerExists ? 'present' : 'not initialized'}`);
  if (input.interrupted.length > 0) {
    lines.push(`  Interrupted migrations (applying state): ${input.interrupted.join(', ')}`);
  }
  lines.push(`  Ready: ${input.ready ? 'YES' : 'NO'}`);
  return lines.join('\n');
}
