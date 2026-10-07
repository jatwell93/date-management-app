/**
 * `GET /api/subscription/current` and `GET /api/subscription/trial-status` (task 3.2, batch 5b).
 *
 * Express tested these through `subscription.routes.test.ts` with a stubbed service. The Worker
 * reads the `subscription_tiers` row in the handler and shapes the answer there, so these tests drive
 * the real routes with a stubbed database and pin the shaping: status normalization, the trial
 * countdown, which tier an unrecognized value becomes, and the limits reported per tier.
 *
 * The trial-status response carries its own table of limits, separate from the table the write-side
 * caps resolve from (`utils/usage-limits.ts`). The last test compares the two for every launch tier,
 * so the numbers a customer is shown cannot drift from the numbers they are refused against.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveMinimalApiRoute, type MinimalApiRoute } from './minimal-api-routes';
import * as minimalEntrypoint from './index-minimal';
import { authenticateClerkRequest } from './clerk/bootstrap-handler';
import { resolveMaxSkus, resolveMaxUsers } from './utils/usage-limits';
import type { Database } from './database';
import type { Env } from './types/env';

vi.mock('./clerk/bootstrap-handler', () => ({
  authenticateClerkRequest: vi.fn(),
  getClerkAuthorizedParties: vi.fn(() => []),
  handleOrganizationBootstrap: vi.fn().mockResolvedValue(new Response('bootstrap')),
}));

const mockedAuthenticateClerkRequest = vi.mocked(authenticateClerkRequest);
const ENV = {} as Env;
const DAY_MS = 24 * 60 * 60 * 1000;

function routes(): MinimalApiRoute[] {
  return (minimalEntrypoint as typeof minimalEntrypoint & { MINIMAL_API_ROUTES: MinimalApiRoute[] })
    .MINIMAL_API_ROUTES;
}

/** User 7 in `org_123`; `subscription_tiers` answers with `rows`. */
function databaseWithSubscription(rows: Array<Record<string, unknown>>): Database {
  return {
    sql: vi.fn((strings: TemplateStringsArray) =>
      strings.join('').includes('FROM subscription_tiers')
        ? Promise.resolve(rows)
        : Promise.resolve([{ id: 7, organizationId: 'org_123', role: 'admin' }]),
    ),
  } as unknown as Database;
}

async function get(path: string, rows: Array<Record<string, unknown>>) {
  const response = await resolveMinimalApiRoute(routes(), {
    request: new Request(`https://example.com${path}`),
    pathname: path,
    method: 'GET',
    db: databaseWithSubscription(rows),
    env: ENV,
  });
  return { status: response?.status, body: (await response?.json()) as Record<string, any> };
}

const trialStatus = (rows: Array<Record<string, unknown>>) =>
  get('/api/subscription/trial-status', rows);
const current = (rows: Array<Record<string, unknown>>) => get('/api/subscription/current', rows);

const inDays = (days: number) => new Date(Date.now() + days * DAY_MS - 60_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mockedAuthenticateClerkRequest.mockResolvedValue({
    clerkUserId: 'user_clerk_123',
    email: 'user@example.com',
    username: 'user',
    organizationId: 'org_123',
    organizationRole: 'org:admin',
  });
});

describe('GET /api/subscription/current', () => {
  it('reports the tier, status, billing cycle and period of the stored subscription', async () => {
    const periodEnd = '2026-12-01T00:00:00.000Z';

    const { status, body } = await current([
      {
        status: 'ACTIVE',
        tier_level: 'professional',
        billing_cycle: 'annual',
        current_period_end: periodEnd,
        cancel_at_period_end: true,
      },
    ]);

    expect(status).toBe(200);
    expect(body).toEqual({
      tierLevel: 'professional',
      status: 'active',
      billingCycle: 'annual',
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: true,
    });
  });

  it('reports a free, expired subscription for an organization with no row', async () => {
    const { body } = await current([]);

    expect(body).toEqual({
      tierLevel: 'free',
      status: 'expired',
      billingCycle: 'monthly',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });
  });
});

describe('GET /api/subscription/trial-status', () => {
  it('reports no trial and the free limits when the organization has no subscription', async () => {
    const { status, body } = await trialStatus([]);

    expect(status).toBe(200);
    expect(body).toMatchObject({ isInTrial: false, isTrialExpired: false, subscription: null });
    expect(body.tierLimits.maxProducts).toBe(resolveMaxSkus('free', ENV));
  });

  it.each(['TRIALING', 'trialing', 'Trialing'])(
    'treats the status %s as an active trial and counts the days left',
    async (rawStatus) => {
      const { body } = await trialStatus([
        { status: rawStatus, tier_level: 'professional', trial_end_date: inDays(5) },
      ]);

      expect(body).toMatchObject({ isInTrial: true, isTrialExpired: false });
      expect(body.subscription).toMatchObject({ status: 'TRIALING', daysRemaining: 5 });
    },
  );

  it('reports an expired trial once the end date has passed, with no days left', async () => {
    const { body } = await trialStatus([
      { status: 'trialing', tier_level: 'professional', trial_end_date: inDays(-3) },
    ]);

    expect(body).toMatchObject({ isInTrial: false, isTrialExpired: true });
    expect(body.subscription.daysRemaining).toBe(0);
  });

  it('serializes the conversion time when there is one, and null when there is not', async () => {
    const converted = '2026-09-01T10:00:00.000Z';

    const withDate = await trialStatus([
      { status: 'active', tier_level: 'starter', trial_converted_at: converted },
    ]);
    const without = await trialStatus([{ status: 'active', tier_level: 'starter' }]);

    expect(withDate.body.subscription.trialConvertedAt).toBe(converted);
    expect(without.body.subscription.trialConvertedAt).toBeNull();
  });

  it('reports a status it does not recognize as expired, not as a trial', async () => {
    const { body } = await trialStatus([
      { status: 'paused', tier_level: 'professional', trial_end_date: inDays(5) },
    ]);

    expect(body).toMatchObject({ isInTrial: false, isTrialExpired: false });
    expect(body.subscription.status).toBe('EXPIRED');
  });

  it('reads a tier it does not recognize as free, and gives the free limits', async () => {
    const { body } = await trialStatus([{ status: 'active', tier_level: 'custom-enterprise' }]);

    expect(body.subscription.tierLevel).toBe('free');
    expect(body.tierLimits.maxProducts).toBe(resolveMaxSkus('free', ENV));
  });

  it('reads the legacy tier premium as professional', async () => {
    const { body } = await trialStatus([{ status: 'active', tier_level: 'premium' }]);

    expect(body.subscription.tierLevel).toBe('professional');
    expect(body.tierLimits.maxProducts).toBe(resolveMaxSkus('professional', ENV));
  });

  it.each(['free', 'starter', 'professional', 'enterprise'] as const)(
    'shows the same SKU and seat limits for %s that the write-side caps use',
    async (tier) => {
      const { body } = await trialStatus([{ status: 'active', tier_level: tier }]);

      expect(body.tierLimits.maxProducts).toBe(resolveMaxSkus(tier, ENV));
      expect(body.tierLimits.maxUsers).toBe(resolveMaxUsers(tier));
    },
  );
});
