/**
 * Real-SQL (pglite) coverage for checkout from an organization with no subscription row.
 *
 * Every organization gets a `subscription_tiers` row at bootstrap, so a missing row is a state
 * nobody designed. Express created a Stripe customer for it and threw the id away; a later fix
 * refused with a 404, which stopped the customer who was trying to pay. The handler now creates the
 * row first (the same trial row bootstrap grants), so the customer it creates always has somewhere to be recorded. The unit test in
 * `billing-handlers.test.ts` checks the order of the statements; this one checks the rows.
 *
 * Only `fetch` (the Stripe API) is stubbed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../types/env';
import type { Database } from '../database';
import { createPgliteHarness, createTaggedSql, type PgliteHarness } from '../__tests__/pglite-db';
import { handleCreateCheckoutSession } from './billing-handlers';
import { ensureTrialSubscription } from '../clerk/clerk-persistence';

const ORG = 'org_checkout';
const ENV = {
  NODE_ENV: 'production',
  FRONTEND_URL: 'https://app.example.com',
  STRIPE_SECRET_KEY: 'rk_test_restricted',
  STRIPE_STARTER_MONTHLY_PRICE_ID: 'price_starter_monthly_live',
} as unknown as Env;

const checkoutRequest = () =>
  new Request('https://api.example.com/api/subscription/create-checkout-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      priceId: 'price_starter_monthly_live',
      successUrl: 'https://app.example.com/done',
      cancelUrl: 'https://app.example.com/cancel',
    }),
  });

describe('create-checkout-session with no subscription row (real SQL)', () => {
  let harness: PgliteHarness;
  let db: Database;
  let stripeCalls: string[];

  const rows = async () =>
    await harness.pg
      .query(
        `SELECT tier_level, status, stripe_customer_id, trial_end_date IS NOT NULL AS has_trial_end
         FROM subscription_tiers WHERE organization_id = $1`,
        [ORG],
      )
      .then((result) => result.rows as Array<Record<string, unknown>>);

  beforeAll(async () => {
    harness = await createPgliteHarness();
    db = { sql: createTaggedSql(harness.pg) } as unknown as Database;
  }, 30000);

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.pg.query(`DELETE FROM subscription_tiers WHERE organization_id = $1`, [ORG]);
    await harness.pg.query(`DELETE FROM organizations WHERE id = $1`, [ORG]);
    await harness.pg.query(
      `INSERT INTO organizations (id, name, slug, updated_at) VALUES ($1, 'Checkout Org', 'checkout-org', NOW())`,
      [ORG],
    );
    stripeCalls = [];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        stripeCalls.push(String(input));
        const body = String(input).endsWith('/customers')
          ? { id: 'cus_new' }
          : { id: 'cs_1', url: 'https://checkout.stripe.com/c/1' };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('creates the bootstrap trial row holding the new Stripe customer, and answers 200', async () => {
    const response = await handleCreateCheckoutSession(checkoutRequest(), db, ENV, ORG);

    expect(response.status).toBe(200);
    expect(await rows()).toEqual([
      {
        tier_level: 'professional',
        status: 'trialing',
        stripe_customer_id: 'cus_new',
        has_trial_end: true,
      },
    ]);
  });

  it('reuses that customer on the next attempt instead of creating another', async () => {
    await handleCreateCheckoutSession(checkoutRequest(), db, ENV, ORG);
    await handleCreateCheckoutSession(checkoutRequest(), db, ENV, ORG);

    expect(stripeCalls.filter((url) => url.endsWith('/customers'))).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  it('leaves nothing for a redelivered organization.created to suppress: the trial is already recorded once', async () => {
    await handleCreateCheckoutSession(checkoutRequest(), db, ENV, ORG);

    await ensureTrialSubscription(db.sql, ORG);

    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ tier_level: 'professional', status: 'trialing' });
  });

  it('leaves an existing row alone', async () => {
    await harness.pg.query(
      `INSERT INTO subscription_tiers (organization_id, tier_level, status, stripe_customer_id, updated_at)
       VALUES ($1, 'professional', 'trialing', 'cus_existing', NOW())`,
      [ORG],
    );

    const response = await handleCreateCheckoutSession(checkoutRequest(), db, ENV, ORG);

    expect(response.status).toBe(200);
    expect(await rows()).toEqual([
      {
        tier_level: 'professional',
        status: 'trialing',
        stripe_customer_id: 'cus_existing',
        has_trial_end: false,
      },
    ]);
    expect(stripeCalls.filter((url) => url.endsWith('/customers'))).toHaveLength(0);
  });
});
