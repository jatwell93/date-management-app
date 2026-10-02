/**
 * Webhook diagnostics CLI entry point (task 3.4).
 *
 * Usage:
 *   npm run diagnose:webhook -- [--event-id <id>] [--org <organization-id>] [--hours <n>] [--json]
 *
 * Always reports webhook health for the window (default 24 hours): events per
 * provider and type, uncompleted claims, and handler outcomes. `--event-id`
 * adds the claim state of one Stripe or Clerk event; `--org` adds the
 * organization's stored subscription and, when STRIPE_SECRET_KEY is set,
 * checks it against Stripe.
 *
 * Read-only: the session sets `default_transaction_read_only` before its
 * first query, so the command cannot write whatever it is pointed at. It may target any
 * declared target kind, the same contract as `npm run migrate:status`.
 *
 * Environment variables:
 *   DATABASE_URL_UNPOOLED            — direct PostgreSQL connection string
 *   MIGRATION_ALLOWED_HOST           — required allowlisted hostname
 *   MIGRATION_ALLOWED_DATABASE       — required allowlisted database name
 *   MIGRATION_ENVIRONMENT            — development | test | staging | production
 *   MIGRATION_CONFIRM_PRODUCTION     — "APPLY <host>/<database>" (production only)
 *   MIGRATION_TARGET_KIND            — primary | development | restore-drill
 *   MIGRATION_ROLE                   — dedicated migration role (must match current_user)
 *   STRIPE_SECRET_KEY                — optional; enables the Stripe comparison for --org
 */
import { parseArgs } from 'node:util';
import { Client } from 'pg';

import {
  formatMigrationError,
  MigrationExecutionError,
  validateMigrationTarget,
  type MigrationClient,
} from '../database/migrations/runner';
import { assertTargetKind, verifyMigrationRole } from '../database/migrations/target';
import {
  compareWithStripe,
  fetchStripeSubscription,
  findWebhookEvent,
  formatWebhookDiagnostics,
  getOrganizationBilling,
  getWebhookHealth,
  type FetchLike,
  type WebhookDiagnosticReport,
} from './webhook-diagnostics';

export interface DiagnoseWebhookArgs {
  eventId?: string;
  organizationId?: string;
  windowHours: number;
  json: boolean;
}

const MAX_WINDOW_HOURS = 24 * 90;

export function parseDiagnoseWebhookArgs(args: string[]): DiagnoseWebhookArgs {
  const { values } = parseArgs({
    args,
    options: {
      'event-id': { type: 'string', short: 'e' },
      org: { type: 'string', short: 'o' },
      hours: { type: 'string', default: '24' },
      json: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  const windowHours = Number(values.hours);
  if (!Number.isInteger(windowHours) || windowHours < 1 || windowHours > MAX_WINDOW_HOURS) {
    throw new Error(`--hours must be a whole number between 1 and ${MAX_WINDOW_HOURS}`);
  }
  return {
    eventId: values['event-id'],
    organizationId: values.org,
    windowHours,
    json: values.json === true,
  };
}

export interface DiagnoseWebhookDependencies {
  asOf: Date;
  stripeSecretKey?: string;
  fetchImpl: FetchLike;
}

/**
 * Builds the report. A failed Stripe lookup is recorded in the report rather
 * than thrown: the database half is still worth printing when Stripe is down
 * or the key is wrong.
 */
export async function buildWebhookDiagnosticReport(
  client: MigrationClient,
  args: DiagnoseWebhookArgs,
  dependencies: DiagnoseWebhookDependencies,
): Promise<WebhookDiagnosticReport> {
  const report: WebhookDiagnosticReport = {
    health: await getWebhookHealth(client, {
      asOf: dependencies.asOf,
      windowHours: args.windowHours,
    }),
  };

  if (args.eventId !== undefined) {
    report.event = {
      id: args.eventId,
      records: await findWebhookEvent(client, args.eventId, dependencies.asOf),
    };
  }

  if (args.organizationId !== undefined) {
    const billing = await getOrganizationBilling(client, args.organizationId);
    report.organization = { id: args.organizationId, billing };
    const subscriptionId = billing?.subscription?.stripeSubscriptionId;
    if (billing && subscriptionId && dependencies.stripeSecretKey) {
      try {
        const stripe = await fetchStripeSubscription(
          dependencies.stripeSecretKey,
          subscriptionId,
          dependencies.fetchImpl,
        );
        report.organization.stripe = stripe;
        report.organization.stripeProblems = compareWithStripe(billing, stripe);
      } catch (error) {
        report.organization.stripeError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  return report;
}

async function run(): Promise<void> {
  const args = parseDiagnoseWebhookArgs(process.argv.slice(2));

  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    throw new Error('DATABASE_URL_UNPOOLED is required');
  }
  validateMigrationTarget(connectionString, {
    allowedHost: process.env.MIGRATION_ALLOWED_HOST,
    allowedDatabase: process.env.MIGRATION_ALLOWED_DATABASE,
    environment: process.env.MIGRATION_ENVIRONMENT,
    productionConfirmation: process.env.MIGRATION_CONFIRM_PRODUCTION,
  });
  assertTargetKind({ targetKind: process.env.MIGRATION_TARGET_KIND, mutating: false });

  const client = new Client({
    connectionString,
    application_name: 'date-management-diagnose-webhook',
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  });

  await client.connect();
  let report: WebhookDiagnosticReport | undefined;
  let diagnosticError: unknown;
  try {
    await client.query('SET default_transaction_read_only = on');
    await verifyMigrationRole(client, process.env.MIGRATION_ROLE);
    report = await buildWebhookDiagnosticReport(client, args, {
      asOf: new Date(),
      stripeSecretKey: process.env.STRIPE_SECRET_KEY,
      fetchImpl: (url, init) => fetch(url, init),
    });
  } catch (error) {
    diagnosticError = error;
  }

  try {
    await client.end();
  } catch (closeError) {
    if (diagnosticError !== undefined) {
      throw new MigrationExecutionError('Diagnostics failed and connection close also failed', [
        diagnosticError,
        closeError,
      ]);
    }
    throw closeError;
  }

  if (diagnosticError !== undefined) throw diagnosticError;
  if (report === undefined) throw new Error('Diagnostics finished without a report');
  process.stdout.write(
    `${args.json ? JSON.stringify(report, null, 2) : formatWebhookDiagnostics(report)}\n`,
  );
}

if (require.main === module) {
  run().catch((error: unknown) => {
    process.stderr.write(`Webhook diagnostics failed: ${formatMigrationError(error)}\n`);
    process.exitCode = 1;
  });
}
