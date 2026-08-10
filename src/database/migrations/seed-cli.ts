/**
 * Phase 1 task 1.5 — reference-data seed CLI entry point.
 *
 * Usage:
 *   npm run migrate:seed
 *
 * Idempotently upserts the declared tier_feature_flags reference set and verifies
 * the result. Mutating: requires a primary target, the dedicated DDL migration
 * role, and (for production) an explicit seed confirmation distinct from the
 * production target confirmation.
 *
 * Environment variables:
 *   DATABASE_URL_UNPOOLED            — direct PostgreSQL connection string
 *   MIGRATION_ALLOWED_HOST           — required allowlisted hostname
 *   MIGRATION_ALLOWED_DATABASE       — required allowlisted database name
 *   MIGRATION_ENVIRONMENT            — development | test | staging | production
 *   MIGRATION_CONFIRM_PRODUCTION     — "APPLY <host>/<database>" (production only)
 *   MIGRATION_TARGET_KIND            — must be "primary" for a mutating command
 *   MIGRATION_ROLE                   — dedicated DDL migration role (must match current_user)
 *   MIGRATION_SEED_CONFIRMATION      — "SEED <host>/<database>" (production only)
 */
import { Client } from 'pg';

import { formatMigrationError, MigrationExecutionError, validateMigrationTarget } from './runner';
import {
  createEventContext,
  emitFailure,
  emitStart,
  emitSuccess,
  setEventTarget,
  type MigrationEventContext,
} from './log';
import { assertTargetKind, verifyMigrationRole } from './target';
import { seedTierFeatureFlags, validateSeedConfirmation } from './seed';

async function run(events: MigrationEventContext): Promise<void> {
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
  setEventTarget(events, target);
  emitStart(events);
  assertTargetKind({ targetKind: process.env.MIGRATION_TARGET_KIND, mutating: true });
  validateSeedConfirmation(
    process.env.MIGRATION_SEED_CONFIRMATION,
    target.host,
    target.database,
    process.env.MIGRATION_ENVIRONMENT,
  );

  const client = new Client({
    connectionString,
    application_name: 'date-management-migration-seed',
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  });

  await client.connect();
  let role: string | undefined;
  let report: Awaited<ReturnType<typeof seedTierFeatureFlags>> | undefined;
  let seedError: unknown;
  try {
    role = await verifyMigrationRole(client, process.env.MIGRATION_ROLE);
    report = await seedTierFeatureFlags(client);
  } catch (error) {
    seedError = error;
  }

  try {
    await client.end();
  } catch (closeError) {
    if (seedError !== undefined) {
      throw new MigrationExecutionError('Seed failed and connection close also failed', [
        seedError,
        closeError,
      ]);
    }
    throw closeError;
  }

  if (seedError !== undefined) throw seedError;
  if (report === undefined) throw new Error('Seed command finished without a report');

  process.stdout.write(
    `Target: ${target.host}/${target.database} (role: ${role})\n\n${report.report}\n`,
  );
  if (!report.verified) {
    process.exitCode = 1;
    emitFailure(events, new Error('Seed completed but post-seed verification failed'));
    return;
  }
  emitSuccess(events);
}

async function main(): Promise<void> {
  const events = createEventContext('seed');
  try {
    await run(events);
  } catch (error) {
    emitFailure(events, error);
    throw error;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`Seed failed: ${formatMigrationError(error)}\n`);
  process.exitCode = 1;
});
