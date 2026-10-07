/**
 * Real-SQL (pglite) coverage for the `stripe-reconciliation` job (task 3.2, batch 5b).
 *
 * `stripe-reconciliation.test.ts` stubs the SQL and the webhook path to test paging, divergence
 * logging and failure isolation. This file runs the whole job against a real database so the
 * parts that are SQL are asserted too: which local rows the job considers, and what a Stripe
 * subscription does to the stored row. Express covered the same ground as `stripe-sync.job.test.ts`.
 *
 * Only `fetch` (the Stripe API) is stubbed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../types/env';
import {
  createPgliteHarness,
  createTaggedSql,
  seedOrganization,
  type PgliteHarness,
} from '../../__tests__/pglite-db';
import { stripeReconciliationJob } from './stripe-reconciliation';
import type { SqlClient } from '../schedule';

const ENV = { NODE_ENV: 'test', STRIPE_SECRET_KEY: 'sk_test_local' } as unknown as Env;
const AS_OF = new Date('2026-10-01T01:00:00.000Z');

function stripeSub(id: string, status: string, tier: string, customer = 'cus_x') {
  return {
    id,
    status,
    customer,
    metadata: {},
    items: { data: [{ price: { metadata: { tier }, recurring: { interval: 'month' } } }] },
  };
}

function stripeReturns(subscriptions: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: subscriptions, has_more: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

describe('stripe-reconciliation job (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: SqlClient;

  const run = () => stripeReconciliationJob.run({ env: ENV, sql, asOf: AS_OF });

  const seedSubscription = async (
    org: string,
    options: { tier: string; status: string; stripeSubscriptionId: string | null },
  ) => {
    await seedOrganization(harness.pg, org);
    await sql`
      INSERT INTO subscription_tiers
        (organization_id, tier_level, status, stripe_customer_id, stripe_subscription_id, updated_at)
      VALUES (${org}, ${options.tier}, ${options.status}, ${'cus_' + org},
              ${options.stripeSubscriptionId}, NOW())`;
  };

  const rowFor = async (org: string) =>
    (
      await sql`SELECT tier_level, status, stripe_subscription_id
                FROM subscription_tiers WHERE organization_id = ${org}`
    )[0];

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
  }, 30000);

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await sql`DELETE FROM processed_webhook_events`;
    await sql`DELETE FROM subscription_tiers`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  type Local = { tier: string; status: string; stripeSubscriptionId: string | null };
  type Remote = { id: string; status: string; tier: string };

  const reconcile = async (local: Local, remote: Remote[]) => {
    await seedSubscription('org_under_test', local);
    stripeReturns(remote.map((sub) => stripeSub(sub.id, sub.status, sub.tier)));
    const result = await run();
    return { summary: result.summary, row: await rowFor('org_under_test') };
  };

  it.each<
    [string, Local, Remote[], Record<string, number>, { tier_level: string; status: string }]
  >([
    [
      'brings a diverged tier in line with Stripe',
      { tier: 'starter', status: 'active', stripeSubscriptionId: 'sub_1' },
      [{ id: 'sub_1', status: 'active', tier: 'pro' }],
      { applied: 1, failures: 0 },
      { tier_level: 'professional', status: 'active' },
    ],
    [
      'reports no divergence, and leaves the row as it was, when local and Stripe agree',
      { tier: 'professional', status: 'active', stripeSubscriptionId: 'sub_1' },
      [{ id: 'sub_1', status: 'active', tier: 'pro' }],
      { divergences: 0, missingInStripe: 0, failures: 0 },
      { tier_level: 'professional', status: 'active' },
    ],
    [
      'counts a status mismatch as a divergence',
      { tier: 'professional', status: 'active', stripeSubscriptionId: 'sub_1' },
      [{ id: 'sub_1', status: 'past_due', tier: 'pro' }],
      { divergences: 1 },
      { tier_level: 'professional', status: 'past_due' },
    ],
    [
      'cancels a subscription Stripe reports as canceled, keeping the tier it paid for',
      { tier: 'professional', status: 'active', stripeSubscriptionId: 'sub_1' },
      [{ id: 'sub_1', status: 'canceled', tier: 'pro' }],
      { applied: 1 },
      { tier_level: 'professional', status: 'canceled' },
    ],
    [
      'leaves alone a row with no Stripe subscription id, and does not count it',
      { tier: 'professional', status: 'trialing', stripeSubscriptionId: null },
      [],
      { localLinked: 0, missingInStripe: 0, applied: 0 },
      { tier_level: 'professional', status: 'trialing' },
    ],
    [
      'reports a linked row Stripe does not know and changes nothing',
      { tier: 'professional', status: 'active', stripeSubscriptionId: 'sub_missing' },
      [{ id: 'sub_other', status: 'active', tier: 'pro' }],
      { missingInStripe: 1, applied: 0 },
      { tier_level: 'professional', status: 'active' },
    ],
  ])('%s', async (_label, local, remote, expectedSummary, expectedRow) => {
    const { summary, row } = await reconcile(local, remote);

    expect(summary).toMatchObject(expectedSummary);
    expect(row).toMatchObject(expectedRow);
  });
});
