/**
 * Webhook diagnostics (task 3.4).
 *
 * Replaces `backend/scripts/diagnose-webhook.ts`. That script read Prisma
 * models; this reads the tables the Worker actually writes, and is shaped by
 * how the Worker uses them rather than ported line for line:
 *
 *   - `processed_webhook_events` (Stripe) and `clerk_webhook_events` (Clerk)
 *     are claim ledgers. A row is *claimed* when its delivery starts
 *     (`completed_at IS NULL`) and *completed* when the handler finishes. A
 *     claim older than the provider's stale window belongs to a delivery that
 *     died; the next redelivery takes it over. The Express script predates
 *     claims and could only say whether a row existed.
 *   - `webhook_metrics` counts outcomes per event type per UTC day, which is
 *     where handler failures show up — a failed delivery releases its claim,
 *     so the ledgers alone never show one.
 *
 * Everything here only reads. Timestamps in these tables are UTC wall-clock
 * `timestamp` values, so every comparison passes `asOf` as an ISO string cast
 * to `timestamp` and every timestamp comes back as text formatted in SQL — a
 * driver parsing them as local time would shift them by the machine's offset.
 */
import type { MigrationClient } from '../database/migrations/runner';

export type WebhookProvider = 'stripe' | 'clerk';

/**
 * Seconds after which an uncompleted claim is treated as abandoned. These
 * restate `STRIPE_WEBHOOK_STALE_CLAIM_SECONDS` and
 * `CLERK_WEBHOOK_STALE_CLAIM_SECONDS` from the Worker, which this root module
 * cannot import; `workers/src/webhook-diagnostics-constants.node.test.ts`
 * fails if the two drift.
 */
export const STALE_CLAIM_SECONDS: Readonly<Record<WebhookProvider, number>> = {
  stripe: 60,
  clerk: 120,
};

const LEDGER_TABLES: Readonly<Record<WebhookProvider, string>> = {
  stripe: 'processed_webhook_events',
  clerk: 'clerk_webhook_events',
};

const PROVIDERS: readonly WebhookProvider[] = ['stripe', 'clerk'];
const TIMESTAMP_FORMAT = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const MAX_UNCOMPLETED_CLAIMS = 50;

export type ClaimState = 'completed' | 'in_flight' | 'stranded';

export interface WebhookEventRecord {
  provider: WebhookProvider;
  id: string;
  eventType: string;
  processedAt: string;
  completedAt: string | null;
  ageSeconds: number;
  state: ClaimState;
}

interface LedgerRow {
  id: string;
  event_type: string;
  processed_at: string;
  completed_at: string | null;
  age_seconds: number | string;
}

function toEventRecord(provider: WebhookProvider, row: LedgerRow): WebhookEventRecord {
  const ageSeconds = Number(row.age_seconds);
  let state: ClaimState = 'completed';
  if (row.completed_at === null) {
    state = ageSeconds > STALE_CLAIM_SECONDS[provider] ? 'stranded' : 'in_flight';
  }
  return {
    provider,
    id: row.id,
    eventType: row.event_type,
    processedAt: row.processed_at,
    completedAt: row.completed_at,
    ageSeconds,
    state,
  };
}

function ledgerColumns(): string {
  return `id, event_type,
          to_char(processed_at, ${TIMESTAMP_FORMAT}) AS processed_at,
          to_char(completed_at, ${TIMESTAMP_FORMAT}) AS completed_at,
          EXTRACT(EPOCH FROM ($1::timestamp - processed_at))::double precision AS age_seconds`;
}

/** Looks an event id up in both ledgers; an id is normally in at most one. */
export async function findWebhookEvent(
  client: MigrationClient,
  eventId: string,
  asOf: Date,
): Promise<WebhookEventRecord[]> {
  const found: WebhookEventRecord[] = [];
  for (const provider of PROVIDERS) {
    const result = await client.query(
      `SELECT ${ledgerColumns()} FROM ${LEDGER_TABLES[provider]} WHERE id = $2`,
      [asOf.toISOString(), eventId],
    );
    for (const row of result.rows as LedgerRow[]) found.push(toEventRecord(provider, row));
  }
  return found;
}

