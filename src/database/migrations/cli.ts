import { access } from 'node:fs/promises';
import path from 'node:path';

import { Client } from 'pg';

import {
  applyPendingMigrations,
  formatMigrationError,
  loadMigrationHistory,
  MigrationExecutionError,
  validateMigrationTarget,
} from './runner';
import { assertTargetKind, verifyMigrationRole } from './target';

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
  assertTargetKind({ targetKind: process.env.MIGRATION_TARGET_KIND, mutating: true });
  const deploymentSha = process.env.MIGRATION_DEPLOYMENT_SHA;
  if (!deploymentSha) throw new Error('MIGRATION_DEPLOYMENT_SHA is required');

  const historyDirectory = path.resolve(process.cwd(), 'database/migrations');
  try {
    await access(path.join(historyDirectory, '0000_baseline.up.sql'));
  } catch {
    throw new Error(
      'Canonical baseline is not installed yet; complete Phase 1 task 1.3 before applying migrations',
    );
  }
  const history = await loadMigrationHistory(historyDirectory);
  const client = new Client({
    connectionString,
    application_name: 'date-management-migration-runner',
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  });

  await client.connect();
  let role: string | undefined;
  let result: Awaited<ReturnType<typeof applyPendingMigrations>> | undefined;
  let migrationError: unknown;
  try {
    role = await verifyMigrationRole(client, process.env.MIGRATION_ROLE);
    result = await applyPendingMigrations(client, history, { deploymentSha });
  } catch (error) {
    migrationError = error;
  }

  try {
    await client.end();
  } catch (closeError) {
    if (migrationError !== undefined) {
      throw new MigrationExecutionError('Migration failed and connection close also failed', [
        migrationError,
        closeError,
      ]);
    }
    throw closeError;
  }

  if (migrationError !== undefined) throw migrationError;
  if (result === undefined) throw new Error('Migration command finished without a result');
  process.stdout.write(
    `${JSON.stringify({
      target: {
        host: target.host,
        database: target.database,
        role,
      },
      ...result,
    })}\n`,
  );
}

void main().catch((error: unknown) => {
  process.stderr.write(`Migration failed: ${formatMigrationError(error)}\n`);
  process.exitCode = 1;
});
