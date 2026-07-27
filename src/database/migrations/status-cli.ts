/**
 * Phase 1 task 1.5 — migration status CLI entry point.
 *
 * Usage:
 *   npm run migrate:status
 *
 * Read-only: reports the schema_migrations ledger state against the
 * authoritative history. No writes, no advisory lock.
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
import path from 'node:path';

import { Client } from 'pg';

import { formatMigrationError, MigrationExecutionError, validateMigrationTarget } from './runner';
import { assertTargetKind, verifyMigrationRole } from './target';
import { getMigrationStatus } from './status';

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

  const historyDirectory = path.resolve(process.cwd(), 'database/migrations');
  const client = new Client({
    connectionString,
    application_name: 'date-management-migration-status',
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  });

  await client.connect();
  let role: string | undefined;
  let report: Awaited<ReturnType<typeof getMigrationStatus>> | undefined;
  let statusError: unknown;
  try {
    role = await verifyMigrationRole(client, process.env.MIGRATION_ROLE);
    report = await getMigrationStatus(client, historyDirectory);
  } catch (error) {
    statusError = error;
  }

  try {
    await client.end();
  } catch (closeError) {
    if (statusError !== undefined) {
      throw new MigrationExecutionError('Status failed and connection close also failed', [
        statusError,
        closeError,
      ]);
    }
    throw closeError;
  }

  if (statusError !== undefined) throw statusError;
  if (report === undefined) throw new Error('Status command finished without a report');

  process.stdout.write(
    `Target: ${target.host}/${target.database} (role: ${role})\n\n${report.report}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(`Status failed: ${formatMigrationError(error)}\n`);
  process.exitCode = 1;
});
