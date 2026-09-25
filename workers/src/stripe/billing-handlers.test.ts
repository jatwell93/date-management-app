/**
 * Coverage for the three billing handlers ported in task 3.1.p.
 *
 * `fetch` is stubbed rather than the Stripe SDK mocked, because there is no SDK
 * -- the module builds form-encoded requests by hand, so the request *is* the
 * thing under test. Several assertions therefore inspect the outgoing body:
 * `subscription_data[metadata][organizationId]` in particular is the entire
 * point of the checkout fix, and it is invisible from the response.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../database';
import type { Env } from '../types/env';
import {
  handleCancelSubscription,
  handleCreateCheckoutSession,
  handleCreatePortalSession,
} from './billing-handlers';

const ORG = 'org_123';

const baseEnv = () =>
  ({
    NODE_ENV: 'production',
    FRONTEND_URL: 'https://app.example.com',
    STRIPE_SECRET_KEY: 'rk_test_restricted',
    STRIPE_STARTER_MONTHLY_PRICE_ID: 'price_starter_monthly_live',
    STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID: 'price_pro_annual_live',
  }) as unknown as Env;

/** A db whose `sql` tag answers by matching text in the query. */
function makeDb(rowsByFragment: Record<string, unknown[]>, captured: string[] = []): Database {
  return {
    sql: vi.fn((strings: TemplateStringsArray) => {
      const query = strings.join(' ');
      captured.push(query.replace(/\s+/g, ' ').trim());
      const match = Object.entries(rowsByFragment).find(([f]) => query.includes(f));
      return Promise.resolve(match ? match[1] : []);
    }),
  } as unknown as Database;
}

