/**
 * Webhook diagnostics tests (task 3.4). The queries run against pglite with
 * the migrated schema; every row is seeded at an explicit UTC wall-clock time
 * relative to a fixed `AS_OF`, so claim ages and window edges are exact.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test, { after, before, beforeEach } from 'node:test';

import {
  applyPendingMigrations,
  loadMigrationHistory,
  type MigrationClient,
} from '../database/migrations/runner';
import {
  createPgliteMigrationClient,
  type PgliteInstance,
} from '../database/migrations/pglite-client';
import { buildWebhookDiagnosticReport, parseDiagnoseWebhookArgs } from './diagnose-webhook-cli';
import {
  compareWithStripe,
  fetchStripeSubscription,
  findWebhookEvent,
  formatWebhookDiagnostics,
  getOrganizationBilling,
  getWebhookHealth,
  type FetchLike,
  type OrganizationBilling,
} from './webhook-diagnostics';

const AS_OF = new Date('2026-10-02T12:00:00.000Z');

/** UTC wall-clock text for `seconds` before AS_OF, as the Worker's NOW() stores it. */
function ago(seconds: number): string {
  return new Date(AS_OF.getTime() - seconds * 1000).toISOString().replace('Z', '');
}

let pg: PgliteInstance;
let client: MigrationClient;

before(async () => {
  const mod = (await import('@electric-sql/pglite')) as { PGlite: new () => PgliteInstance };
  pg = new mod.PGlite();
  client = createPgliteMigrationClient(pg);
  const history = await loadMigrationHistory(path.resolve('database/migrations'));
  await applyPendingMigrations(client, history, { deploymentSha: 'a'.repeat(40) });
});

after(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec(
    `TRUNCATE processed_webhook_events, clerk_webhook_events, webhook_metrics, organizations
     RESTART IDENTITY CASCADE`,
  );
});

async function insertEvent(
  table: 'processed_webhook_events' | 'clerk_webhook_events',
  id: string,
  eventType: string,
  claimedSecondsAgo: number,
  completed: boolean,
): Promise<void> {
  await pg.query(
    `INSERT INTO ${table} (id, event_type, processed_at, completed_at)
     VALUES ($1, $2, $3::timestamp, $4::timestamp)`,
    [id, eventType, ago(claimedSecondsAgo), completed ? ago(claimedSecondsAgo - 1) : null],
  );
}

async function insertMetric(day: string, eventType: string, total: number, failures: number) {
  await pg.query(
    `INSERT INTO webhook_metrics (event_type, date, total_count, failure_count, created_at)
     VALUES ($1, $2::timestamp, $3, $4, NOW())`,
    [eventType, day, total, failures],
  );
}

async function insertOrganization(id: string, subscription?: Record<string, unknown>) {
  await pg.query(
    `INSERT INTO organizations (id, name, slug, updated_at) VALUES ($1, $2, $1, NOW())`,
    [id, `Name of ${id}`],
  );
  if (!subscription) return;
  await pg.query(
    `INSERT INTO subscription_tiers
       (organization_id, tier_level, status, billing_cycle, stripe_subscription_id,
        stripe_customer_id, current_period_end, cancel_at_period_end, created_at, updated_at)
     VALUES ($1, 'professional', 'active', 'monthly', $2, $3, $4::timestamp, false,
             '2026-09-01 00:00:00'::timestamp, '2026-10-01 08:30:00'::timestamp)`,
    [id, subscription.subscriptionId, subscription.customerId, '2026-11-01 00:00:00'],
  );
}

const HOUR = 3600;

// ===========================================================================
// Claim state
// ===========================================================================

test('classifies a claim by its completion and by its own provider stale window', async () => {
  await insertEvent('processed_webhook_events', 'evt_done', 'invoice.paid', 500, true);
  await insertEvent('processed_webhook_events', 'evt_fresh', 'invoice.paid', 60, false);
  await insertEvent('processed_webhook_events', 'evt_dead', 'invoice.paid', 61, false);
  // 100 seconds is past Stripe's 60-second window but inside Clerk's 120.
  await insertEvent('clerk_webhook_events', 'msg_fresh', 'user.created', 100, false);
  await insertEvent('clerk_webhook_events', 'msg_dead', 'user.created', 121, false);

  const state = async (id: string) =>
    (await findWebhookEvent(client, id, AS_OF)).map((r) => [r.provider, r.state, r.ageSeconds]);

  assert.deepEqual(await state('evt_done'), [['stripe', 'completed', 500]]);
  assert.deepEqual(await state('evt_fresh'), [['stripe', 'in_flight', 60]]);
  assert.deepEqual(await state('evt_dead'), [['stripe', 'stranded', 61]]);
  assert.deepEqual(await state('msg_fresh'), [['clerk', 'in_flight', 100]]);
  assert.deepEqual(await state('msg_dead'), [['clerk', 'stranded', 121]]);
  assert.deepEqual(await state('evt_never_seen'), []);
});

