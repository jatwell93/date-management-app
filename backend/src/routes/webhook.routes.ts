/**
 * Stripe Webhook Routes
 *
 * Endpoint: POST /api/webhooks/stripe
 *
 * Handler sequence (required by webhook-handler-patterns skill):
 * 1. Verify signature first (reject invalid with 4xx)
 * 2. Parse payload second (after verification)
 * 3. Handle idempotently (check event ID, process, store)
 *
 * Important: This route uses express.raw() middleware to preserve the raw body
 * for Stripe signature verification.
 */

import { Router, Request, Response } from 'express';
import { webhookService } from '../services/webhook.service';
import { clerkWebhookService } from '../services/clerk-webhook.service';
import { ApplicationMonitoringService } from '../services/application.monitoring.service';
import { ConflictError, NotFoundError } from '../errors';

const router = Router();

type ClerkWebhookEventPayload = {
  type?: string;
  data?: unknown;
};

function isClerkWebhookEventPayload(value: unknown): value is ClerkWebhookEventPayload {
  return typeof value === 'object' && value !== null;
}

function isNonRecoverableStripeWebhookError(error: Error): boolean {
  if (error instanceof NotFoundError) {
    return true;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('missing organizationid in stripe customer metadata') ||
    message.includes('customer has been deleted') ||
    (message.includes('organization') && message.includes('not found'))
  );
}

const handleStripeWebhook = async (req: Request, res: Response) => {
  try {
    // Step 1: Verify Stripe signature (using raw body)
    const signature = req.headers['stripe-signature'] as string;

    if (!signature) {
      console.warn('[WEBHOOK] Webhook request missing stripe-signature header');
      return webhookService.sendError(res, 'Missing stripe-signature header', 400);
    }

    let event;
    try {
      const rawBody = req.body; // Body is raw Buffer when using express.raw()
      event = webhookService.verifySignature(rawBody as Buffer, signature);
    } catch (verifyError) {
      const error = verifyError as Error;
      console.error('[WEBHOOK] Webhook signature verification failed', {
        error: error.message,
        signature,
      });
      return webhookService.sendError(res, error.message, 400);
    }

    // Step 2: Check idempotency (duplicate detection)
    const isNew = await webhookService.isNewEvent(event.id);
    const monitor = ApplicationMonitoringService.getInstance();
    const startTs = Date.now();

    if (!isNew) {
      console.log('[WEBHOOK] Duplicate webhook event, returning success without reprocessing', {
        eventId: event.id,
        eventType: event.type,
      });

      // record idempotency skip metric
      monitor.recordWebhookEvent(event.type, 0, 'skipped');

      // Return 200 OK for duplicate events (Stripe expects idempotent response)
      return webhookService.sendSuccess(res);
    }

    // Step 3: Handle event idempotently
    try {
      await webhookService.handleEvent(event);
      await webhookService.markEventProcessed(event.id, event.type);
      const duration = Date.now() - startTs;
      monitor.recordWebhookEvent(event.type, duration, 'success');

      console.log('[WEBHOOK] Webhook event processed successfully', {
        eventId: event.id,
        eventType: event.type,
      });
      return webhookService.sendSuccess(res);
    } catch (handleError) {
      const error = handleError as Error;
      const duration = Date.now() - startTs;
      monitor.recordWebhookEvent(event.type, duration, 'error');

      console.error('[WEBHOOK] Error processing webhook event', {
        eventId: event.id,
        eventType: event.type,
        error: error.message,
      });

      if (isNonRecoverableStripeWebhookError(error)) {
        console.warn(
          '[WEBHOOK] Non-recoverable Stripe webhook error, acknowledging event to stop retries',
          {
            eventId: event.id,
            eventType: event.type,
            error: error.message,
          },
        );
        return webhookService.sendSuccess(res);
      }

      // Return 500 for transient processing errors (Stripe will retry)
      return webhookService.sendError(res, 'Error processing webhook event', 500);
    }
  } catch (error) {
    const err = error as Error;
    console.error('[WEBHOOK] Unexpected error in webhook handler', {
      error: err.message,
    });
    return webhookService.sendError(res, 'Internal server error', 500);
  }
};