const post = (body: unknown) =>
  new Request('https://api.example.com/api/subscription/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Capture the outgoing Stripe requests and reply with canned JSON. */
function stubStripe(responses: Array<{ status?: number; json: unknown }>) {
  const calls: Array<{ url: string; body: URLSearchParams; headers: Headers }> = [];
  let i = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const spec = responses[Math.min(i, responses.length - 1)];
    i += 1;
    calls.push({
      url: String(input),
      body: new URLSearchParams(String(init?.body ?? '')),
      headers: new Headers(init?.headers as HeadersInit),
    });
    return new Response(JSON.stringify(spec.json), {
      status: spec.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('handleCreateCheckoutSession', () => {
  const validBody = {
    priceId: 'price_starter_monthly_live',
    successUrl: 'https://app.example.com/done',
    cancelUrl: 'https://app.example.com/cancel',
  };

  it('puts organizationId on subscription_data, not only on the session', async () => {
    // The 3.1.m carry-forward and the reason this endpoint was the priority of
    // the four. Session metadata does NOT propagate to the subscription Stripe
    // creates, so Express's version produced `customer.subscription.created`
    // events with no organization -- attributable only by stripe_customer_id,
    // which a genuinely new subscriber does not yet have.
    const calls = stubStripe([{ json: { id: 'cs_1', url: 'https://checkout.stripe.com/c/1' } }]);
    const db = makeDb({
      'FROM subscription_tiers': [
        { id: 7, stripe_customer_id: 'cus_1', stripe_subscription_id: null },
      ],
    });

    const response = await handleCreateCheckoutSession(post(validBody), db, baseEnv(), ORG);

    expect(response.status).toBe(200);
    const body = calls[0].body;
    expect(body.get('subscription_data[metadata][organizationId]')).toBe(ORG);
    // Express's session-level metadata is preserved too.
    expect(body.get('metadata[organizationId]')).toBe(ORG);
    expect(calls[0].url).toBe('https://api.stripe.com/v1/checkout/sessions');
  });

  it('sends an idempotency key and the pinned API version', async () => {
    const calls = stubStripe([{ json: { id: 'cs_1', url: 'https://x' } }]);
    const db = makeDb({
      'FROM subscription_tiers': [
        { id: 7, stripe_customer_id: 'cus_1', stripe_subscription_id: null },
      ],
    });

    await handleCreateCheckoutSession(post(validBody), db, baseEnv(), ORG);

    expect(calls[0].headers.get('Idempotency-Key')).toBeTruthy();
    expect(calls[0].headers.get('Stripe-Version')).toBe('2026-06-24.dahlia');
    expect(calls[0].headers.get('Authorization')).toBe('Bearer rk_test_restricted');
  });

  it('creates and PERSISTS a Stripe customer when the row has none', async () => {
    // Express wrote the id back only `if (subscription)`, so an organization
    // with no subscription row leaked a fresh Stripe customer on every attempt.
    // Here the row exists, so the id must be written.
    const calls = stubStripe([
      { json: { id: 'cus_new' } },
      { json: { id: 'cs_1', url: 'https://x' } },
    ]);
    const queries: string[] = [];
    const db = makeDb(
      {
        'FROM subscription_tiers': [
          { id: 7, stripe_customer_id: null, stripe_subscription_id: null },
        ],
        'FROM organizations': [{ contact_email: 'billing@example.com' }],
      },
      queries,
    );

    const response = await handleCreateCheckoutSession(post(validBody), db, baseEnv(), ORG);

    expect(response.status).toBe(200);
    expect(calls[0].url).toBe('https://api.stripe.com/v1/customers');
    expect(calls[0].body.get('email')).toBe('billing@example.com');
    expect(calls[0].body.get('metadata[organizationId]')).toBe(ORG);
    // The write-back, and it is conditional on the column still being NULL so a
    // concurrent create cannot clobber a customer id someone else just stored.
    const update = queries.find((q) => q.includes('UPDATE subscription_tiers'));
    expect(update).toContain('stripe_customer_id IS NULL');
    // ...and the new id is the one handed to checkout.
    expect(calls[1].body.get('customer')).toBe('cus_new');
  });

  it('omits email entirely when the organization has none', async () => {
    // `toFormBody` must drop null/undefined rather than encode them. Without
    // that guard `String(null)` sends `email=null`, which Stripe accepts and
    // stores as a customer whose email is the four characters "null" -- then
    // every receipt and dunning mail goes nowhere, silently.
    const calls = stubStripe([
      { json: { id: 'cus_new' } },
      { json: { id: 'cs_1', url: 'https://x' } },
    ]);
    const db = makeDb({
      'FROM subscription_tiers': [
        { id: 7, stripe_customer_id: null, stripe_subscription_id: null },
      ],
      'FROM organizations': [{ contact_email: null }],
    });

    await handleCreateCheckoutSession(post(validBody), db, baseEnv(), ORG);

    expect(calls[0].url).toBe('https://api.stripe.com/v1/customers');
    expect(calls[0].body.has('email')).toBe(false);
    expect(String(calls[0].body)).not.toContain('null');
    expect(String(calls[0].body)).not.toContain('undefined');
  });

  it('refuses rather than leaking a customer when no subscription row exists', async () => {
    const calls = stubStripe([{ json: { id: 'cus_new' } }]);
    const db = makeDb({});

    const response = await handleCreateCheckoutSession(post(validBody), db, baseEnv(), ORG);

    expect(response.status).toBe(404);
    // Nothing was created in Stripe -- this is the Express leak, not reproduced.
    expect(calls).toHaveLength(0);
  });

  it('refuses a redirect to a foreign origin before calling Stripe', async () => {
    const calls = stubStripe([{ json: {} }]);
    const db = makeDb({
      'FROM subscription_tiers': [
        { id: 7, stripe_customer_id: 'cus_1', stripe_subscription_id: null },
      ],
    });

    const response = await handleCreateCheckoutSession(
      post({ ...validBody, successUrl: 'https://evil.example/harvest' }),
      db,
      baseEnv(),
      ORG,
    );

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('refuses a price that is not sold here, before calling Stripe', async () => {
    const calls = stubStripe([{ json: {} }]);
    const db = makeDb({
      'FROM subscription_tiers': [
        { id: 7, stripe_customer_id: 'cus_1', stripe_subscription_id: null },
      ],
    });

    const response = await handleCreateCheckoutSession(
      post({ ...validBody, priceId: 'price_some_other_real_price' }),
      db,
      baseEnv(),
      ORG,
    );

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('answers 500, not 400, when no prices are configured', async () => {
    const db = makeDb({
      'FROM subscription_tiers': [
        { id: 7, stripe_customer_id: 'cus_1', stripe_subscription_id: null },
      ],
    });
    const env = {
      ...baseEnv(),
      STRIPE_STARTER_MONTHLY_PRICE_ID: undefined,
      STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID: undefined,
    } as unknown as Env;

    const response = await handleCreateCheckoutSession(post(validBody), db, env, ORG);

    // The deployment is broken, not the request. A 400 would send the customer
    // round in circles fixing an upgrade that was never wrong.
    expect(response.status).toBe(500);
  });

  it('answers 503 when the Stripe key is absent', async () => {
    const db = makeDb({
      'FROM subscription_tiers': [
        { id: 7, stripe_customer_id: 'cus_1', stripe_subscription_id: null },
      ],
    });
    const env = { ...baseEnv(), STRIPE_SECRET_KEY: undefined } as unknown as Env;

    const response = await handleCreateCheckoutSession(post(validBody), db, env, ORG);

    expect(response.status).toBe(503);
  });

  it('varies the idempotency key with the redirect URLs', async () => {
    // The two live callers send the same successUrl and DIFFERENT cancelUrls
    // (TrialUpgradeFlow `/upgrade`, SubscriptionSettingsPage `/settings`).
    // Stripe answers a key reused with a different body with a 409
    // idempotency_error, so a customer abandoning checkout on one page and
    // retrying from the other inside the same minute would have got an opaque
    // 502 instead of a session. Found in review of PR #534.
    const seen: string[] = [];
    for (const cancelUrl of [
      'https://app.example.com/upgrade',
      'https://app.example.com/settings',
    ]) {
      const calls = stubStripe([{ json: { id: 'cs_1', url: 'https://x' } }]);
      const db = makeDb({
        'FROM subscription_tiers': [
          { id: 7, stripe_customer_id: 'cus_1', stripe_subscription_id: null },
        ],
      });
      await handleCreateCheckoutSession(post({ ...validBody, cancelUrl }), db, baseEnv(), ORG);
      seen.push(calls[0].headers.get('Idempotency-Key') ?? '');
    }

    expect(seen[0]).not.toBe(seen[1]);
    // ...and both stay well inside Stripe's 255-character limit.
    for (const key of seen) {
      expect(key.length).toBeLessThan(255);
    }
  });

  it('reuses the idempotency key for an identical repeat submit', async () => {
    // The other half: a genuine double-click must still collapse, or the key
    // buys nothing.
    const seen: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const calls = stubStripe([{ json: { id: 'cs_1', url: 'https://x' } }]);
      const db = makeDb({
        'FROM subscription_tiers': [
          { id: 7, stripe_customer_id: 'cus_1', stripe_subscription_id: null },
        ],
      });
      await handleCreateCheckoutSession(post(validBody), db, baseEnv(), ORG);
      seen.push(calls[0].headers.get('Idempotency-Key') ?? '');
    }

    expect(seen[0]).toBe(seen[1]);
  });

  it('answers 503, not 400, when FRONTEND_URL leaves the allowlist empty', async () => {
    // Without this the allowlist is empty and every absolute redirect -- the
    // frontend's own window.location.origin URLs included -- gets a 400 reading
    // "domain is not allowed", i.e. all three billing endpoints down while
    // blaming the customer. The rest of the Worker tolerates an unset
    // FRONTEND_URL (getCorsHeaders degrades to allow-all), so the failure must
    // name the deployment. Found in review of PR #534.
    const calls = stubStripe([{ json: {} }]);
    const db = makeDb({
      'FROM subscription_tiers': [
        { id: 7, stripe_customer_id: 'cus_1', stripe_subscription_id: null },
      ],
    });
    const env = { ...baseEnv(), FRONTEND_URL: undefined } as unknown as Env;

    const response = await handleCreateCheckoutSession(post(validBody), db, env, ORG);

    expect(response.status).toBe(503);
    expect(calls).toHaveLength(0);
  });

  it('does not forward Stripe error text to the caller', async () => {
    stubStripe([
      { status: 400, json: { error: { message: 'No such price: price_x on account acct_9' } } },
    ]);
    const db = makeDb({
      'FROM subscription_tiers': [
        { id: 7, stripe_customer_id: 'cus_1', stripe_subscription_id: null },
      ],
    });

    const response = await handleCreateCheckoutSession(post(validBody), db, baseEnv(), ORG);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).not.toContain('acct_9');
  });
});

describe('handleCancelSubscription', () => {
  it('cancels at period end and records what Stripe returned', async () => {
    const calls = stubStripe([
      { json: { id: 'sub_1', status: 'active', cancel_at_period_end: true } },
    ]);
    const queries: string[] = [];
    const db = makeDb(
      {
        'FROM subscription_tiers': [
          { id: 7, stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' },
        ],
      },
      queries,
    );

    const response = await handleCancelSubscription(post({}), db, baseEnv(), ORG);

    expect(response.status).toBe(200);
    expect(calls[0].url).toBe('https://api.stripe.com/v1/subscriptions/sub_1');
    expect(calls[0].body.get('cancel_at_period_end')).toBe('true');
    const update = queries.find((q) => q.includes('UPDATE subscription_tiers'));
    // Scoped to the subscription the cancel targeted -- the same guard 3.1.m
    // added after Sentry found a retried deletion cancelling a replaced row.
    expect(update).toContain('stripe_subscription_id =');
    // The tier is NOT downgraded: deriveSubscriptionAccess honours the
    // paid-through window by returning the stored tier.
    expect(update).not.toContain('tier_level');
  });

  it('answers 404 when there is no Stripe subscription to cancel', async () => {
    const calls = stubStripe([{ json: {} }]);
    const db = makeDb({
      'FROM subscription_tiers': [
        { id: 7, stripe_customer_id: 'cus_1', stripe_subscription_id: null },
      ],
    });

    const response = await handleCancelSubscription(post({}), db, baseEnv(), ORG);

    expect(response.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe('handleCreatePortalSession', () => {
  it('opens a portal session and defaults returnUrl to the frontend settings page', async () => {
    const calls = stubStripe([{ json: { url: 'https://billing.stripe.com/p/1' } }]);
    const db = makeDb({
      'FROM subscription_tiers': [
        { id: 7, stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' },
      ],
    });

    const response = await handleCreatePortalSession(post({}), db, baseEnv(), ORG);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ url: 'https://billing.stripe.com/p/1' });
    expect(calls[0].body.get('return_url')).toBe('https://app.example.com/settings');
  });

  it('answers 402, not 404, when there is no billing account', async () => {
    // Express chose 402 deliberately so the frontend can prompt to subscribe
    // rather than render an error.
    const db = makeDb({
      'FROM subscription_tiers': [
        { id: 7, stripe_customer_id: null, stripe_subscription_id: null },
      ],
    });

    const response = await handleCreatePortalSession(post({}), db, baseEnv(), ORG);

    expect(response.status).toBe(402);
  });

  it('refuses a foreign returnUrl', async () => {
    const calls = stubStripe([{ json: {} }]);
    const db = makeDb({
      'FROM subscription_tiers': [
        { id: 7, stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' },
      ],
    });

    const response = await handleCreatePortalSession(
      post({ returnUrl: 'https://evil.example/' }),
      db,
      baseEnv(),
      ORG,
    );

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
