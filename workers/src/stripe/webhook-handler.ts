/**
 * `POST /api/webhooks/stripe` — the Worker's inbound Stripe receiver.
 *
 * Net-new rather than a port: the Worker has only ever handled Clerk webhooks
 * (task 3.1). It is shaped after `../clerk/webhook-handler.ts` — verify, claim,
 * process, complete — because that shape has real-SQL concurrency coverage and a
 * second shape would not inherit it.
 *
 * **Which events do something.** Only `customer.subscription.created`,
 * `.updated` and `.deleted`. Those three carry the authoritative subscription
 * object, and between them they write every column the Worker actually reads to
 * decide entitlement: `tier_level`, `status`, `trial_end_date`,
 * `current_period_end`, `cancel_at_period_end` and `past_due_since`
 * (`subscription-status.ts`). Every other event type is acknowledged and logged
 * without side effects.
 *
 * That is narrower than Express, which also handles `checkout.session.completed`,
 * `invoice.payment_failed`, `customer.subscription.trial_will_end` and two
 * `payment_intent.*` events. The four omissions are deliberate and each has a
 * reason, not a backlog entry:
 *
 * - `checkout.session.completed` — in subscription mode Stripe *always* follows
 *   it with `customer.subscription.created` carrying the same state. Express
 *   writes the tier from both, so the two races on one row; handling only the
 *   subscription event removes the race rather than ordering it.
 * - `invoice.payment_failed` — Stripe moves the subscription to `past_due` and
 *   sends `customer.subscription.updated`. The status carries the fact, and
 *   deriving `past_due_since` from it (see `upsertSubscriptionFromStripe`) also
 *   fixes Express's other half: Express *sets* the column from this event but
 *   *clears* it only from a nightly dunning job, so a customer who fixes their
 *   card stays in dunning until that cron next runs — and this Worker has no
 *   cron (task 3.1.i).
 * - `customer.subscription.trial_will_end` — Express sends a reminder email. It
 *   changes no state anything reads. The email is a capability decision, not
 *   part of this receiver.
 * - `payment_intent.succeeded` / `.payment_failed` — Express writes audit rows.
 *   No entitlement depends on them.
 *
 * A future event type does not need code here to be safe: unhandled events are
 * acknowledged, so Stripe stops retrying, and logged, so adding one is a
 * decision someone makes from evidence rather than a silent drop.
 *
 * **This handler is inert until an endpoint is registered.** Without
 * `STRIPE_WEBHOOK_SECRET` it answers 503 and writes nothing. Registering the
 * Stripe endpoint, the shadow verification and the monitored cutover are task
 * 3.8, which is explicit that the currently registered production endpoint and
 * the rollback target must be recorded before that switch is thrown.
 */
import { createWorkersDatabase } from '../database';
import type { Env } from '../types/env';
import { errorResponse, jsonResponse } from '../utils/worker-response';
import {
  claimStripeWebhookEvent,
  completeStripeWebhookEvent,
  mapStripePriceTier,
  markSubscriptionCanceledFromStripe,
  releaseStripeWebhookEventClaim,
  resolveOrganizationIdForStripeEvent,
  upsertSubscriptionFromStripe,
  type SqlClient,
} from './stripe-persistence';
import type { LaunchTier } from '../utils/usage-limits';
import { verifyStripeSignature } from './webhook-signature';

/**
 * The parts of a Stripe event this handler reads.
 *
 * Hand-written rather than imported from `stripe` — see `webhook-signature.ts`
 * for why the SDK is not a dependency here. Everything is optional because this
 * is parsed from the wire; the handler checks what it needs and refuses what it
 * cannot attribute.
 */
interface StripeEventEnvelope {
  id?: unknown;
  type?: unknown;
  data?: { object?: StripeSubscriptionObject };
}

