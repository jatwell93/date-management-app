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

const router = Router();

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
    if (!webhookService.isNewEvent(event.id)) {
      console.log('[WEBHOOK] Duplicate webhook event, returning success without reprocessing', {
        eventId: event.id,
        eventType: event.type,
      });
      // Return 200 OK for duplicate events (Stripe expects idempotent response)
      return webhookService.sendSuccess(res);
    }

    // Step 3: Handle event idempotently
    try {
      await webhookService.handleEvent(event);
      webhookService.markEventProcessed(event.id, event.type);
      console.log('[WEBHOOK] Webhook event processed successfully', {
        eventId: event.id,
        eventType: event.type,
      });
      return webhookService.sendSuccess(res);
    } catch (handleError) {
      const error = handleError as Error;
      console.error('[WEBHOOK] Error processing webhook event', {
        eventId: event.id,
        eventType: event.type,
        error: error.message,
      });

      // Return 500 for processing errors (Stripe will retry)
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
router.post(
  '/stripe',
  handleStripeWebhook,
);

export default router;
