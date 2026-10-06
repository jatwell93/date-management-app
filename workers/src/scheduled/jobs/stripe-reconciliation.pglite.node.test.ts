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

  it('brings a diverged tier in line with Stripe', async () => {
    await seedSubscription('org_diverged', {
      tier: 'starter',
      status: 'active',
      stripeSubscriptionId: 'sub_diverged',
    });
    stripeReturns([stripeSub('sub_diverged', 'active', 'pro')]);

    const result = await run();

    expect(result.summary).toMatchObject({ applied: 1, failures: 0 });
    expect(await rowFor('org_diverged')).toMatchObject({
      tier_level: 'professional',
      status: 'active',
    });
  });

  it('reports no divergence, and leaves the row as it was, when local and Stripe agree', async () => {
    await seedSubscription('org_agree', {
      tier: 'professional',
      status: 'active',
      stripeSubscriptionId: 'sub_agree',
    });
    stripeReturns([stripeSub('sub_agree', 'active', 'pro')]);

    const result = await run();

    expect(result.summary).toMatchObject({ divergences: 0, missingInStripe: 0, failures: 0 });
    expect(await rowFor('org_agree')).toMatchObject({
      tier_level: 'professional',
      status: 'active',
    });
  });

  it('counts a status mismatch as a divergence', async () => {
    await seedSubscription('org_mismatch', {
      tier: 'professional',
      status: 'active',
      stripeSubscriptionId: 'sub_mismatch',
    });
    stripeReturns([stripeSub('sub_mismatch', 'past_due', 'pro')]);

    const result = await run();

    expect(result.summary).toMatchObject({ divergences: 1 });
    expect((await rowFor('org_mismatch')).status).toBe('past_due');
  });

  it('cancels a subscription Stripe reports as canceled, keeping the tier it paid for', async () => {
    await seedSubscription('org_canceled', {
      tier: 'professional',
      status: 'active',
      stripeSubscriptionId: 'sub_canceled',
    });
    stripeReturns([stripeSub('sub_canceled', 'canceled', 'pro')]);

    await run();

    expect(await rowFor('org_canceled')).toMatchObject({
      status: 'canceled',
      tier_level: 'professional',
    });
  });

  it('leaves alone a row with no Stripe subscription id, and does not count it', async () => {
    await seedSubscription('org_trial', {
      tier: 'professional',
      status: 'trialing',
      stripeSubscriptionId: null,
    });
    stripeReturns([]);

    const result = await run();

    expect(result.summary).toMatchObject({ localLinked: 0, missingInStripe: 0, applied: 0 });
    expect(await rowFor('org_trial')).toMatchObject({
      status: 'trialing',
      tier_level: 'professional',
    });
  });

  it('reports a linked row Stripe does not know and changes nothing', async () => {
    await seedSubscription('org_missing', {
      tier: 'professional',
      status: 'active',
      stripeSubscriptionId: 'sub_missing',
    });
    stripeReturns([stripeSub('sub_other', 'active', 'pro')]);

    const result = await run();

    expect(result.summary).toMatchObject({ missingInStripe: 1, applied: 0 });
    expect(await rowFor('org_missing')).toMatchObject({
      status: 'active',
      tier_level: 'professional',
    });
  });
});
