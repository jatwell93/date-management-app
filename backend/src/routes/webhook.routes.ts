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

import { Router, NextFunction, Request, Response } from 'express';
import { createWebhookController } from '../di/services';

const router = Router();

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
router.post('/stripe', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const controller = createWebhookController();
    await controller.handleStripeWebhook(req, res, next);
  } catch (error) {
    next(error);
  }
});

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
router.post('/clerk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const controller = createWebhookController();
    await controller.handleClerkWebhook(req, res, next);
  } catch (error) {
    next(error);
  }
});

export default router;
