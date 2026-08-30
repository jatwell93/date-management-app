import { createWorkersDatabase } from '../database';
import type { Env } from '../types/env';
import { errorResponse, jsonResponse } from '../utils/worker-response';
import {
  claimClerkWebhookEvent,
  completeClerkWebhookEvent,
  processClerkWebhookEvent,
  releaseClerkWebhookEventClaim,
  type ClerkWebhookEventPayload,
} from './clerk-persistence';
import { verifyClerkSvixSignature, type ClerkWebhookHeaders } from './webhook-signature';

export async function handleClerkWebhook(
  request: Request,
  env: Env,
  requestOrigin?: string,
): Promise<Response> {
  const headers: ClerkWebhookHeaders = {
    id: request.headers.get('svix-id') || '',
    timestamp: request.headers.get('svix-timestamp') || '',
    signature: request.headers.get('svix-signature') || '',
  };

  if (!headers.id || !headers.timestamp || !headers.signature) {
    return errorResponse('Missing required Svix headers', 400, env, requestOrigin);
  }

  const webhookSecret = env.CLERK_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return errorResponse('CLERK_WEBHOOK_SECRET is not configured', 500, env, requestOrigin);
  }

  const rawBody = await request.text();

  try {
    await verifyClerkSvixSignature(rawBody, headers, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Signature verification failed';
    console.error('[CLERK_WEBHOOK] Signature verification failed', {
      message,
      eventId: headers.id,
    });
    return errorResponse(message, 400, env, requestOrigin);
  }

  let event: ClerkWebhookEventPayload;
  try {
    event = JSON.parse(rawBody) as ClerkWebhookEventPayload;
  } catch {
    return errorResponse('Invalid webhook payload', 400, env, requestOrigin);
  }

  const eventType = typeof event.type === 'string' ? event.type : 'unknown';

  try {
    const db = createWorkersDatabase(env);

    // Claim the event *before* doing the work. Svix delivers at least once and
    // retries on timeout or 5xx, so concurrent redelivery of one event id is the
    // expected case, not the exotic one; claiming afterwards deduplicated the
    // marker row while the side effects still ran twice (issue #472).
    const claim = await claimClerkWebhookEvent(db.sql, headers.id, eventType);

    if (claim === 'completed') {
      // A replay of work that finished. Acknowledging ends the retry chain,
      // which is exactly right: there is nothing left to do for this event.
      console.log('[CLERK_WEBHOOK] Skipping replay of a completed event', {
        eventId: headers.id,
        eventType,
      });
      return jsonResponse({ received: true }, 200, env, requestOrigin);
    }

    if (claim === 'in_flight') {
      // A sibling delivery holds the claim. This must NOT be acknowledged: a 200
      // ends Svix's retry chain for this delivery, and if the claim holder dies
      // without releasing (eviction, runtime kill — no 500 to retry), the only
      // thing that can re-drive the event is a later redelivery arriving after
      // the staleness window. Acknowledging here would remove that redelivery and
      // leave the claim stranded until a manual replay. A retryable status keeps
      // the delivery alive; if the sibling succeeds, the retry finds `completed`
      // and acknowledges then.
      console.log('[CLERK_WEBHOOK] Event claimed by another delivery; asking for a retry', {
        eventId: headers.id,
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
      await processClerkWebhookEvent(db.sql, event);
    } catch (error) {
      // Hand the event back so the retry re-drives it immediately rather than
      // waiting out the staleness window.
      await releaseClerkWebhookEventClaim(db.sql, headers.id).catch((releaseError: unknown) => {
        console.error('[CLERK_WEBHOOK] Failed to release claim after processing error', {
          eventId: headers.id,
          eventType,
          error: releaseError instanceof Error ? releaseError.message : 'unknown',
        });
      });
      throw error;
    }

    await completeClerkWebhookEvent(db.sql, headers.id);

    return jsonResponse({ received: true }, 200, env, requestOrigin);
  } catch (error) {
    console.error('[CLERK_WEBHOOK] Error processing webhook event', {
      eventId: headers.id,
      eventType,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return errorResponse('Error processing Clerk webhook event', 500, env, requestOrigin);
  }
}