test('returns timestamps as the UTC wall-clock values that were stored', async () => {
  await insertEvent('processed_webhook_events', 'evt_done', 'invoice.paid', 500, true);

  const [record] = await findWebhookEvent(client, 'evt_done', AS_OF);

  assert.equal(record.eventType, 'invoice.paid');
  assert.equal(record.processedAt, '2026-10-02T11:51:40.000Z');
  assert.equal(record.completedAt, '2026-10-02T11:51:41.000Z');
});

// ===========================================================================
// Health
// ===========================================================================

test('counts only events inside the window and still reports the last event ever', async () => {
  await insertEvent('processed_webhook_events', 'evt_1', 'invoice.paid', 1 * HOUR, true);
  await insertEvent('processed_webhook_events', 'evt_2', 'invoice.paid', 23 * HOUR, true);
  await insertEvent('processed_webhook_events', 'evt_3', 'customer.subscription.updated', 5, true);
  await insertEvent('processed_webhook_events', 'evt_old', 'invoice.paid', 25 * HOUR, true);
  await insertEvent('processed_webhook_events', 'evt_future', 'invoice.paid', -HOUR, true);
  await insertEvent('clerk_webhook_events', 'msg_old', 'user.created', 72 * HOUR, true);

  const health = await getWebhookHealth(client, { asOf: AS_OF, windowHours: 24 });
  const [stripe, clerk] = health.providers;

  assert.equal(stripe.provider, 'stripe');
  assert.equal(stripe.total, 3);
  assert.deepEqual(stripe.byType, [
    { eventType: 'invoice.paid', count: 2 },
    { eventType: 'customer.subscription.updated', count: 1 },
  ]);
  assert.equal(clerk.provider, 'clerk');
  assert.equal(clerk.total, 0);
  assert.deepEqual(clerk.byType, []);
  assert.equal(clerk.lastProcessedAt, '2026-09-29T12:00:00.000Z');

  const wider = await getWebhookHealth(client, { asOf: AS_OF, windowHours: 26 });
  assert.equal(wider.providers[0].total, 4);
});

test('lists uncompleted claims oldest first, including ones older than the window', async () => {
  await insertEvent('processed_webhook_events', 'evt_done', 'invoice.paid', 10, true);
  await insertEvent('processed_webhook_events', 'evt_running', 'invoice.paid', 10, false);
  await insertEvent('processed_webhook_events', 'evt_week_old', 'invoice.paid', 168 * HOUR, false);

  const health = await getWebhookHealth(client, { asOf: AS_OF, windowHours: 24 });

  assert.deepEqual(
    health.providers[0].uncompleted.map((record) => [record.id, record.state]),
    [
      ['evt_week_old', 'stranded'],
      ['evt_running', 'in_flight'],
    ],
  );
  assert.deepEqual(health.providers[1].uncompleted, []);
});

test('reports handler outcomes for the UTC days the window touches', async () => {
  await insertMetric('2026-10-02 00:00:00', 'invoice.paid', 12, 2);
  await insertMetric('2026-10-01 00:00:00', 'invoice.paid', 7, 0);
  await insertMetric('2026-09-30 00:00:00', 'invoice.paid', 99, 9);
  await insertMetric('2026-10-03 00:00:00', 'invoice.paid', 1, 1);

  const health = await getWebhookHealth(client, { asOf: AS_OF, windowHours: 24 });

  assert.deepEqual(health.metrics, [
    { day: '2026-10-02', eventType: 'invoice.paid', total: 12, failures: 2 },
    { day: '2026-10-01', eventType: 'invoice.paid', total: 7, failures: 0 },
  ]);
});

// ===========================================================================
// Organization billing and Stripe comparison
// ===========================================================================

test('reads an organization with, without, and missing a subscription', async () => {
  await insertOrganization('org-billed', { subscriptionId: 'sub_1', customerId: 'cus_1' });
  await insertOrganization('org-bare');

  assert.deepEqual(await getOrganizationBilling(client, 'org-billed'), {
    organizationId: 'org-billed',
    organizationName: 'Name of org-billed',
    subscription: {
      tierLevel: 'professional',
      status: 'active',
      billingCycle: 'monthly',
      stripeSubscriptionId: 'sub_1',
      stripeCustomerId: 'cus_1',
      currentPeriodEnd: '2026-11-01T00:00:00.000Z',
      cancelAtPeriodEnd: false,
      updatedAt: '2026-10-01T08:30:00.000Z',
    },
  });
  assert.deepEqual(await getOrganizationBilling(client, 'org-bare'), {
    organizationId: 'org-bare',
    organizationName: 'Name of org-bare',
    subscription: null,
  });
  assert.equal(await getOrganizationBilling(client, 'org-missing'), null);
});

