/**
 * Real-SQL (pglite) coverage for the Stripe webhook — task 3.1.
 *
 * Run by `vitest.node.config.mts` (`npm run test:db`) against an in-process
 * Postgres, because everything worth asserting here is a property of the
 * database rather than of the JavaScript: the claim is a single
 * `INSERT ... ON CONFLICT (id) DO UPDATE ... RETURNING id` whose whole value is
 * what a unique index does with it, and the subscription write is an
 * `ON CONFLICT (organization_id) DO UPDATE` that relies on the constraint
 * migration 0012 added. Mocking `db.sql` would assert the SQL string and nothing
 * it does.
 *
 * As in the Clerk suite, there is deliberately **no** `Promise.all` "concurrent
 * deliveries" test: pglite is a single connection and serializes statements, so
 * such a test would pass whether or not the code is correct — green the harness
 * cannot turn red. What is testable is the decision table the claim implements
 * and the state each event leaves behind.
 *
 * Signatures are real HMACs over the real body, so the handler runs its whole
 * path rather than starting halfway down it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { neon } from '@neondatabase/serverless';
import type { Env } from '../types/env';
import { createPgliteHarness, createTaggedSql, type PgliteHarness } from '../__tests__/pglite-db';

const sqlHolder = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlHolder.current),
}));

import { handleStripeWebhook } from './webhook-handler';

const WEBHOOK_SECRET = 'whsec_local_test_secret';
const ORG = 'org_stripe_1';
const CUSTOMER = 'cus_ABC123';
const SUBSCRIPTION = 'sub_ABC123';

const ENV = {
  NODE_ENV: 'test',
  NEON_CONNECTION_STRING: 'postgres://test',
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
} as unknown as Env;

async function signStripePayload(payload: string, timestamp: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Build a properly signed request, the way Stripe would send it. */
async function stripeRequest(body: unknown, overrides: { signature?: string } = {}) {
  const rawBody = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = overrides.signature ?? (await signStripePayload(rawBody, timestamp));

  return new Request('https://worker.test/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': `t=${timestamp},v1=${signature}`,
    },
    body: rawBody,
  });
}

function subscriptionEvent(options: {
  id: string;
  type: string;
  tier?: string | null;
  status?: string;
  customer?: string | null;
  subscriptionId?: string;
  trialEnd?: number | null;
  currentPeriodEnd?: number | null;
  cancelAtPeriodEnd?: boolean;
  interval?: string;
  metadataOrganizationId?: string;
}) {
  const price: Record<string, unknown> = {
    recurring: { interval: options.interval ?? 'month' },
  };
  if (options.tier !== null) {
    price.metadata = { tier: options.tier ?? 'pro' };
  }

  return {
    id: options.id,
    type: options.type,
    data: {
      object: {
        id: options.subscriptionId ?? SUBSCRIPTION,
        customer: options.customer === undefined ? CUSTOMER : options.customer,
        status: options.status ?? 'active',
        trial_end: options.trialEnd ?? null,
        current_period_end: options.currentPeriodEnd ?? null,
        cancel_at_period_end: options.cancelAtPeriodEnd ?? false,
        metadata: options.metadataOrganizationId
          ? { organizationId: options.metadataOrganizationId }
          : {},
        items: { data: [{ price }] },
      },
    },
  };
}

