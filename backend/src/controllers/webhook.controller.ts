/**
 * Webhook Controller
 *
 * Handles HTTP request/response formatting for webhook endpoints.
 * Delegates business logic to webhook services.
 *
 * Responsibilities:
 * - Extract headers from request
 * - Delegate to service for verification and processing
 * - Format responses (success/error)
 * - Record monitoring metrics
 *
 * Services:
 * - WebhookService: Stripe webhook handling
 * - ClerkWebhookService: Clerk webhook handling
 */

import { Request, Response, NextFunction } from 'express';
import Stripe from 'stripe';
import { WebhookService } from '../services/webhook.service';
import { ClerkWebhookService } from '../services/clerk-webhook.service';
import { ApplicationMonitoringService } from '../services/application.monitoring.service';
import { ConflictError, NotFoundError } from '../errors';
import { injectable } from 'tsyringe';
import * as Sentry from '@sentry/node';
import { Logger } from '../utils/logger';

function sendWebhookSuccess(res: Response): void {
  res.status(200).json({ received: true });
}

function sendWebhookError(res: Response, message: string, statusCode = 400): void {
  if (statusCode >= 500) {
    Sentry.captureMessage(`Webhook server error: ${message}`, {
      level: 'error',
      tags: {
        component: 'webhook',
        error_type: 'server_error',
        status_code: statusCode.toString(),
      },
      extra: { message, timestamp: new Date().toISOString() },
    });
  } else if (statusCode >= 400) {
    Sentry.captureMessage(`Webhook client error: ${message}`, {
      level: 'warning',
      tags: {
        component: 'webhook',
        error_type: 'client_error',
        status_code: statusCode.toString(),
      },
      extra: { message, timestamp: new Date().toISOString() },
    });
  }
  res.status(statusCode).json({ error: message });
}

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

@injectable()
export class WebhookController {
  constructor(
    private webhookService: WebhookService,
    private clerkWebhookService: ClerkWebhookService,
  ) {}

  /**
   * Handle Stripe webhook events
   *
   * POST /api/webhooks/stripe
   *
   * Handler sequence (required):
   * 1. Verify signature first (reject invalid with 4xx)
   * 2. Parse payload second (after verification)
   * 3. Handle idempotently (check event ID, process, store)
   */
  async handleStripeWebhook(req: Request, res: Response, _next: NextFunction): Promise<void> {
    try {
      // Step 1: Verify Stripe signature (using raw body)
      const signature = req.headers['stripe-signature'] as string;

      if (!signature) {
        Logger.warn('[WEBHOOK] Webhook request missing stripe-signature header');
        sendWebhookError(res, 'Missing stripe-signature header', 400);
        return;
      }

      let event: Stripe.Event;
      try {
        const rawBody = req.body; // Body is raw Buffer when using express.raw()
        event = this.webhookService.verifySignature(rawBody as Buffer, signature);
      } catch (verifyError) {
        const error = verifyError as Error;
        Logger.error('[WEBHOOK] Webhook signature verification failed', {
          error: error.message,
          signaturePresent: Boolean(signature),
        });
        sendWebhookError(res, error.message, 400);
        return;
      }

      // Step 2: Check idempotency (duplicate detection)
      const isNew = await this.webhookService.isNewEvent(event.id);
      const monitor = ApplicationMonitoringService.getInstance();
      const startTs = Date.now();

      if (!isNew) {
        Logger.info('[WEBHOOK] Duplicate webhook event, returning success without reprocessing', {
          eventId: event.id,
          eventType: event.type,
        });

        // record idempotency skip metric
        monitor.recordWebhookEvent(event.type, 0, 'skipped');

        // Return 200 OK for duplicate events (Stripe expects idempotent response)
        sendWebhookSuccess(res);
        return;
      }

      // Step 3: Handle event idempotently
      try {
        await this.webhookService.handleEvent(event);
        await this.webhookService.markEventProcessed(event.id, event.type);
        const duration = Date.now() - startTs;
        monitor.recordWebhookEvent(event.type, duration, 'success');

        Logger.info('[WEBHOOK] Webhook event processed successfully', {
          eventId: event.id,
          eventType: event.type,
        });
        sendWebhookSuccess(res);
      } catch (handleError) {
        const error = handleError as Error;
        const duration = Date.now() - startTs;
        monitor.recordWebhookEvent(event.type, duration, 'error');

        Logger.error('[WEBHOOK] Error processing webhook event', {
          eventId: event.id,
          eventType: event.type,
          error: error.message,
        });

        if (isNonRecoverableStripeWebhookError(error)) {
          Logger.warn(
            '[WEBHOOK] Non-recoverable Stripe webhook error, acknowledging event to stop retries',
            {
              eventId: event.id,
              eventType: event.type,
              error: error.message,
            },
          );
          sendWebhookSuccess(res);
          return;
        }

        // Return 500 for transient processing errors (Stripe will retry)
        sendWebhookError(res, 'Error processing webhook event', 500);
      }
    } catch (error) {
      const err = error as Error;
      Logger.error('[WEBHOOK] Unexpected error in webhook handler', {
        error: err.message,
      });
      sendWebhookError(res, 'Internal server error', 500);
    }
  }