function billing(customerId: string | null): OrganizationBilling {
  return {
    organizationId: 'org-a',
    organizationName: 'A',
    subscription: {
      tierLevel: 'professional',
      status: 'trialing',
      billingCycle: 'monthly',
      stripeSubscriptionId: 'sub_1',
      stripeCustomerId: customerId,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      updatedAt: '',
    },
  };
}

test('flags only what breaks event attribution, never a status difference', () => {
  const stripe = { id: 'sub_1', status: 'active', customerId: 'cus_1' };

  assert.deepEqual(
    compareWithStripe(billing('cus_1'), { ...stripe, customerOrganizationId: 'org-a' }),
    [],
  );
  assert.deepEqual(
    compareWithStripe(billing('cus_other'), { ...stripe, customerOrganizationId: 'org-a' }),
    ["Stored stripe_customer_id cus_other does not match the subscription's customer cus_1"],
  );
  assert.deepEqual(
    compareWithStripe(billing('cus_1'), { ...stripe, customerOrganizationId: 'org-b' }),
    ['Stripe customer metadata.organizationId is org-b, not org-a'],
  );
  assert.deepEqual(compareWithStripe(billing(null), { ...stripe, customerOrganizationId: null }), [
    'Stripe customer has no metadata.organizationId; events are attributable only through the stored stripe_customer_id',
  ]);
});