export interface ProviderHealth {
  provider: WebhookProvider;
  /** Events claimed inside the window. */
  total: number;
  byType: Array<{ eventType: string; count: number }>;
  /** Most recent claim ever recorded, inside the window or not. */
  lastProcessedAt: string | null;
  /** Every uncompleted claim, oldest first, capped — not limited to the window. */
  uncompleted: WebhookEventRecord[];
}

export interface DailyMetric {
  day: string;
  eventType: string;
  total: number;
  failures: number;
}

export interface WebhookHealth {
  asOf: string;
  windowHours: number;
  providers: ProviderHealth[];
  /** `webhook_metrics` rows for the UTC days the window touches, newest first. */
  metrics: DailyMetric[];
}

export async function getWebhookHealth(
  client: MigrationClient,
  options: { asOf: Date; windowHours: number },
): Promise<WebhookHealth> {
  const asOf = options.asOf.toISOString();
  const providers: ProviderHealth[] = [];

  for (const provider of PROVIDERS) {
    const table = LEDGER_TABLES[provider];
    const byType = await client.query(
      `SELECT event_type, COUNT(*)::int AS count
       FROM ${table}
       WHERE processed_at >= $1::timestamp - make_interval(hours => $2::int)
         AND processed_at <= $1::timestamp
       GROUP BY event_type
       ORDER BY count DESC, event_type`,
      [asOf, options.windowHours],
    );
    const last = await client.query(
      `SELECT to_char(MAX(processed_at), ${TIMESTAMP_FORMAT}) AS last_processed_at FROM ${table}`,
    );
    const uncompleted = await client.query(
      `SELECT ${ledgerColumns()}
       FROM ${table}
       WHERE completed_at IS NULL
       ORDER BY processed_at, id
       LIMIT ${MAX_UNCOMPLETED_CLAIMS}`,
      [asOf],
    );

    const typeRows = byType.rows as Array<{ event_type: string; count: number }>;
    providers.push({
      provider,
      total: typeRows.reduce((sum, row) => sum + Number(row.count), 0),
      byType: typeRows.map((row) => ({ eventType: row.event_type, count: Number(row.count) })),
      lastProcessedAt:
        (last.rows[0] as { last_processed_at: string | null } | undefined)?.last_processed_at ??
        null,
      uncompleted: (uncompleted.rows as LedgerRow[]).map((row) => toEventRecord(provider, row)),
    });
  }

  const metrics = await client.query(
    `SELECT to_char(date, 'YYYY-MM-DD') AS day, event_type,
            total_count::int AS total, failure_count::int AS failures
     FROM webhook_metrics
     WHERE date >= date_trunc('day', $1::timestamp - make_interval(hours => $2::int))
       AND date <= $1::timestamp
     ORDER BY date DESC, event_type`,
    [asOf, options.windowHours],
  );

  return {
    asOf,
    windowHours: options.windowHours,
    providers,
    metrics: (
      metrics.rows as Array<{ day: string; event_type: string; total: number; failures: number }>
    ).map((row) => ({
      day: row.day,
      eventType: row.event_type,
      total: Number(row.total),
      failures: Number(row.failures),
    })),
  };
}

export interface OrganizationBilling {
  organizationId: string;
  organizationName: string | null;
  subscription: {
    tierLevel: string;
    status: string;
    billingCycle: string;
    stripeSubscriptionId: string | null;
    stripeCustomerId: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    updatedAt: string;
  } | null;
}

interface BillingRow {
  name: string;
  tier_level: string | null;
  status: string | null;
  billing_cycle: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  updated_at: string | null;
}

