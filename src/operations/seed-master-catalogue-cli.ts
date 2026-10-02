/**
 * Master-catalogue seed CLI entry point (task 3.4, issue #393).
 *
 * Usage:
 *   npm run seed:master-catalogue -- <workbook.xlsx> [--dry-run] [--confirm-retirements]
 *
 * Prints the seed result as JSON on stdout. On failure prints the error as
 * JSON on stderr — including the prospective diff for a workbook that failed
 * validation — and exits non-zero.
 *
 * `--dry-run` only reads and may target any declared target kind. A live run
 * is mutating: it requires a primary target, the dedicated migration role,
 * and for production an explicit seed confirmation, the same contract as
 * `npm run migrate:seed`.
 *
 * Environment variables:
 *   DATABASE_URL_UNPOOLED            — direct PostgreSQL connection string
 *   MIGRATION_ALLOWED_HOST           — required allowlisted hostname
 *   MIGRATION_ALLOWED_DATABASE       — required allowlisted database name
 *   MIGRATION_ENVIRONMENT            — development | test | staging | production
 *   MIGRATION_CONFIRM_PRODUCTION     — "APPLY <host>/<database>" (production only)
 *   MIGRATION_TARGET_KIND            — must be "primary" for a live run
 *   MIGRATION_ROLE                   — dedicated migration role (must match current_user)
 *   MIGRATION_SEED_CONFIRMATION      — "SEED <host>/<database>" (production live run only)
 *   MASTER_CATALOGUE_RETIREMENT_THRESHOLD — optional, 0 to 1, default 0.1
 */
import path from 'node:path';
import { Client } from 'pg';

import { MigrationExecutionError, validateMigrationTarget } from '../database/migrations/runner';
import { validateSeedConfirmation } from '../database/migrations/seed';
import { assertTargetKind, verifyMigrationRole } from '../database/migrations/target';
import {
  CatalogueSeedValidationError,
  resolveRetirementThreshold,
  RetirementThresholdExceeded,
  SAMPLE_WORKBOOK_NAME,
  seedMasterCatalogue,
  type MasterCatalogueSeedResult,
} from './master-catalogue-seed';
import { parseMasterCatalogueWorkbook } from './master-catalogue-workbook';

export interface SeedMasterCatalogueArgs {
  workbookPath: string;
  dryRun: boolean;
  confirmRetirements: boolean;
}

export function parseSeedMasterCatalogueArgs(args: string[]): SeedMasterCatalogueArgs {
  const paths: string[] = [];
  let dryRun = false;
  let confirmRetirements = false;

  for (const arg of args) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--confirm-retirements') confirmRetirements = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else paths.push(arg);
  }

  if (paths.length === 0) throw new Error('A master catalogue workbook path is required');
  if (paths.length !== 1) throw new Error('Provide exactly one workbook path');

  return { workbookPath: paths[0], dryRun, confirmRetirements };
}

/**
 * Refuses to live-seed production from the checked-in 100-row sample: it would
 * retire nearly the whole real catalogue, and `--confirm-retirements` would
 * let it. Matched on file name so a copy of the sample is refused too.
 */
export function assertSafeSeedInvocation(
  args: SeedMasterCatalogueArgs,
  environment: string | undefined,
): void {
  if (
    environment === 'production' &&
    !args.dryRun &&
    path.basename(args.workbookPath).toLowerCase() === SAMPLE_WORKBOOK_NAME
  ) {
    throw new Error('Refusing to live-seed the production catalogue from the sample workbook');
  }
}

export function serializeSeedMasterCatalogueError(error: unknown): Record<string, unknown> {
  if (error instanceof CatalogueSeedValidationError) {
    return { name: error.name, message: error.message, result: error.result };
  }
  if (error instanceof RetirementThresholdExceeded) {
    return {
      name: error.name,
      message: error.message,
      retired: error.retired,
      activeBefore: error.activeBefore,
      proportion: error.proportion,
      threshold: error.threshold,
    };
  }
  return {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
  };
}

async function run(): Promise<void> {
  const args = parseSeedMasterCatalogueArgs(process.argv.slice(2));
  const environment = process.env.MIGRATION_ENVIRONMENT;
  assertSafeSeedInvocation(args, environment);
  const retirementThreshold = resolveRetirementThreshold(
    process.env.MASTER_CATALOGUE_RETIREMENT_THRESHOLD,
  );

  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    throw new Error('DATABASE_URL_UNPOOLED is required');
  }
  const target = validateMigrationTarget(connectionString, {
    allowedHost: process.env.MIGRATION_ALLOWED_HOST,
    allowedDatabase: process.env.MIGRATION_ALLOWED_DATABASE,
    environment,
    productionConfirmation: process.env.MIGRATION_CONFIRM_PRODUCTION,
  });
  assertTargetKind({ targetKind: process.env.MIGRATION_TARGET_KIND, mutating: !args.dryRun });
  if (!args.dryRun) {
    validateSeedConfirmation(
      process.env.MIGRATION_SEED_CONFIRMATION,
      target.host,
      target.database,
      environment,
    );
  }

  // Read the workbook before connecting: a missing or unreadable file should
  // not cost a database session.
  const parsed = await parseMasterCatalogueWorkbook(args.workbookPath);

  const client = new Client({
    connectionString,
    application_name: 'date-management-seed-master-catalogue',
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  });

  await client.connect();
  let result: MasterCatalogueSeedResult | undefined;
  let seedError: unknown;
  try {
    await verifyMigrationRole(client, process.env.MIGRATION_ROLE);
    result = await seedMasterCatalogue(client, parsed, {
      sourceFileName: path.basename(args.workbookPath),
      dryRun: args.dryRun,
      confirmRetirements: args.confirmRetirements,
      retirementThreshold,
    });
  } catch (error) {
    seedError = error;
  }

  try {
    await client.end();
  } catch (closeError) {
    if (seedError !== undefined) {
      throw new MigrationExecutionError('Catalogue seed failed and connection close also failed', [
        seedError,
        closeError,
      ]);
    }
    throw closeError;
  }

  if (seedError !== undefined) throw seedError;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  run().catch((error: unknown) => {
    process.stderr.write(`${JSON.stringify(serializeSeedMasterCatalogueError(error), null, 2)}\n`);
    process.exitCode = 1;
  });
}
