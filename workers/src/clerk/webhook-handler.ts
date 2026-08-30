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
    const claimed = await claimClerkWebhookEvent(db.sql, headers.id, eventType);

    if (!claimed) {
      // Either a replay of finished work or a sibling delivery still in flight.
      // Both are 200: the sibling owns the outcome, and if it fails it returns
      // 500 on its own request, which is the delivery Svix will retry.
      console.log('[CLERK_WEBHOOK] Skipping duplicate delivery', {
        eventId: headers.id,
        eventType,
      });
      return jsonResponse({ received: true }, 200, env, requestOrigin);
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