/** Returns null when the organization does not exist. */
export async function getOrganizationBilling(
  client: MigrationClient,
  organizationId: string,
): Promise<OrganizationBilling | null> {
  const result = await client.query(
    `SELECT o.name, s.tier_level, s.status, s.billing_cycle, s.stripe_subscription_id,
            s.stripe_customer_id,
            to_char(s.current_period_end, ${TIMESTAMP_FORMAT}) AS current_period_end,
            s.cancel_at_period_end,
            to_char(s.updated_at, ${TIMESTAMP_FORMAT}) AS updated_at
     FROM organizations o
     LEFT JOIN subscription_tiers s ON s.organization_id = o.id
     WHERE o.id = $1`,
    [organizationId],
  );
  const row = result.rows[0] as BillingRow | undefined;
  if (!row) return null;
  return {
    organizationId,
    organizationName: row.name,
    subscription:
      row.tier_level === null || row.status === null
        ? null
        : {
            tierLevel: row.tier_level,
            status: row.status,
            billingCycle: row.billing_cycle ?? '',
            stripeSubscriptionId: row.stripe_subscription_id,
            stripeCustomerId: row.stripe_customer_id,
            currentPeriodEnd: row.current_period_end,
            cancelAtPeriodEnd: row.cancel_at_period_end === true,
            updatedAt: row.updated_at ?? '',
          },
  };
}

export interface StripeSubscriptionSnapshot {
  id: string;
  status: string;
  customerId: string | null;
  /** `metadata.organizationId` on the customer — where the Worker reads the tenant from. */
  customerOrganizationId: string | null;
}

export type FetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Reads one subscription, with its customer expanded, from the Stripe API.
 * The tenant id is read from the customer because that is the only place
 * checkout sets it; a subscription's own metadata is empty.
 */
export async function fetchStripeSubscription(
  secretKey: string,
  subscriptionId: string,
  fetchImpl: FetchLike,
): Promise<StripeSubscriptionSnapshot> {
  const response = await fetchImpl(
    `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=customer`,
    { headers: { Authorization: `Bearer ${secretKey}` } },
  );
  if (!response.ok) {
    throw new Error(`Stripe returned HTTP ${response.status} for subscription ${subscriptionId}`);
  }
  const body = (await response.json()) as {
    id: string;
    status: string;
    customer?: string | { id?: string; metadata?: Record<string, string> } | null;
  };
  const customer = body.customer;
  return {
    id: body.id,
    status: body.status,
    customerId: typeof customer === 'string' ? customer : (customer?.id ?? null),
    customerOrganizationId:
      typeof customer === 'object' && customer !== null
        ? (customer.metadata?.organizationId ?? null)
        : null,
  };
}

/**
 * Problems that stop the Worker attributing this subscription's events to the
 * organization. Status is deliberately not compared: the stored status is
 * allowed to lag Stripe (an expired trial stays `trialing`; access is derived
 * from dates), so a difference there is information, not a fault.
 */
export function compareWithStripe(
  billing: OrganizationBilling,
  stripe: StripeSubscriptionSnapshot,
): string[] {
  const problems: string[] = [];
  const stored = billing.subscription?.stripeCustomerId ?? null;
  if (stored !== null && stripe.customerId !== null && stored !== stripe.customerId) {
    problems.push(
      `Stored stripe_customer_id ${stored} does not match the subscription's customer ${stripe.customerId}`,
    );
  }
  if (stripe.customerOrganizationId === null) {
    problems.push(
      'Stripe customer has no metadata.organizationId; events are attributable only through the stored stripe_customer_id',
    );
  } else if (stripe.customerOrganizationId !== billing.organizationId) {
    problems.push(
      `Stripe customer metadata.organizationId is ${stripe.customerOrganizationId}, not ${billing.organizationId}`,
    );
  }
  return problems;
}

export interface WebhookDiagnosticReport {
  health: WebhookHealth;
  event?: { id: string; records: WebhookEventRecord[] };
  organization?: {
    id: string;
    billing: OrganizationBilling | null;
    stripe?: StripeSubscriptionSnapshot;
    stripeError?: string;
    stripeProblems?: string[];
  };
}