function fakeFetch(
  status: number,
  body: unknown,
  calls: Array<{ url: string; authorization: string }> = [],
): FetchLike {
  return async (url, init) => {
    calls.push({ url, authorization: init.headers.Authorization });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
}

test('reads a subscription and its expanded customer from Stripe', async () => {
  const calls: Array<{ url: string; authorization: string }> = [];
  const snapshot = await fetchStripeSubscription(
    'sk_test_123',
    'sub_1',
    fakeFetch(
      200,
      {
        id: 'sub_1',
        status: 'active',
        customer: { id: 'cus_1', metadata: { organizationId: 'org-a' } },
      },
      calls,
    ),
  );

  assert.deepEqual(snapshot, {
    id: 'sub_1',
    status: 'active',
    customerId: 'cus_1',
    customerOrganizationId: 'org-a',
  });
  assert.deepEqual(calls, [
    {
      url: 'https://api.stripe.com/v1/subscriptions/sub_1?expand[]=customer',
      authorization: 'Bearer sk_test_123',
    },
  ]);

  const unexpanded = await fetchStripeSubscription(
    'sk_test_123',
    'sub_1',
    fakeFetch(200, { id: 'sub_1', status: 'active', customer: 'cus_1' }),
  );
  assert.equal(unexpanded.customerId, 'cus_1');
  assert.equal(unexpanded.customerOrganizationId, null);

  await assert.rejects(
    () => fetchStripeSubscription('sk_test_123', 'sub_gone', fakeFetch(404, {})),
    /Stripe returned HTTP 404 for subscription sub_gone/,
  );
});

// ===========================================================================
// Report assembly and rendering
// ===========================================================================

const neverFetch: FetchLike = async () => {
  throw new Error('Stripe must not be called');
};

test('builds the report, calling Stripe only with a key and a stored subscription', async () => {
  await insertOrganization('org-billed', { subscriptionId: 'sub_1', customerId: 'cus_1' });
  await insertOrganization('org-bare');
  await insertEvent('processed_webhook_events', 'evt_done', 'invoice.paid', 500, true);
  const args = { windowHours: 24, json: false };

  const plain = await buildWebhookDiagnosticReport(client, args, {
    asOf: AS_OF,
    stripeSecretKey: 'sk_test_123',
    fetchImpl: neverFetch,
  });
  assert.equal(plain.event, undefined);
  assert.equal(plain.organization, undefined);
  assert.equal(plain.health.providers[0].total, 1);

  const noKey = await buildWebhookDiagnosticReport(
    client,
    { ...args, organizationId: 'org-billed', eventId: 'evt_done' },
    { asOf: AS_OF, fetchImpl: neverFetch },
  );
  assert.equal(noKey.event?.records[0].state, 'completed');
  assert.equal(noKey.organization?.billing?.subscription?.stripeSubscriptionId, 'sub_1');
  assert.equal(noKey.organization?.stripe, undefined);

  const noSubscription = await buildWebhookDiagnosticReport(
    client,
    { ...args, organizationId: 'org-bare' },
    { asOf: AS_OF, stripeSecretKey: 'sk_test_123', fetchImpl: neverFetch },
  );
  assert.equal(noSubscription.organization?.billing?.subscription, null);

  const compared = await buildWebhookDiagnosticReport(
    client,
    { ...args, organizationId: 'org-billed' },
    {
      asOf: AS_OF,
      stripeSecretKey: 'sk_test_123',
      fetchImpl: fakeFetch(200, {
        id: 'sub_1',
        status: 'past_due',
        customer: { id: 'cus_1', metadata: { organizationId: 'org-elsewhere' } },
      }),
    },
  );
  assert.equal(compared.organization?.stripe?.status, 'past_due');
  assert.deepEqual(compared.organization?.stripeProblems, [
    'Stripe customer metadata.organizationId is org-elsewhere, not org-billed',
  ]);
});

test('records a failed Stripe lookup in the report instead of losing the database half', async () => {
  await insertOrganization('org-billed', { subscriptionId: 'sub_1', customerId: 'cus_1' });

  const report = await buildWebhookDiagnosticReport(
    client,
    { windowHours: 24, json: false, organizationId: 'org-billed' },
    { asOf: AS_OF, stripeSecretKey: 'sk_test_123', fetchImpl: fakeFetch(401, {}) },
  );

  assert.equal(report.organization?.stripeError, 'Stripe returned HTTP 401 for subscription sub_1');
  assert.equal(report.organization?.billing?.organizationName, 'Name of org-billed');
});

test('renders the report with attention markers on what needs a person', async () => {
  await insertEvent('processed_webhook_events', 'evt_done', 'invoice.paid', 500, true);
  await insertEvent('processed_webhook_events', 'evt_dead', 'invoice.paid', 600, false);
  await insertMetric('2026-10-02 00:00:00', 'invoice.paid', 12, 2);
  await insertMetric('2026-10-02 00:00:00', 'customer.created', 3, 0);

  const report = await buildWebhookDiagnosticReport(
    client,
    { windowHours: 24, json: false, eventId: 'evt_never_seen', organizationId: 'org-missing' },
    { asOf: AS_OF, fetchImpl: neverFetch },
  );

  assert.equal(
    formatWebhookDiagnostics(report),
    [
      'Webhook diagnostics as of 2026-10-02T12:00:00.000Z (window: 24h)',
      '',
      'stripe — 2 event(s) in window',
      '  invoice.paid: 2',
      '  [!] evt_dead: stripe invoice.paid — STRANDED, claimed 2026-10-02T11:50:00.000Z (600s ago) and never completed; the next redelivery takes it over',
      '',
      'clerk — 0 event(s) in window',
      '  [!] No events in window. Last event ever: none',
      '',
      'Handler outcomes (webhook_metrics)',
      '  2026-10-02 customer.created: 3 total, 0 failed',
      '  [!] 2026-10-02 invoice.paid: 12 total, 2 failed',
      '',
      'Event evt_never_seen',
      '  [!] Not in either ledger. It was never received, or its handler failed and released the claim.',
      '      Check the provider dashboard for delivery attempts, then the handler outcomes above.',
      '      To redeliver a Stripe event: stripe events resend evt_never_seen',
      '',
      'Organization org-missing',
      '  [!] Organization not found.',
    ].join('\n'),
  );
});

// ===========================================================================
// CLI arguments
// ===========================================================================

test('parses diagnostic arguments and rejects an unusable window', () => {
  assert.deepEqual(parseDiagnoseWebhookArgs([]), {
    eventId: undefined,
    organizationId: undefined,
    windowHours: 24,
    json: false,
  });
  assert.deepEqual(
    parseDiagnoseWebhookArgs(['-e', 'evt_1', '--org', 'org-a', '--hours', '72', '--json']),
    { eventId: 'evt_1', organizationId: 'org-a', windowHours: 72, json: true },
  );
  for (const hours of ['0', '-1', '1.5', 'day', '2161']) {
    assert.throws(() => parseDiagnoseWebhookArgs([`--hours=${hours}`]), /--hours must be/);
  }
  assert.throws(() => parseDiagnoseWebhookArgs(['--verbose']), /Unknown option/);
  assert.throws(() => parseDiagnoseWebhookArgs(['evt_1']), /positional/i);
});
