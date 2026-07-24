/**
 * Phase 1 task 1.4 — adoption CLI entry point.
 *
 * Usage:
 *   npm run migrate:adopt -- --dry-run    # read-only catalog check + report
 *   npm run migrate:adopt -- --apply      # approved: verify + stamp ledger
 *
 * Environment variables (same as migrate:apply):
 *   DATABASE_URL_UNPOOLED            — direct PostgreSQL connection string
 *   MIGRATION_ALLOWED_HOST           — required allowlisted hostname
 *   MIGRATION_ALLOWED_DATABASE       — required allowlisted database name
 *   MIGRATION_ENVIRONMENT            — development | test | staging | production
 *   MIGRATION_CONFIRM_PRODUCTION     — "APPLY <host>/<database>" (production only)
 *   MIGRATION_DEPLOYMENT_SHA         — git commit SHA for the audit ledger
 *
 * For --apply mode, additionally required:
 *   MIGRATION_ADOPT_CONFIRMATION     — "ADOPT <host>/<database> AT <migration-id>"
 *
 * The --dry-run flag performs read-only catalog checks and emits a reviewable
 * report. No writes to the database — no ledger creation, no stamping.
 *
 * The --apply flag re-runs the same catalog check inside a single REPEATABLE
 * READ transaction and, only if the catalog matches, stamps the schema_migrations
 * ledger with all migration IDs and checksums as 'applied'. An explicit
 * adoption confirmation is required to prevent accidental stamping.
 *
 * Unknown arguments are rejected — a typo such as `--dryrun` is NOT silently
 * treated as authorization to stamp.
 */
import { access } from 'node:fs/promises';
import path from 'node:path';

import { Client } from 'pg';

import { performAdoption, formatMigrationError } from './adopt';
import { loadMigrationHistory, MigrationExecutionError, validateMigrationTarget } from './runner';

const VALID_ARGS = new Set(['--dry-run', '--apply']);

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Reject unknown arguments — a typo must not silently authorize stamping.
  const unknownArgs = args.filter((arg) => !VALID_ARGS.has(arg));
  if (unknownArgs.length > 0) {
    throw new Error(
      `Unknown argument(s): ${unknownArgs.join(', ')}. Valid arguments: --dry-run, --apply`,
    );
  }

  const hasDryRun = args.includes('--dry-run');
  const hasApply = args.includes('--apply');

  if (hasDryRun && hasApply) {
    throw new Error('--dry-run and --apply are mutually exclusive');
  }
  if (!hasDryRun && !hasApply) {
    throw new Error('Either --dry-run or --apply must be specified');
  }

  const mode = hasApply ? 'apply' : 'dry-run';

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
  const deploymentSha = process.env.MIGRATION_DEPLOYMENT_SHA;
  if (!deploymentSha) throw new Error('MIGRATION_DEPLOYMENT_SHA is required');

  const historyDirectory = path.resolve(process.cwd(), 'database/migrations');
  try {
    await access(path.join(historyDirectory, '0000_baseline.up.sql'));
  } catch {
    throw new Error(
      'Canonical baseline is not installed yet; complete Phase 1 task 1.3 before adopting',
    );
  }
  const fingerprintPath = path.join(historyDirectory, 'catalog-fingerprint.json');
  try {
    await access(fingerprintPath);
  } catch {
    throw new Error(
      'Catalog fingerprint is not generated yet; complete Phase 1 task 1.3 before adopting',
    );
  }

  const history = await loadMigrationHistory(historyDirectory);
  const client = new Client({
    connectionString,
    application_name: 'date-management-migration-adopt',
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  });

  await client.connect();
  let report: Awaited<ReturnType<typeof performAdoption>> | undefined;
  let adoptionError: unknown;
  try {
    report = await performAdoption(client, history, {
      deploymentSha,
      mode,
      fingerprintPath,
      adoptionConfirmation: process.env.MIGRATION_ADOPT_CONFIRMATION,
      targetHost: target.host,
      targetDatabase: target.database,
    });
  } catch (error) {
    adoptionError = error;
  }

  try {
    await client.end();
  } catch (closeError) {
    if (adoptionError !== undefined) {
      throw new MigrationExecutionError('Adoption failed and connection close also failed', [
        adoptionError,
        closeError,
      ]);
    }
    throw closeError;
  }

  if (adoptionError !== undefined) throw adoptionError;
  if (report === undefined) throw new Error('Adoption command finished without a report');

  process.stdout.write(`Target: ${target.host}/${target.database}\n\n${report.report}\n`);

  // Exit with non-zero if an approved adoption was refused.
  // Dry-run refusals are informational — the operator reviews the report.
  if (mode === 'apply' && !report.canAdopt) {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`Adoption failed: ${formatMigrationError(error)}\n`);
  process.exitCode = 1;
});