  /**
   * Handle Clerk webhook events
   *
   * POST /api/webhooks/clerk
   *
   * Handler sequence (required):
   * 1. Verify signature first (reject invalid with 4xx)
   * 2. Parse payload second (after verification)
   * 3. Handle idempotently (check event ID, process, store)
   */
  async handleClerkWebhook(req: Request, res: Response, _next: NextFunction): Promise<void> {
    try {
      // Step 1: Verify Clerk signature (using raw body)
      const headers = {
        'svix-id': req.headers['svix-id'] as string,
        'svix-timestamp': req.headers['svix-timestamp'] as string,
        'svix-signature': req.headers['svix-signature'] as string,
      };

      if (!headers['svix-id'] || !headers['svix-timestamp'] || !headers['svix-signature']) {
        Logger.warn('[CLERK_WEBHOOK] Webhook request missing required Svix headers');
        sendWebhookError(res, 'Missing required Svix headers', 400);
        return;
      }

      let event: ClerkWebhookEventPayload;
      try {
        const rawBody = req.body; // Body is raw Buffer when using express.raw()
        const verifiedEvent = this.clerkWebhookService.verifySignature(rawBody as Buffer, headers);
        if (!isClerkWebhookEventPayload(verifiedEvent)) {
          sendWebhookError(res, 'Invalid webhook payload', 400);
          return;
        }
        event = verifiedEvent;
      } catch (verifyError) {
        const error = verifyError as Error;
        Logger.error('[CLERK_WEBHOOK] Webhook signature verification failed', {
          error: error.message,
          svixId: headers['svix-id'],
          svixTimestampPresent: Boolean(headers['svix-timestamp']),
          svixSignaturePresent: Boolean(headers['svix-signature']),
        });
        sendWebhookError(res, error.message, 400);
        return;
      }

      // Step 2: Check idempotency (duplicate detection)
      // svix-id is the unique message ID from Clerk — use it as the idempotency key
      const svixEventId = headers['svix-id'];
      const eventType = event.type ?? 'unknown';
      const isNew = await this.clerkWebhookService.isNewEvent(svixEventId);
      const monitor = ApplicationMonitoringService.getInstance();
      const startTs = Date.now();

      if (!isNew) {
        Logger.info(
          '[CLERK_WEBHOOK] Duplicate webhook event, returning success without reprocessing',
          {
            eventId: svixEventId,
            eventType,
          },
        );

        // record idempotency skip metric
        monitor.recordWebhookEvent(eventType, 0, 'skipped');

        // Return 200 OK for duplicate events
        sendWebhookSuccess(res);
        return;
      }

      // Step 3: Handle event idempotently
      try {
        await this.clerkWebhookService.handleEvent(event);
        await this.clerkWebhookService.markEventProcessed(svixEventId, eventType);
        const duration = Date.now() - startTs;
        monitor.recordWebhookEvent(eventType, duration, 'success');

        Logger.info('[CLERK_WEBHOOK] Webhook event processed successfully', {
          eventId: svixEventId,
          eventType,
        });
        sendWebhookSuccess(res);
      } catch (handleError) {
        const error = handleError as Error;
        const duration = Date.now() - startTs;
        monitor.recordWebhookEvent(eventType, duration, 'error');

        Logger.error('[CLERK_WEBHOOK] Error processing webhook event', {
          eventId: svixEventId,
          eventType,
          error: error.message,
        });

        if (error instanceof ConflictError) {
          sendWebhookError(res, error.message, error.statusCode);
          return;
        }

        // Return 500 for transient processing errors (Clerk will retry)
        sendWebhookError(res, 'Error processing webhook event', 500);
      }
    } catch (error) {
      const err = error as Error;
      Logger.error('[CLERK_WEBHOOK] Unexpected error in webhook handler', {
        error: err.message,
      });
      sendWebhookError(res, 'Internal server error', 500);
    }
  }
}
