/**
 * Derived subscription access state (#489).
 *
 * The Worker performed no subscription check on any request path: a lapsed
 * organization kept full entitlements, and the only signal was a client-side
 * banner. Express does gate — but it gates on a `status` enum that a nightly
 * cron keeps current (`trialExpiration.job.ts`, `dunning.job.ts`) plus a live
 * Stripe call for the cancellation window, and the Worker has neither a cron
 * (task 3.1.i) nor a Stripe handler (task 3.8) to maintain it. Reading the
 * stored enum here would gate on a value nothing updates.
 *
 * So the lapse is *derived from dates at request time* instead. Every input is
 * a column that is already written when the subscription is created or changed
 * — `trial_end_date`, and `current_period_end` / `cancel_at_period_end` from
 * migration 0011 — so the answer is current without any writer. That is what
 * decouples status gating from the missing scheduled-job capability.
 *
 * Kept in `workers/src` rather than `shared/`: Express's equivalent computes the
 * same window from a live Stripe client through DI-wired repositories and is
 * deleted in Phase 4, so a shared module would have one real consumer. Task 3.8
 * should adopt this one rather than porting the Express shape.
 */
import { normalizeLaunchTier, type LaunchTier } from './utils/usage-limits';

/** Express's dunning grace before a past-due subscription is downgraded. */
export const DUNNING_GRACE_DAYS = 7;

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** The subscription columns this derivation reads. All optional: the row may not exist. */
export type SubscriptionAccessRow = {
  status?: string | null;
  tier_level?: string | null;
  trial_end_date?: string | Date | null;
  current_period_end?: string | Date | null;
  cancel_at_period_end?: boolean | null;
  past_due_since?: string | Date | null;
};

export type SubscriptionLapseReason =
  | 'trial-expired'
  | 'cancellation-window-elapsed'
  | 'dunning-grace-elapsed';

/**
 * Something the caller should log but not act on. Neither value denies access —
 * both mean "this organization is in a state nobody designed", and silence is
 * how #489 stayed invisible for as long as it did.
 */
export type SubscriptionAnomaly = 'missing-subscription-row' | 'unrecognized-status';

export type SubscriptionAccess = {
  /** Tier to enforce limits against: the stored tier, or `free` once lapsed. */
  effectiveTier: LaunchTier;
  lapsed: boolean;
  reason: SubscriptionLapseReason | null;
  anomaly: SubscriptionAnomaly | null;
};

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Resolve what an organization is entitled to right now.
 *
 * Fails **open** for a state it does not recognize, which is Express's
 * behaviour: `validateOrganizationSubscription` denies on `canceled` and lets
 * every other status through. An unrecognized status is reported as an anomaly
 * rather than treated as a lapse, so a future writer introducing a new status
 * value is visible in the logs instead of silently locking customers out.
 */
export function deriveSubscriptionAccess(
  row: SubscriptionAccessRow | null | undefined,
  now: Date = new Date(),
): SubscriptionAccess {
  if (!row) {
    // A dropped organization.created webhook, not a lapse. Rejecting here would
    // turn one missing row into a total lockout for the organization, so the
    // Worker's existing free-tier fallback stands and the gap is logged.
    return {
      effectiveTier: 'free',
      lapsed: false,
      reason: null,
      anomaly: 'missing-subscription-row',
    };
  }

  const storedTier = normalizeLaunchTier(row.tier_level);
  const status = String(row.status || '')
    .trim()
    .toLowerCase();

  const lapsed = (reason: SubscriptionLapseReason): SubscriptionAccess => ({
    effectiveTier: 'free',
    lapsed: true,
    reason,
    anomaly: null,
  });
  const active = (anomaly: SubscriptionAnomaly | null = null): SubscriptionAccess => ({
    effectiveTier: storedTier,
    lapsed: false,
    reason: null,
    anomaly,
  });

  if (status === 'trialing') {
    const trialEnd = toDate(row.trial_end_date);
    // A trial with no end date cannot be judged expired. Express's job selects
    // on the date being past, so a null there is likewise never downgraded.
    return trialEnd !== null && trialEnd.getTime() <= now.getTime()
      ? lapsed('trial-expired')
      : active();
  }

  if (status === 'canceled' || status === 'cancelled') {
    // The paid-through window: a customer who cancels mid-period keeps what they
    // have already paid for. Express asks Stripe for exactly this pair of
    // values; migration 0011 put both in the row.
    const periodEnd = toDate(row.current_period_end);
    const withinPaidWindow =
      row.cancel_at_period_end === true &&
      periodEnd !== null &&
      periodEnd.getTime() > now.getTime();
    return withinPaidWindow ? active() : lapsed('cancellation-window-elapsed');
  }

  if (status === 'past_due') {
    // Non-payment is not an immediate lapse on either backend — Express keeps
    // serving and lets the dunning job downgrade after the grace period.
    const pastDueSince = toDate(row.past_due_since);
    if (pastDueSince === null) {
      return active();
    }
    const graceEnds = pastDueSince.getTime() + DUNNING_GRACE_DAYS * MILLISECONDS_PER_DAY;
    return now.getTime() > graceEnds ? lapsed('dunning-grace-elapsed') : active();
  }

  if (status === 'active') {
    return active();
  }

  return active('unrecognized-status');
}