interface StripeSubscriptionObject {
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

const SUBSCRIPTION_EVENT_TYPES = new Set([
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

/**
 * Apply one `customer.subscription.*` event.
 *
 * Returns normally for every outcome, including the two refusals below, because
 * both are *non-recoverable*: a Stripe redelivery carries an identical body, so
 * a 5xx would loop forever without ever succeeding. The caller therefore
 * acknowledges the event and the error is carried by the log line — the same
 * judgement Express encodes in `isNonRecoverableStripeWebhookError`.
 */
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

async function processSubscriptionEvent(
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
    await markSubscriptionCanceledFromStripe(sql, {
      organizationId,
      stripeSubscriptionId,
      currentPeriodEndSeconds,
      cancelAtPeriodEnd,
    });

    console.log('[STRIPE_WEBHOOK] Subscription canceled', {
      eventId,
      organizationId,
      stripeSubscriptionId,
    });
    return;
  }

  const tier = resolveEventTier(subscription, { eventId, eventType, organizationId });

  await upsertSubscriptionFromStripe(sql, {
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

  console.log('[STRIPE_WEBHOOK] Subscription synced', {
    eventId,
    eventType,
    organizationId,
    stripeSubscriptionId,
    tier,
  });
}

interface AcceptedStripeEvent {
  event: StripeEventEnvelope;
  eventId: string;
  eventType: string;
}

/**
 * Everything that must succeed before the event is allowed to touch the
 * database: configuration, signature, payload, idempotency key.
 *
 * Returns a `Response` for every refusal, following the same `Response | value`
 * idiom `authenticateApiRequest` uses, so the caller stays a straight line and
 * no refusal can be mistaken for a parsed event.
 */
async function acceptStripeEvent(
  request: Request,
  env: Env,
  requestOrigin?: string,
): Promise<AcceptedStripeEvent | Response> {
  const signatureHeader = request.headers.get('stripe-signature') || '';

  if (!signatureHeader) {
    return errorResponse('Missing stripe-signature header', 400, env, requestOrigin);
  }

  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    // 503, not 500: the receiver is deployed but no endpoint has been registered
    // against it yet (task 3.8). A retryable status is right — once the secret
    // is set, Stripe's own retries deliver the backlog rather than dropping it.
    console.error('[STRIPE_WEBHOOK] STRIPE_WEBHOOK_SECRET is not configured');
    return errorResponse('Stripe webhooks are not configured', 503, env, requestOrigin);
  }

  // Read the body as text exactly once, before parsing. The signature covers the
  // raw bytes, so re-serializing parsed JSON would change the whitespace and
  // fail verification -- this is what Express needs `express.raw()` for.
  const rawBody = await request.text();

  try {
    await verifyStripeSignature(rawBody, signatureHeader, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Signature verification failed';
    console.error('[STRIPE_WEBHOOK] Signature verification failed', { message });
    return errorResponse(message, 400, env, requestOrigin);
  }

  let event: StripeEventEnvelope;
  try {
    event = JSON.parse(rawBody) as StripeEventEnvelope;
  } catch {
    return errorResponse('Invalid webhook payload', 400, env, requestOrigin);
  }

  const eventId = asString(event.id);

  if (!eventId) {
    // Without an id there is no idempotency key, and processing an event that
    // cannot be deduplicated is how double side effects happen.
    return errorResponse('Webhook payload has no event id', 400, env, requestOrigin);
  }

  return { event, eventId, eventType: asString(event.type) ?? 'unknown' };
}

/**
 * Apply an event that has already been verified and claimed.
 *
 * Split out so the claim/release bookkeeping in the caller is not interleaved
 * with the decision about what each event type means.
 */
async function applyClaimedStripeEvent(
  sql: SqlClient,
  eventId: string,
  eventType: string,
  event: StripeEventEnvelope,
): Promise<void> {
  if (!SUBSCRIPTION_EVENT_TYPES.has(eventType)) {
    // Acknowledged, not dropped silently. An event type nobody has decided
    // about should be visible in the logs, so that adding a handler is a
    // decision made from evidence.
    console.log('[STRIPE_WEBHOOK] Unhandled event type acknowledged', { eventId, eventType });
    return;
  }

  const subscription = event.data?.object;

  if (!subscription) {
    console.error('[STRIPE_WEBHOOK] Subscription event carries no object', { eventId, eventType });
    return;
  }

  await processSubscriptionEvent(sql, eventType, eventId, subscription);
}

export async function handleStripeWebhook(
  request: Request,
  env: Env,
  requestOrigin?: string,
): Promise<Response> {
  const accepted = await acceptStripeEvent(request, env, requestOrigin);

  if (accepted instanceof Response) {
    return accepted;
  }

  const { event, eventId, eventType } = accepted;

  try {
    const db = createWorkersDatabase(env);

    // Claim the event *before* doing the work. Stripe delivers at least once and
    // retries on timeout or 5xx, so concurrent redelivery of one event id is the
    // expected case; claiming afterwards -- Express's order -- deduplicates the
    // marker row while the side effects still run twice (issue #472's shape).
    const claim = await claimStripeWebhookEvent(db.sql, eventId, eventType);

    if (claim === 'completed') {
      // A replay of work that finished. Acknowledging ends the retry chain,
      // which is exactly right: there is nothing left to do for this event.
      console.log('[STRIPE_WEBHOOK] Skipping replay of a completed event', {
        eventId,
        eventType,
      });
      return jsonResponse({ received: true }, 200, env, requestOrigin);
    }

    if (claim === 'in_flight') {
      // A sibling delivery holds the claim. This must NOT be acknowledged: a 200
      // ends Stripe's retry chain for this delivery, and if the claim holder dies
      // without releasing (eviction, runtime kill -- no 500 to retry), the only
      // thing that can re-drive the event is a later redelivery arriving after
      // the staleness window. A retryable status keeps the delivery alive; if the
      // sibling succeeds, the retry finds `completed` and acknowledges then.
      console.log('[STRIPE_WEBHOOK] Event claimed by another delivery; asking for a retry', {
        eventId,
        eventType,
      });
      return errorResponse(
        'Webhook event is already being processed; retry shortly',
        503,
        env,
        requestOrigin,
      );
    }

    try {
      await applyClaimedStripeEvent(db.sql, eventId, eventType, event);
      await completeStripeWebhookEvent(db.sql, eventId);
      return jsonResponse({ received: true }, 200, env, requestOrigin);
    } catch (processingError) {
      // Release the claim so Stripe's next retry re-drives the event at once
      // rather than waiting out the staleness window.
      await releaseStripeWebhookEventClaim(db.sql, eventId).catch((releaseError) => {
        console.error('[STRIPE_WEBHOOK] Failed to release claim after a processing failure', {
          eventId,
          eventType,
          message: releaseError instanceof Error ? releaseError.message : String(releaseError),
        });
      });
      throw processingError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[STRIPE_WEBHOOK] Error processing webhook event', {
      eventId,
      eventType,
      message,
    });
    // 500 so Stripe retries. The claim has already been released above, so the
    // retry re-drives the event rather than finding it in flight.
    return errorResponse('Error processing webhook event', 500, env, requestOrigin);
  }
}
