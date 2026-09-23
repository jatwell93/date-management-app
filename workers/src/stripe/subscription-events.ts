/**
 * What each Stripe subscription event means for this Worker's own state.
 *
 * Split from `webhook-handler.ts` so that the two jobs stay separable: that file
 * decides whether a request is genuine and whether this delivery owns the event,
 * which is the same for every event type; this one decides what a particular
 * event should write, which is where every divergence from Express lives. The
 * two change for entirely different reasons.
 */
import {
  mapStripePriceTier,
  markSubscriptionCanceledFromStripe,
  resolveOrganizationIdForStripeEvent,
  upsertSubscriptionFromStripe,
  type SqlClient,
} from './stripe-persistence';
import type { LaunchTier } from '../utils/usage-limits';

export interface StripeSubscriptionObject {
  id?: unknown;
  customer?: unknown;
  status?: unknown;
  trial_end?: unknown;
  cancel_at_period_end?: unknown;
  current_period_end?: unknown;
  metadata?: Record<string, unknown>;
  items?: {
    data?: Array<{
      price?: {
        metadata?: Record<string, unknown>;
        recurring?: { interval?: unknown };
      };
      current_period_end?: unknown;
    }>;
  };
}

export const SUBSCRIPTION_EVENT_TYPES = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asUnixSeconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Stripe's period end moved from the subscription to its items in the
 * 2025-03-31 API version, and an account can receive either shape depending on
 * the version pinned on the endpoint. Read the subscription-level field first
 * and fall back to the first item, so the Worker is correct on both without the
 * endpoint's API version having to be remembered.
 */
function extractCurrentPeriodEnd(subscription: StripeSubscriptionObject): number | null {
  return (
    asUnixSeconds(subscription.current_period_end) ??
    asUnixSeconds(subscription.items?.data?.[0]?.current_period_end)
  );
}

function extractBillingCycle(subscription: StripeSubscriptionObject): 'monthly' | 'annual' {
  return subscription.items?.data?.[0]?.price?.recurring?.interval === 'year'
    ? 'annual'
    : 'monthly';
}

/** The subscription id and organization an event applies to, once both are known. */
interface AttributedSubscription {
  organizationId: string;
  stripeSubscriptionId: string;
  stripeCustomerId: string | null;
}

/**
 * Work out which organization and subscription an event is about.
 *
 * `null` means the event cannot be attributed and must not be applied. Both
 * refusals are non-recoverable — a Stripe redelivery carries an identical body,
 * so a 5xx would loop without ever succeeding — which is why they are logged
 * here and reported as an absence rather than thrown.
 */
async function attributeSubscriptionEvent(
  sql: SqlClient,
  eventType: string,
  eventId: string,
  subscription: StripeSubscriptionObject,
): Promise<AttributedSubscription | null> {
  const stripeSubscriptionId = asString(subscription.id);
  const stripeCustomerId = asString(subscription.customer);

  if (!stripeSubscriptionId) {
    console.error('[STRIPE_WEBHOOK] Subscription event carries no subscription id', {
      eventId,
      eventType,
    });
    return null;
  }

  const organizationId = await resolveOrganizationIdForStripeEvent(sql, {
    metadataOrganizationId: subscription.metadata?.organizationId,
    stripeSubscriptionId,
    stripeCustomerId,
  });

  if (!organizationId) {
    // Refused rather than guessed. Writing subscription state onto the wrong
    // organization is worse than not writing it, and a genuine mis-registration
    // must be visible instead of absorbed.
    console.error('[STRIPE_WEBHOOK] Could not attribute event to an organization', {
      eventId,
      eventType,
      stripeSubscriptionId,
      stripeCustomerId,
    });
    return null;
  }

  return { organizationId, stripeSubscriptionId, stripeCustomerId };
}

/**
 * Read the tier out of price metadata, logging when the event does not name one.
 *
 * Loud on purpose. Express writes `free` in this situation and reports success,
 * so a typo in Stripe price metadata silently downgrades a paying customer.
 * `null` instead means the write below keeps whatever tier the organization
 * already had; the rest of the event is still worth recording.
 */
function resolveEventTier(
  subscription: StripeSubscriptionObject,
  context: { eventId: string; eventType: string; organizationId: string },
): LaunchTier | null {
  const tier = mapStripePriceTier(subscription.items?.data?.[0]?.price?.metadata?.tier);

  if (tier === null) {
    console.error(
      '[STRIPE_WEBHOOK] Price metadata names no recognizable tier; keeping stored tier',
      context,
    );
  }

  return tier;
}

export async function processSubscriptionEvent(
  sql: SqlClient,
  eventType: string,
  eventId: string,
  subscription: StripeSubscriptionObject,
): Promise<void> {
  const attributed = await attributeSubscriptionEvent(sql, eventType, eventId, subscription);

  if (attributed === null) {
    return;
  }

  const { organizationId, stripeSubscriptionId, stripeCustomerId } = attributed;
  const currentPeriodEndSeconds = extractCurrentPeriodEnd(subscription);
  const cancelAtPeriodEnd = subscription.cancel_at_period_end === true;

  if (eventType === 'customer.subscription.deleted') {
    const canceled = await markSubscriptionCanceledFromStripe(sql, {
      organizationId,
      stripeSubscriptionId,
      currentPeriodEndSeconds,
      cancelAtPeriodEnd,
    });

    if (!canceled) {
      // The organization's row is for a different subscription, so this event
      // is a late delivery about one that has already been superseded. Doing
      // nothing is the correct outcome; saying nothing would not be.
      console.warn('[STRIPE_WEBHOOK] Cancellation skipped: subscription already superseded', {
        eventId,
        organizationId,
        stripeSubscriptionId,
      });
      return;
    }

    console.log('[STRIPE_WEBHOOK] Subscription canceled', {
      eventId,
      organizationId,
      stripeSubscriptionId,
    });
    return;
  }

  const tier = resolveEventTier(subscription, { eventId, eventType, organizationId });

  const synced = await upsertSubscriptionFromStripe(sql, {
    organizationId,
    tier,
    stripeSubscriptionId,
    stripeCustomerId,
    status: asString(subscription.status) ?? 'active',
    billingCycle: extractBillingCycle(subscription),
    trialEndSeconds: asUnixSeconds(subscription.trial_end),
    currentPeriodEndSeconds,
    cancelAtPeriodEnd,
  });

  if (!synced) {
    // The organization is already committed to a different live subscription,
    // so this is a late delivery about one that has been superseded. Leaving
    // the row alone is correct; leaving it unsaid is not.
    console.warn('[STRIPE_WEBHOOK] Sync skipped: organization holds a different subscription', {
      eventId,
      eventType,
      organizationId,
      stripeSubscriptionId,
    });
    return;
  }

  console.log('[STRIPE_WEBHOOK] Subscription synced', {
    eventId,
    eventType,
    organizationId,
    stripeSubscriptionId,
    tier,
  });
}
