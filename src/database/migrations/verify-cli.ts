/**
 * Phase 1 task 1.5 — migration verification CLI entry point.
 *
 * Usage:
 *   npm run migrate:verify
 *
 * Read-only: verifies the schema (expected tables present + catalog matches
 * the checked-in fingerprint) and the reference data (tier_feature_flags
 * exactly matches the declared set). No writes, no advisory lock.
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
import { access } from 'node:fs/promises';
import path from 'node:path';

import { Client } from 'pg';

import {
  formatMigrationError,
  MigrationCodedError,
  MigrationExecutionError,
  validateMigrationTarget,
} from './runner';
import {
  createEventContext,
  emitFailure,
  emitStart,
  emitSuccess,
  setEventTarget,
  type MigrationEventContext,
} from './log';
import { assertTargetKind, verifyMigrationRole } from './target';
import { verifyMigration } from './verify';

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
  assertTargetKind({ targetKind: process.env.MIGRATION_TARGET_KIND, mutating: false });

  const historyDirectory = path.resolve(process.cwd(), 'database/migrations');
  const fingerprintPath = path.join(historyDirectory, 'catalog-fingerprint.json');
  try {
    await access(fingerprintPath);
  } catch {
    throw new Error(
      'Catalog fingerprint is not generated yet; complete Phase 1 task 1.3 before verifying',
    );
  }

  const client = new Client({
    connectionString,
    application_name: 'date-management-migration-verify',
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  });

  await client.connect();
  let role: string | undefined;
  let report: Awaited<ReturnType<typeof verifyMigration>> | undefined;
  let verifyError: unknown;
  try {
    role = await verifyMigrationRole(client, process.env.MIGRATION_ROLE);
    report = await verifyMigration(client, fingerprintPath);
  } catch (error) {
    verifyError = error;
  }

  try {
    await client.end();
  } catch (closeError) {
    if (verifyError !== undefined) {
      throw new MigrationExecutionError('Verify failed and connection close also failed', [
        verifyError,
        closeError,
      ]);
    }
    throw closeError;
  }

  if (verifyError !== undefined) throw verifyError;
  if (report === undefined) throw new Error('Verify command finished without a report');

  process.stdout.write(
    `Target: ${target.host}/${target.database} (role: ${role})\n\n${report.report}\n`,
  );
  if (!report.verified) {
    process.exitCode = 1;
    // A failed verification is schema/data drift between the live catalog and the
    // authoritative fingerprint — one of the conditions task 1.10 requires an alert for.
    emitFailure(
      events,
      new MigrationCodedError(
        'Verification failed: live catalog does not match the authoritative fingerprint',
        'catalog-drift',
      ),
    );
    return;
  }
  emitSuccess(events);
}

async function main(): Promise<void> {
  const events = createEventContext('verify');
  try {
    await run(events);
  } catch (error) {
    emitFailure(events, error);
    throw error;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`Verify failed: ${formatMigrationError(error)}\n`);
  process.exitCode = 1;
});
