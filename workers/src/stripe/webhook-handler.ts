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
  releaseStripeWebhookEventClaim,
  type SqlClient,
  type StripeWebhookClaimOutcome,
} from './stripe-persistence';
import {
  processSubscriptionEvent,
  SUBSCRIPTION_EVENT_TYPES,
  type StripeSubscriptionObject,
} from './subscription-events';
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

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
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

/**
 * Turn a claim we did not win into the response that delivery deserves.
 *
 * `null` means the claim was taken and the caller should do the work.
 *
 * The two outcomes differ in a way worth keeping explicit, because getting it
 * backwards is silent: a *completed* event is a replay of finished work, so 200
 * correctly ends Stripe's retry chain; an *in-flight* event must NOT be
 * acknowledged, because if the claim holder dies without releasing (eviction or
 * runtime kill, with no 500 to trigger a retry) the only thing that can re-drive
 * the event is a later redelivery arriving after the staleness window. A
 * retryable status keeps that delivery alive, and if the sibling succeeds the
 * retry finds `completed` and acknowledges then.
 */
function respondToExistingClaim(
  claim: StripeWebhookClaimOutcome,
  context: { eventId: string; eventType: string },
  env: Env,
  requestOrigin?: string,
): Response | null {
  if (claim === 'completed') {
    console.log('[STRIPE_WEBHOOK] Skipping replay of a completed event', context);
    return jsonResponse({ received: true }, 200, env, requestOrigin);
  }

  if (claim === 'in_flight') {
    console.log('[STRIPE_WEBHOOK] Event claimed by another delivery; asking for a retry', context);
    return errorResponse(
      'Webhook event is already being processed; retry shortly',
      503,
      env,
      requestOrigin,
    );
  }

  return null;
}

/**
 * Apply a claimed event, and hand the claim back if applying it fails.
 *
 * The release is what makes a failure retryable *promptly*: without it the row
 * sits claimed until the staleness window expires, so Stripe's next retry finds
 * the event in flight and is refused rather than re-driving it.
 *
 * A failure to release is swallowed after logging, deliberately. The original
 * processing error is the one worth surfacing, and the claim is not lost either
 * way — the staleness window still frees it, just later.
 */
async function applyClaimedEventOrReleaseClaim(
  sql: SqlClient,
  eventId: string,
  eventType: string,
  event: StripeEventEnvelope,
): Promise<void> {
  try {
    await applyClaimedStripeEvent(sql, eventId, eventType, event);
    await completeStripeWebhookEvent(sql, eventId);
  } catch (processingError) {
    await releaseStripeWebhookEventClaim(sql, eventId).catch((releaseError) => {
      console.error('[STRIPE_WEBHOOK] Failed to release claim after a processing failure', {
        eventId,
        eventType,
        message: releaseError instanceof Error ? releaseError.message : String(releaseError),
      });
    });
    throw processingError;
  }
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

    const alreadyClaimed = respondToExistingClaim(
      claim,
      { eventId, eventType },
      env,
      requestOrigin,
    );

    if (alreadyClaimed) {
      return alreadyClaimed;
    }

    await applyClaimedEventOrReleaseClaim(db.sql, eventId, eventType, event);

    return jsonResponse({ received: true }, 200, env, requestOrigin);
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