/**
 * POST /api/webhooks/stripe
 *
 * Receive Stripe webhook events
 *
 * CRITICAL: This endpoint is public (no authentication required)
 * Stripe sends events via HTTP POST with HMAC signature in stripe-signature header
 *
 * Signature is computed over raw request body, so express.raw() middleware is required
 */
router.post('/stripe', handleStripeWebhook);

/**
 * POST /api/webhooks/clerk
 *
 * Receive Clerk webhook events
 *
 * CRITICAL: This endpoint is public (no authentication required)
 * Clerk sends events via HTTP POST with Svix signatures in svix-* headers
 *
 * Signature is computed over raw request body, so express.raw() middleware is required
 */
const handleClerkWebhook = async (req: Request, res: Response) => {
  try {
    // Step 1: Verify Clerk signature (using raw body)
    const headers = {
      'svix-id': req.headers['svix-id'] as string,
      'svix-timestamp': req.headers['svix-timestamp'] as string,
      'svix-signature': req.headers['svix-signature'] as string,
    };

    if (!headers['svix-id'] || !headers['svix-timestamp'] || !headers['svix-signature']) {
      console.warn('[CLERK_WEBHOOK] Webhook request missing required Svix headers');
      return clerkWebhookService.sendError(res, 'Missing required Svix headers', 400);
    }

    let event: ClerkWebhookEventPayload;
    try {
      const rawBody = req.body; // Body is raw Buffer when using express.raw()
      const verifiedEvent = clerkWebhookService.verifySignature(rawBody as Buffer, headers);
      if (!isClerkWebhookEventPayload(verifiedEvent)) {
        return clerkWebhookService.sendError(res, 'Invalid webhook payload', 400);
      }
      event = verifiedEvent;
    } catch (verifyError) {
      const error = verifyError as Error;
      console.error('[CLERK_WEBHOOK] Webhook signature verification failed', {
        error: error.message,
        headers,
      });
      return clerkWebhookService.sendError(res, error.message, 400);
    }

    // Step 2: Check idempotency (duplicate detection)
    // svix-id is the unique message ID from Clerk — use it as the idempotency key
    const svixEventId = headers['svix-id'];
    const eventType = event.type ?? 'unknown';
    const isNew = await clerkWebhookService.isNewEvent(svixEventId);
    const monitor = ApplicationMonitoringService.getInstance();
    const startTs = Date.now();

    if (!isNew) {
      console.log(
        '[CLERK_WEBHOOK] Duplicate webhook event, returning success without reprocessing',
        {
          eventId: svixEventId,
          eventType,
        },
      );

      // Record idempotency skip metric
      monitor.recordWebhookEvent(eventType, 0, 'skipped');

      // Return 200 OK for duplicate events (Clerk expects idempotent response)
      return clerkWebhookService.sendSuccess(res);
    }

    // Step 3: Handle event idempotently
    try {
      await clerkWebhookService.handleEvent(event);
      await clerkWebhookService.markEventProcessed(svixEventId, eventType);
      const duration = Date.now() - startTs;
      monitor.recordWebhookEvent(eventType, duration, 'success');

      console.log('[CLERK_WEBHOOK] Webhook event processed successfully', {
        eventId: svixEventId,
        eventType,
      });
      return clerkWebhookService.sendSuccess(res);
    } catch (handleError) {
      const error = handleError as Error;
      const duration = Date.now() - startTs;
      monitor.recordWebhookEvent(eventType, duration, 'error');

      console.error('[CLERK_WEBHOOK] Error processing webhook event', {
        eventId: svixEventId,
        eventType,
        error: error.message,
      });

      if (error instanceof ConflictError) {
        console.warn('[CLERK_WEBHOOK] Non-retryable conflict while processing webhook event', {
          eventId: svixEventId,
          eventType,
          error: error.message,
        });
        return clerkWebhookService.sendError(res, error.message, 409);
      }

      // Return 500 for processing errors (Clerk will retry)
      return clerkWebhookService.sendError(res, 'Error processing webhook event', 500);
    }
  } catch (error) {
    const err = error as Error;
    console.error('[CLERK_WEBHOOK] Unexpected error in webhook handler', {
      error: err.message,
    });
    return clerkWebhookService.sendError(res, 'Internal server error', 500);
  }
};

router.post('/clerk', handleClerkWebhook);

export default router;