function describeRecord(record: WebhookEventRecord): string {
  const age = `${Math.round(record.ageSeconds)}s ago`;
  if (record.state === 'completed') {
    return `${record.provider} ${record.eventType} — completed ${record.completedAt} (claimed ${record.processedAt})`;
  }
  if (record.state === 'in_flight') {
    return `${record.provider} ${record.eventType} — IN FLIGHT, claimed ${record.processedAt} (${age}); a delivery is still running`;
  }
  return `${record.provider} ${record.eventType} — STRANDED, claimed ${record.processedAt} (${age}) and never completed; the next redelivery takes it over`;
}

/** Renders the report for a terminal. Lines starting `[!]` need attention. */
export function formatWebhookDiagnostics(report: WebhookDiagnosticReport): string {
  const lines: string[] = [];
  const { health } = report;
  lines.push(`Webhook diagnostics as of ${health.asOf} (window: ${health.windowHours}h)`);

  for (const provider of health.providers) {
    lines.push('', `${provider.provider} — ${provider.total} event(s) in window`);
    if (provider.total === 0) {
      lines.push(
        `  [!] No events in window. Last event ever: ${provider.lastProcessedAt ?? 'none'}`,
      );
    }
    for (const row of provider.byType) lines.push(`  ${row.eventType}: ${row.count}`);
    for (const record of provider.uncompleted) {
      const marker = record.state === 'stranded' ? '[!] ' : '';
      lines.push(`  ${marker}${record.id}: ${describeRecord(record)}`);
    }
  }

  lines.push('', 'Handler outcomes (webhook_metrics)');
  if (health.metrics.length === 0) lines.push('  No outcomes recorded for these days.');
  for (const metric of health.metrics) {
    const marker = metric.failures > 0 ? '[!] ' : '';
    lines.push(
      `  ${marker}${metric.day} ${metric.eventType}: ${metric.total} total, ${metric.failures} failed`,
    );
  }

  if (report.event) {
    lines.push('', `Event ${report.event.id}`);
    if (report.event.records.length === 0) {
      lines.push(
        '  [!] Not in either ledger. It was never received, or its handler failed and released the claim.',
        '      Check the provider dashboard for delivery attempts, then the handler outcomes above.',
        `      To redeliver a Stripe event: stripe events resend ${report.event.id}`,
      );
    }
    for (const record of report.event.records) {
      const marker = record.state === 'stranded' ? '[!] ' : '';
      lines.push(`  ${marker}${describeRecord(record)}`);
    }
  }

  if (report.organization) {
    const { billing } = report.organization;
    lines.push('', `Organization ${report.organization.id}`);
    if (billing === null) {
      lines.push('  [!] Organization not found.');
    } else if (billing.subscription === null) {
      lines.push(`  ${billing.organizationName}`, '  [!] No subscription_tiers row.');
    } else {
      const s = billing.subscription;
      lines.push(
        `  ${billing.organizationName}`,
        `  Stored: ${s.tierLevel} / ${s.status} / ${s.billingCycle}, updated ${s.updatedAt}`,
        `  Stripe subscription: ${s.stripeSubscriptionId ?? 'none'}; customer: ${s.stripeCustomerId ?? 'none'}`,
        `  Current period end: ${s.currentPeriodEnd ?? 'none'}; cancel at period end: ${s.cancelAtPeriodEnd}`,
      );
    }
    if (report.organization.stripe) {
      const stripe = report.organization.stripe;
      lines.push(`  Stripe says: ${stripe.status}, customer ${stripe.customerId ?? 'none'}`);
    }
    if (report.organization.stripeError) {
      lines.push(`  [!] Stripe lookup failed: ${report.organization.stripeError}`);
    }
    for (const problem of report.organization.stripeProblems ?? []) {
      lines.push(`  [!] ${problem}`);
    }
  }

  return lines.join('\n');
}