describe('POST /api/webhooks/stripe', () => {
  let harness: PgliteHarness;
  let sql: ReturnType<typeof createTaggedSql>;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    vi.mocked(neon).mockClear();
    await sql`DELETE FROM processed_webhook_events`;
    await sql`DELETE FROM subscription_tiers`;
    await sql`DELETE FROM organizations`;
    await sql`
      INSERT INTO organizations (id, name, slug)
      VALUES (${ORG}, 'Stripe Org', 'stripe-org')
    `;
  });

  async function subscriptionRow() {
    const rows = await sql`
      SELECT tier_level, status, stripe_customer_id, stripe_subscription_id,
             billing_cycle, trial_end_date, current_period_end,
             cancel_at_period_end, past_due_since
      FROM subscription_tiers
      WHERE organization_id = ${ORG}
    `;
    return rows[0];
  }

  describe('signature and configuration', () => {
    it('refuses a request with no stripe-signature header', async () => {
      const request = new Request('https://worker.test/api/webhooks/stripe', {
        method: 'POST',
        body: '{}',
      });

      const response = await handleStripeWebhook(request, ENV);

      expect(response.status).toBe(400);
      // Nothing may be claimed before the signature is checked.
      expect(await sql`SELECT id FROM processed_webhook_events`).toHaveLength(0);
    });

    it('refuses a forged signature and writes nothing', async () => {
      const request = await stripeRequest(
        subscriptionEvent({ id: 'evt_forged', type: 'customer.subscription.created' }),
        { signature: 'deadbeef'.repeat(8) },
      );

      const response = await handleStripeWebhook(request, ENV);

      expect(response.status).toBe(400);
      expect(await sql`SELECT id FROM processed_webhook_events`).toHaveLength(0);
      expect(await subscriptionRow()).toBeUndefined();
    });

    it('answers 503 while no endpoint secret is configured, without writing', async () => {
      // The receiver ships before task 3.8 registers the Stripe endpoint. 503
      // rather than 500 so Stripe's own retries carry the backlog once the
      // secret is set, instead of the events being dropped.
      const request = await stripeRequest(
        subscriptionEvent({ id: 'evt_unconfigured', type: 'customer.subscription.created' }),
      );

      const response = await handleStripeWebhook(request, {
        ...ENV,
        STRIPE_WEBHOOK_SECRET: undefined,
      } as unknown as Env);

      expect(response.status).toBe(503);
      expect(await sql`SELECT id FROM processed_webhook_events`).toHaveLength(0);
    });

    it('refuses a payload with no event id, having nothing to deduplicate on', async () => {
      const request = await stripeRequest({ type: 'customer.subscription.created', data: {} });

      const response = await handleStripeWebhook(request, ENV);

      expect(response.status).toBe(400);
      expect(await sql`SELECT id FROM processed_webhook_events`).toHaveLength(0);
    });
  });

  describe('subscription state', () => {
    it('writes the subscription a created event describes', async () => {
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      const request = await stripeRequest(
        subscriptionEvent({
          id: 'evt_created',
          type: 'customer.subscription.created',
          tier: 'pro',
          currentPeriodEnd: periodEnd,
          interval: 'year',
          metadataOrganizationId: ORG,
        }),
      );

      const response = await handleStripeWebhook(request, ENV);

      expect(response.status).toBe(200);
      const row = await subscriptionRow();
      // `pro` is Express's spelling. Stored as `professional` because
      // normalizeLaunchTier has no case for `pro` and would read it back as
      // free — the whole reason mapStripePriceTier exists.
      expect(row.tier_level).toBe('professional');
      expect(row.status).toBe('active');
      expect(row.stripe_customer_id).toBe(CUSTOMER);
      expect(row.stripe_subscription_id).toBe(SUBSCRIPTION);
      expect(row.billing_cycle).toBe('annual');
      expect(row.past_due_since).toBeNull();
    });

    it('translates every tier spelling Stripe price metadata may carry', async () => {
      const cases: Array<[string, string]> = [
        ['free', 'free'],
        ['starter', 'starter'],
        ['pro', 'professional'],
        ['premium', 'professional'],
        ['professional', 'professional'],
        ['enterprise', 'enterprise'],
        ['concierge', 'enterprise'],
      ];

      for (const [metadataTier, expected] of cases) {
        await sql`DELETE FROM processed_webhook_events`;
        await sql`DELETE FROM subscription_tiers`;

        const request = await stripeRequest(
          subscriptionEvent({
            id: `evt_tier_${metadataTier}`,
            type: 'customer.subscription.created',
            tier: metadataTier,
            metadataOrganizationId: ORG,
          }),
        );

        const response = await handleStripeWebhook(request, ENV);

        expect(response.status).toBe(200);
        expect((await subscriptionRow()).tier_level).toBe(expected);
      }
    });

    it('keeps the stored tier when price metadata names no recognizable tier', async () => {
      // Express would write `free` here and report success, silently downgrading
      // a paying organization on a metadata typo.
      await sql`
        INSERT INTO subscription_tiers
          (organization_id, tier_level, status, stripe_customer_id, updated_at)
        VALUES (${ORG}, 'enterprise', 'active', ${CUSTOMER}, NOW())
      `;

      const request = await stripeRequest(
        subscriptionEvent({
          id: 'evt_bad_tier',
          type: 'customer.subscription.updated',
          tier: 'platinum-deluxe',
        }),
      );

      const response = await handleStripeWebhook(request, ENV);

      expect(response.status).toBe(200);
      const row = await subscriptionRow();
      expect(row.tier_level).toBe('enterprise');
      // The rest of the event is still recorded — only the tier is withheld.
      expect(row.stripe_subscription_id).toBe(SUBSCRIPTION);
    });

    it('stamps past_due_since on entering dunning and clears it on recovery', async () => {
      const pastDue = await stripeRequest(
        subscriptionEvent({
          id: 'evt_past_due',
          type: 'customer.subscription.updated',
          status: 'past_due',
          metadataOrganizationId: ORG,
        }),
      );
      expect((await handleStripeWebhook(pastDue, ENV)).status).toBe(200);
      const inDunning = await subscriptionRow();
      expect(inDunning.past_due_since).not.toBeNull();

      const recovered = await stripeRequest(
        subscriptionEvent({
          id: 'evt_recovered',
          type: 'customer.subscription.updated',
          status: 'active',
        }),
      );
      expect((await handleStripeWebhook(recovered, ENV)).status).toBe(200);

      // Express clears this only from a nightly dunning job, so a customer who
      // fixed their card stayed lapsed until the cron ran — and this Worker has
      // no cron at all (task 3.1.i).
      expect((await subscriptionRow()).past_due_since).toBeNull();
    });

    it('measures the dunning grace from the first failure, not the latest retry', async () => {
      const firstFailure = await stripeRequest(
        subscriptionEvent({
          id: 'evt_past_due_1',
          type: 'customer.subscription.updated',
          status: 'past_due',
          metadataOrganizationId: ORG,
        }),
      );
      await handleStripeWebhook(firstFailure, ENV);

      // Backdate so a reset would be visible.
      await sql`
        UPDATE subscription_tiers
        SET past_due_since = NOW() - INTERVAL '5 days'
        WHERE organization_id = ${ORG}
      `;
      const before = (await subscriptionRow()).past_due_since;

      const secondFailure = await stripeRequest(
        subscriptionEvent({
          id: 'evt_past_due_2',
          type: 'customer.subscription.updated',
          status: 'past_due',
        }),
      );
      await handleStripeWebhook(secondFailure, ENV);

      // Stripe retries a failed invoice several times. If each retry reset the
      // clock, the 7-day grace would never elapse and a non-paying account would
      // keep full entitlements indefinitely.
      expect((await subscriptionRow()).past_due_since).toEqual(before);
    });

    it('cancels without discarding the tier the customer has paid through', async () => {
      const periodEnd = Math.floor(Date.now() / 1000) + 10 * 24 * 60 * 60;
      await sql`
        INSERT INTO subscription_tiers
          (organization_id, tier_level, status, stripe_customer_id, updated_at)
        VALUES (${ORG}, 'professional', 'active', ${CUSTOMER}, NOW())
      `;

      const request = await stripeRequest(
        subscriptionEvent({
          id: 'evt_deleted',
          type: 'customer.subscription.deleted',
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: true,
        }),
      );

      const response = await handleStripeWebhook(request, ENV);

      expect(response.status).toBe(200);
      const row = await subscriptionRow();
      expect(row.status).toBe('canceled');
      // Express writes 'free' here. In this Worker that would be a live defect:
      // deriveSubscriptionAccess honours the paid-through window by returning
      // the *stored* tier, so writing free would hand the customer a window
      // that grants nothing. The downgrade is derived once the period lapses.
      expect(row.tier_level).toBe('professional');
      expect(row.cancel_at_period_end).toBe(true);
      expect(row.current_period_end).not.toBeNull();
    });

    it('reads the period end from the subscription item when Stripe omits the top-level field', async () => {
      // Stripe moved this field onto items in API version 2025-03-31; which
      // shape arrives depends on the version pinned on the endpoint.
      const periodEnd = Math.floor(Date.now() / 1000) + 20 * 24 * 60 * 60;
      const event = subscriptionEvent({
        id: 'evt_item_period',
        type: 'customer.subscription.created',
        metadataOrganizationId: ORG,
      });
      (event.data.object.items.data[0] as unknown as Record<string, unknown>).current_period_end =
        periodEnd;

      const response = await handleStripeWebhook(await stripeRequest(event), ENV);

      expect(response.status).toBe(200);
      expect((await subscriptionRow()).current_period_end).not.toBeNull();
    });
  });

  describe('organization attribution', () => {
    it('resolves the organization from an existing stripe_customer_id', async () => {
      // No organizationId in the event metadata at all — the local column is the
      // only link, which is what lets this handler avoid calling Stripe's API.
      await sql`
        INSERT INTO subscription_tiers
          (organization_id, tier_level, status, stripe_customer_id, updated_at)
        VALUES (${ORG}, 'starter', 'active', ${CUSTOMER}, NOW())
      `;

      const request = await stripeRequest(
        subscriptionEvent({
          id: 'evt_by_customer',
          type: 'customer.subscription.updated',
          tier: 'enterprise',
        }),
      );

      expect((await handleStripeWebhook(request, ENV)).status).toBe(200);
      expect((await subscriptionRow()).tier_level).toBe('enterprise');
    });

    it('prefers the subscription-id match when the two ids point at different orgs', async () => {
      // Both links are resolved by one query, so the ORDER BY is the only thing
      // deciding which row wins. Without it the answer would be whatever the
      // planner returned first, and the event could land on the wrong tenant.
      await sql`
        INSERT INTO organizations (id, name, slug)
        VALUES ('org_other', 'Other Org', 'other-org')
      `;
      await sql`
        INSERT INTO subscription_tiers
          (organization_id, tier_level, status, stripe_customer_id, updated_at)
        VALUES ('org_other', 'starter', 'active', ${CUSTOMER}, NOW())
      `;
      await sql`
        INSERT INTO subscription_tiers
          (organization_id, tier_level, status, stripe_subscription_id, updated_at)
        VALUES (${ORG}, 'starter', 'active', ${SUBSCRIPTION}, NOW())
      `;

      const request = await stripeRequest(
        subscriptionEvent({
          id: 'evt_precedence',
          type: 'customer.subscription.updated',
          tier: 'enterprise',
        }),
      );

      expect((await handleStripeWebhook(request, ENV)).status).toBe(200);

      expect((await subscriptionRow()).tier_level).toBe('enterprise');
      const other = await sql`
        SELECT tier_level FROM subscription_tiers WHERE organization_id = 'org_other'
      `;
      expect(other[0].tier_level).toBe('starter');
    });

    it('refuses to guess an organization it cannot attribute the event to', async () => {
      const request = await stripeRequest(
        subscriptionEvent({
          id: 'evt_unattributable',
          type: 'customer.subscription.updated',
          customer: 'cus_UNKNOWN',
          subscriptionId: 'sub_UNKNOWN',
        }),
      );

      const response = await handleStripeWebhook(request, ENV);

      // Acknowledged — a redelivery carries the same body, so retrying could
      // only loop — but no row is invented for an organization we cannot name.
      expect(response.status).toBe(200);
      expect(await sql`SELECT id FROM subscription_tiers`).toHaveLength(0);
    });

    it('ignores an organizationId in metadata that names no organization', async () => {
      const request = await stripeRequest(
        subscriptionEvent({
          id: 'evt_bad_metadata_org',
          type: 'customer.subscription.created',
          customer: 'cus_UNKNOWN',
          subscriptionId: 'sub_UNKNOWN',
          metadataOrganizationId: 'org_does_not_exist',
        }),
      );

      const response = await handleStripeWebhook(request, ENV);

      expect(response.status).toBe(200);
      // A value that arrived over the wire is confirmed against `organizations`
      // before it is trusted, so a forged or stale metadata field cannot create
      // subscription state for an organization that does not exist.
      expect(await sql`SELECT id FROM subscription_tiers`).toHaveLength(0);
    });
  });

  describe('idempotency', () => {
    it('claims the event before doing the work, not after', async () => {
      // The claim row must exist and be marked complete; a handler that recorded
      // the marker only after processing would leave the same end state, so the
      // discriminating assertion is the one below on replay.
      const request = await stripeRequest(
        subscriptionEvent({
          id: 'evt_claim',
          type: 'customer.subscription.created',
          metadataOrganizationId: ORG,
        }),
      );
      await handleStripeWebhook(request, ENV);

      const rows = await sql`
        SELECT id, event_type, completed_at FROM processed_webhook_events
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('evt_claim');
      expect(rows[0].event_type).toBe('customer.subscription.created');
      expect(rows[0].completed_at).not.toBeNull();
    });

    it('performs no work on a replay of a completed event', async () => {
      const first = await stripeRequest(
        subscriptionEvent({
          id: 'evt_replay',
          type: 'customer.subscription.created',
          tier: 'pro',
          metadataOrganizationId: ORG,
        }),
      );
      expect((await handleStripeWebhook(first, ENV)).status).toBe(200);

      // Someone changes the tier out of band. A replay that re-ran the handler
      // would overwrite it; a replay that is recognised leaves it alone. This is
      // what distinguishes claim-before-work from mark-after-work.
      await sql`
        UPDATE subscription_tiers SET tier_level = 'enterprise' WHERE organization_id = ${ORG}
      `;

      const replay = await stripeRequest(
        subscriptionEvent({
          id: 'evt_replay',
          type: 'customer.subscription.created',
          tier: 'pro',
          metadataOrganizationId: ORG,
        }),
      );
      expect((await handleStripeWebhook(replay, ENV)).status).toBe(200);

      expect((await subscriptionRow()).tier_level).toBe('enterprise');
      expect(await sql`SELECT id FROM processed_webhook_events`).toHaveLength(1);
    });

    it('asks for a retry rather than acknowledging an event a sibling holds', async () => {
      // A fresh, unfinished claim — exactly what a delivery still in flight
      // leaves behind.
      await sql`
        INSERT INTO processed_webhook_events (id, event_type, processed_at, completed_at)
        VALUES ('evt_in_flight', 'customer.subscription.created', NOW(), NULL)
      `;

      const request = await stripeRequest(
        subscriptionEvent({
          id: 'evt_in_flight',
          type: 'customer.subscription.created',
          metadataOrganizationId: ORG,
        }),
      );

      const response = await handleStripeWebhook(request, ENV);

      // 200 here would end Stripe's retry chain. If the claim holder then died
      // without releasing, nothing would ever re-drive the event.
      expect(response.status).toBe(503);
      expect(await sql`SELECT id FROM subscription_tiers`).toHaveLength(0);
    });

    it('takes over a claim abandoned by a dead isolate', async () => {
      await sql`
        INSERT INTO processed_webhook_events (id, event_type, processed_at, completed_at)
        VALUES ('evt_stale', 'customer.subscription.created', NOW() - INTERVAL '10 minutes', NULL)
      `;

      const request = await stripeRequest(
        subscriptionEvent({
          id: 'evt_stale',
          type: 'customer.subscription.created',
          metadataOrganizationId: ORG,
        }),
      );

      const response = await handleStripeWebhook(request, ENV);

      // Without the staleness window an isolate killed mid-flight would strand
      // its event forever: it can emit no 500 to trigger a retry.
      expect(response.status).toBe(200);
      expect(await subscriptionRow()).toBeDefined();
    });
  });

  describe('unhandled events', () => {
    it('acknowledges an event type it does not act on, without touching subscriptions', async () => {
      const request = await stripeRequest({
        id: 'evt_unhandled',
        type: 'payment_intent.succeeded',
        data: { object: { id: 'pi_1' } },
      });

      const response = await handleStripeWebhook(request, ENV);

      expect(response.status).toBe(200);
      expect(await sql`SELECT id FROM subscription_tiers`).toHaveLength(0);
      // Still claimed and completed, so a redelivery is recognised as a replay
      // rather than re-walking the handler.
      const rows = await sql`SELECT completed_at FROM processed_webhook_events`;
      expect(rows).toHaveLength(1);
      expect(rows[0].completed_at).not.toBeNull();
    });
  });
});
