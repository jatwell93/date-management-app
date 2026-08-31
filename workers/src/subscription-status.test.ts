/**
 * Derived subscription access state (#489).
 *
 * The states here are the ones Express's two nightly jobs and its auth
 * middleware between them decide: an expired trial, a cancellation inside or
 * outside its paid-through window, and non-payment inside or outside the
 * seven-day dunning grace. The Worker derives all of them from dates instead,
 * so these cases are what stands in for jobs it does not run.
 *
 * The SQL half — that the gate's joined query actually returns these columns —
 * is asserted against real Postgres in `__tests__/subscription-gating.node.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  deriveSubscriptionAccess,
  DUNNING_GRACE_DAYS,
  type SubscriptionAccess,
  type SubscriptionAccessRow,
} from './subscription-status';

const NOW = new Date('2026-08-31T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function at(offsetDays: number): Date {
  return new Date(NOW.getTime() + offsetDays * DAY);
}

/** A subscription row carrying a tier, so each case states only what it is about. */
function derive(row: Partial<SubscriptionAccessRow>): SubscriptionAccess {
  return deriveSubscriptionAccess({ tier_level: 'professional', ...row }, NOW);
}

function expectLapsed(access: SubscriptionAccess, reason: SubscriptionAccess['reason']): void {
  // The whole shape, not just the flag: a lapse that forgot to degrade the tier
  // would still satisfy `lapsed === true`.
  expect(access).toEqual({ effectiveTier: 'free', lapsed: true, reason, anomaly: null });
}

function expectActive(access: SubscriptionAccess, effectiveTier = 'professional'): void {
  expect(access).toEqual({ effectiveTier, lapsed: false, reason: null, anomaly: null });
}

describe('deriveSubscriptionAccess', () => {
  it('treats a missing subscription row as free, not as a lapse', () => {
    // A dropped organization.created webhook must not lock an organization out
    // of the product, so this reports an anomaly instead of denying.
    const access = deriveSubscriptionAccess(undefined, NOW);
    expect(access).toEqual({
      effectiveTier: 'free',
      lapsed: false,
      reason: null,
      anomaly: 'missing-subscription-row',
    });
  });

  it('keeps the stored tier while a subscription is active', () => {
    expectActive(derive({ status: 'active' }));
  });

  describe('trials', () => {
    it('holds while the trial end date is in the future', () => {
      expectActive(derive({ status: 'trialing', trial_end_date: at(1) }));
    });

    it('lapses to free once the trial end date has passed', () => {
      expectLapsed(derive({ status: 'trialing', trial_end_date: at(-1) }), 'trial-expired');
    });

    it('does not lapse a trial that has no end date', () => {
      // Express's job selects on the date being past, so a null is never
      // downgraded there either.
      expectActive(derive({ status: 'trialing', trial_end_date: null }));
    });
  });

  describe('cancellation', () => {
    it('keeps access inside the window the customer has paid for', () => {
      expectActive(
        derive({ status: 'canceled', cancel_at_period_end: true, current_period_end: at(5) }),
      );
    });

    it('lapses once the paid-through period has ended', () => {
      expectLapsed(
        derive({ status: 'canceled', cancel_at_period_end: true, current_period_end: at(-1) }),
        'cancellation-window-elapsed',
      );
    });

    it('lapses immediately when the cancellation was not scheduled for period end', () => {
      // Both halves are required: a future period end alone is not a grant, or
      // an immediately-terminated subscription would keep its entitlements to
      // the end of a period it is no longer in.
      expectLapsed(
        derive({ status: 'canceled', cancel_at_period_end: false, current_period_end: at(5) }),
        'cancellation-window-elapsed',
      );
    });

    it('lapses when there is no period end to fall back on', () => {
      expectLapsed(
        derive({ status: 'canceled', cancel_at_period_end: true }),
        'cancellation-window-elapsed',
      );
    });

    it('accepts the British spelling', () => {
      expect(deriveSubscriptionAccess({ status: 'cancelled' }, NOW).lapsed).toBe(true);
    });
  });

  describe('non-payment', () => {
    it('keeps access inside the dunning grace period', () => {
      expectActive(derive({ status: 'past_due', past_due_since: at(-(DUNNING_GRACE_DAYS - 1)) }));
    });

    it('lapses once the grace period has elapsed', () => {
      expectLapsed(
        derive({ status: 'past_due', past_due_since: at(-(DUNNING_GRACE_DAYS + 1)) }),
        'dunning-grace-elapsed',
      );
    });

    it('does not lapse when nothing recorded when non-payment began', () => {
      expectActive(derive({ status: 'past_due', past_due_since: null }));
    });
  });

  it('fails open on a status it does not recognize, and says so', () => {
    // Express denies on canceled and lets everything else through. A new status
    // value from a future writer must be visible rather than silently locking
    // customers out of creation.
    expect(derive({ status: 'incomplete_expired', tier_level: 'starter' })).toEqual({
      effectiveTier: 'starter',
      lapsed: false,
      reason: null,
      anomaly: 'unrecognized-status',
    });
  });

  it('reads date columns whether the driver returns Date objects or strings', () => {
    // pglite and Neon disagree on this, and a string compared as a Date is the
    // kind of thing that silently never lapses.
    expectLapsed(
      derive({ status: 'trialing', trial_end_date: at(-1).toISOString() }),
      'trial-expired',
    );
    expectLapsed(derive({ status: 'trialing', trial_end_date: at(-1) }), 'trial-expired');
  });

  it('ignores an unparseable date rather than throwing', () => {
    expectActive(derive({ status: 'trialing', trial_end_date: 'not-a-date' }));
  });
});
