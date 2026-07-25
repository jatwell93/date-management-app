/**
 * Phase 1 task 1.5 — migration preflight CLI entry point.
 *
 * Usage:
 *   npm run migrate:preflight
 *
 * Read-only: verifies the target is ready to accept a migration run. No
 * persistent schema object is created (the write probe uses a TEMPORARY table
 * that is session-local and auto-dropped on disconnect).
 *
 * Environment variables:
 *   DATABASE_URL_UNPOOLED            — direct PostgreSQL connection string
 *   MIGRATION_ALLOWED_HOST           — required allowlisted hostname
 *   MIGRATION_ALLOWED_DATABASE       — required allowlisted database name
 *   MIGRATION_ENVIRONMENT            — development | test | staging | production
 *   MIGRATION_CONFIRM_PRODUCTION     — "APPLY <host>/<database>" (production only)
 *   MIGRATION_TARGET_KIND            — primary | development | restore-drill
 *   MIGRATION_ROLE                   — dedicated DDL migration role (must match current_user)
 */
import { Client } from 'pg';

import { formatMigrationError, MigrationExecutionError, validateMigrationTarget } from './runner';
import { assertTargetKind } from './target';
import { runPreflight } from './preflight';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    throw new Error('DATABASE_URL_UNPOOLED is required');
  }

  const target = validateMigrationTarget(connectionString, {
    allowedHost: process.env.MIGRATION_ALLOWED_HOST,
    allowedDatabase: process.env.MIGRATION_ALLOWED_DATABASE,
    environment: process.env.MIGRATION_ENVIRONMENT,
    productionConfirmation: process.env.MIGRATION_CONFIRM_PRODUCTION,
  });
  assertTargetKind({ targetKind: process.env.MIGRATION_TARGET_KIND, mutating: false });

  const role = process.env.MIGRATION_ROLE;
  if (!role) throw new Error('MIGRATION_ROLE is required (the dedicated DDL migration role)');

  const client = new Client({
    connectionString,
    application_name: 'date-management-migration-preflight',
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  });

  await client.connect();
  let report: Awaited<ReturnType<typeof runPreflight>> | undefined;
  let preflightError: unknown;
  try {
    report = await runPreflight(client, role);
  } catch (error) {
    preflightError = error;
  }

  try {
    await client.end();
  } catch (closeError) {
    if (preflightError !== undefined) {
      throw new MigrationExecutionError('Preflight failed and connection close also failed', [
        preflightError,
        closeError,
      ]);
    }
    throw closeError;
  }

  if (preflightError !== undefined) throw preflightError;
  if (report === undefined) throw new Error('Preflight command finished without a report');

  process.stdout.write(`Target: ${target.host}/${target.database}\n\n${report.report}\n`);
  if (!report.ready) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  process.stderr.write(`Preflight failed: ${formatMigrationError(error)}\n`);
  process.exitCode = 1;
});
