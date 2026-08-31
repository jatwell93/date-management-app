/**
 * Real-SQL tests for the organization entitlement gate (#489).
 *
 * The Worker ran no subscription check on any request path: a lapsed
 * organization kept full entitlements and only the client-side banner said
 * otherwise. This exercises the gate the way a request reaches it — through
 * `resolveAuthenticatedUser`, which runs the actual joined query against real
 * Postgres — rather than against hand-built rows. That distinction is the point
 * of the file: the derivation itself is unit-tested in `../subscription-status.test.ts`,
 * and what can only be caught here is the query returning a column the gate
 * cannot read.
 *
 * Node project only — see vitest.node.config.mts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveAuthenticatedUser, getOrganizationLaunchTier } from '../index-minimal';
import type { Env } from '../types/env';
import { createPgliteHarness, type PgliteHarness } from './pglite-db';

const ORG = 'org_gated';
const CLERK_USER = 'user_clerk_1';
const DAY = 24 * 60 * 60 * 1000;

let harness: PgliteHarness;

beforeEach(async () => {
  harness = await createPgliteHarness();
});

afterEach(async () => {
  await harness.close();
});

const env = {} as unknown as Env;

function request(method: string): Request {
  return new Request('https://api.test/api/products', { method });
}

function daysFromNow(offset: number): Date {
  return new Date(Date.now() + offset * DAY);
}

async function seedOrganization(options: { creationLocked?: boolean } = {}): Promise<void> {
  await harness.pg.query(
    `INSERT INTO organizations (id, name, slug, is_creation_locked) VALUES ($1, 'Gated Org', 'gated-org', $2)`,
    [ORG, options.creationLocked === true],
  );
  await harness.pg.query(
    `INSERT INTO users (organization_id, clerk_user_id, email, role) VALUES ($1, $2, 'owner@test.dev', 'admin')`,
    [ORG, CLERK_USER],
  );
}

type SubscriptionSeed = {
  status: string;
  tierLevel?: string;
  trialEndDate?: Date | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  pastDueSince?: Date | null;
};

async function seedSubscription(seed: SubscriptionSeed): Promise<void> {
  await harness.pg.query(
    `INSERT INTO subscription_tiers
       (organization_id, tier_level, status, trial_end_date, current_period_end,
        cancel_at_period_end, past_due_since)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      ORG,
      seed.tierLevel ?? 'professional',
      seed.status,
      seed.trialEndDate ?? null,
      seed.currentPeriodEnd ?? null,
      seed.cancelAtPeriodEnd ?? false,
      seed.pastDueSince ?? null,
    ],
  );
}

async function authenticate(method: string): Promise<Response | { organizationId: string }> {
  return (await resolveAuthenticatedUser(request(method), harness.db, CLERK_USER, env, '')) as
    | Response
    | { organizationId: string };
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('organization entitlement gate (real SQL)', () => {
  it('lets an active subscription create, and keeps its tier', async () => {
    await seedOrganization();
    await seedSubscription({ status: 'active', tierLevel: 'professional' });

    const auth = await authenticate('POST');

    // Asserting identity, not merely "not a Response": a gate that returned the
    // wrong organization would still satisfy a truthiness check.
    expect(auth).toMatchObject({ organizationId: ORG });
    expect(await getOrganizationLaunchTier(ORG, harness.db)).toBe('professional');
  });

  it('refuses creation once a trial has expired, and degrades the tier to free', async () => {
    await seedOrganization();
    await seedSubscription({
      status: 'trialing',
      tierLevel: 'professional',
      trialEndDate: daysFromNow(-1),
    });

    const blocked = await authenticate('POST');
    expect(blocked).toBeInstanceOf(Response);
    expect((blocked as Response).status).toBe(403);
    expect(await bodyOf(blocked as Response)).toMatchObject({
      locked: true,
      reason: 'trial-expired',
    });

    // Both halves of the policy: creation is refused *and* the quota the rest of
    // the Worker enforces drops to the free cap.
    expect(await getOrganizationLaunchTier(ORG, harness.db)).toBe('free');
  });

  it('allows the same organization to read and to update', async () => {
    await seedOrganization();
    await seedSubscription({
      status: 'trialing',
      tierLevel: 'professional',
      trialEndDate: daysFromNow(-1),
    });

    // The deliberate softness of the policy: a lapsed customer keeps access to
    // the data they already own. If this ever starts failing, the gate has been
    // widened past what was agreed.
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      expect(await authenticate(method)).toMatchObject({ organizationId: ORG });
    }
  });

  it('holds a trial that has not yet ended', async () => {
    await seedOrganization();
    await seedSubscription({
      status: 'trialing',
      tierLevel: 'professional',
      trialEndDate: daysFromNow(3),
    });

    expect(await authenticate('POST')).toMatchObject({ organizationId: ORG });
    expect(await getOrganizationLaunchTier(ORG, harness.db)).toBe('professional');
  });

  it('keeps a cancelled subscription inside the period it has paid for', async () => {
    await seedOrganization();
    await seedSubscription({
      status: 'canceled',
      tierLevel: 'professional',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: daysFromNow(5),
    });

    expect(await authenticate('POST')).toMatchObject({ organizationId: ORG });
    expect(await getOrganizationLaunchTier(ORG, harness.db)).toBe('professional');
  });

  it('refuses creation once the paid-through period has ended', async () => {
    await seedOrganization();
    await seedSubscription({
      status: 'canceled',
      tierLevel: 'professional',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: daysFromNow(-1),
    });

    const blocked = await authenticate('POST');
    expect((blocked as Response).status).toBe(403);
    expect(await bodyOf(blocked as Response)).toMatchObject({
      reason: 'cancellation-window-elapsed',
    });
    // Reads survive cancellation here, where Express rejects the request
    // outright. Recorded in task 3.1.k as a deliberate divergence.
    expect(await authenticate('GET')).toMatchObject({ organizationId: ORG });
  });

  it('serves a past-due organization through the dunning grace and refuses after it', async () => {
    await seedOrganization();
    await seedSubscription({
      status: 'past_due',
      tierLevel: 'professional',
      pastDueSince: daysFromNow(-3),
    });
    expect(await authenticate('POST')).toMatchObject({ organizationId: ORG });

    await harness.pg.query(`UPDATE subscription_tiers SET past_due_since = $1`, [daysFromNow(-8)]);
    const blocked = await authenticate('POST');
    expect((blocked as Response).status).toBe(403);
    expect(await bodyOf(blocked as Response)).toMatchObject({ reason: 'dunning-grace-elapsed' });
  });

  it('refuses creation for a creation-locked organization whose subscription is fine', async () => {
    // The stored flag and the derived lapse are independent triggers; this one
    // would be allowed by every date-based rule in the module.
    await seedOrganization({ creationLocked: true });
    await seedSubscription({ status: 'active', tierLevel: 'professional' });

    const blocked = await authenticate('POST');
    expect((blocked as Response).status).toBe(403);
    const body = await bodyOf(blocked as Response);
    expect(body.locked).toBe(true);
    expect(String(body.error)).toContain('creation-locked');
    // The lock blocks creation only, exactly as Express's middleware does.
    expect(await authenticate('GET')).toMatchObject({ organizationId: ORG });
  });

  it('treats an organization with no subscription row as free rather than locking it out', async () => {
    await seedOrganization();

    expect(await authenticate('POST')).toMatchObject({ organizationId: ORG });
    expect(await getOrganizationLaunchTier(ORG, harness.db)).toBe('free');
  });

  it('still rejects a caller with no user row', async () => {
    await seedOrganization();
    const response = (await resolveAuthenticatedUser(
      request('GET'),
      harness.db,
      'user_clerk_unknown',
      env,
      '',
    )) as Response;

    expect(response.status).toBe(401);
  });

  it('names the missing subscription row, rather than an unrecognized status', async () => {
    // The join returns a row of NULLs when nothing matches, which reads as a
    // subscription with an empty status unless the join key says otherwise.
    // Decision 4 was "treat as free, but alert" -- an alert naming the wrong
    // problem is the failure this guards.
    await seedOrganization();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await authenticate('POST');
      const records = warn.mock.calls.map((call) => JSON.parse(String(call[0])));
      expect(records).toContainEqual(
        expect.objectContaining({
          event: 'subscription_state_anomaly',
          anomaly: 'missing-subscription-row',
          organizationId: ORG,
        }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('does not report the anomaly again on every read', async () => {
    await seedOrganization();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await authenticate('GET');
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('does not let one organization lapse block another', async () => {
    // The gate reads through a join on the caller's own organization. Seeding a
    // second, lapsed organization proves the predicate is scoped rather than
    // reading whichever subscription row the planner reaches first.
    await seedOrganization();
    await seedSubscription({ status: 'active', tierLevel: 'professional' });
    await harness.pg.query(
      `INSERT INTO organizations (id, name, slug) VALUES ('org_other', 'Other', 'other')`,
    );
    await harness.pg.query(
      `INSERT INTO subscription_tiers (organization_id, tier_level, status, trial_end_date)
       VALUES ('org_other', 'free', 'trialing', $1)`,
      [daysFromNow(-30)],
    );

    expect(await authenticate('POST')).toMatchObject({ organizationId: ORG });
    expect(await getOrganizationLaunchTier(ORG, harness.db)).toBe('professional');
    expect(await getOrganizationLaunchTier('org_other', harness.db)).toBe('free');
  });
});
