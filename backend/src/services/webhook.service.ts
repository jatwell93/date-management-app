/**
 * Webhook Handler Service
 * 
 * Implements Stripe webhook verification and processing with idempotent handling.
 * Uses the stripe-webhooks and webhook-handler-patterns skills.
 * 
 * Handler sequence (required):
 * 1. Verify signature first (reject invalid with 4xx)
 * 2. Parse payload second (after verification)
 * 3. Handle idempotently (check event ID, process, store)
 */

import Stripe from 'stripe';
import { Response } from 'express';
import { envConfig } from '../config/environment';

interface ProcessedWebhookEvent {
  id: string;
  type: string;
  processedAt: Date;
}

// In-memory store for processed events (TODO: use database for persistence)
const processedEvents: Map<string, ProcessedWebhookEvent> = new Map();

// Simple logging utility
const log = {
  info: (message: string, data?: Record<string, unknown>) => {
    console.log(`[WEBHOOK] ${message}`, data ? JSON.stringify(data) : '');
  },
  warn: (message: string, data?: Record<string, unknown>) => {
    console.warn(`[WEBHOOK] ${message}`, data ? JSON.stringify(data) : '');
  },
  error: (message: string, data?: Record<string, unknown>) => {
    console.error(`[WEBHOOK] ${message}`, data ? JSON.stringify(data) : '');
  },
};

export class WebhookService {
  private stripe: Stripe | null;

  constructor() {
    if (envConfig.STRIPE_SECRET_KEY) {
      this.stripe = new Stripe(envConfig.STRIPE_SECRET_KEY, {
        apiVersion: '2023-08-16',
      });
    } else {
      this.stripe = null;
      log.warn('STRIPE_SECRET_KEY not set. Stripe webhook verification is disabled until configured.');
    }
  }

  /**
   * Verify Stripe webhook signature
   * 
   * CRITICAL: Must use raw body (not JSON parsed)
   * Stripe signature is computed over the raw request body
   */
  verifySignature(rawBody: Buffer, signature: string): Stripe.Event {
    if (!this.stripe || !envConfig.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }

    if (!envConfig.STRIPE_WEBHOOK_SECRET) {
      throw new Error('STRIPE_WEBHOOK_SECRET environment variable is required');
    }

    try {
      const event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        envConfig.STRIPE_WEBHOOK_SECRET,
      );
      return event;
    } catch (error) {
      const err = error as Error;
      log.error('Stripe signature verification failed', {
        error: err.message,
        signature,
      });
      throw new Error(`Webhook Error: ${err.message}`);
    }
  }

  /**
   * Check if event was already processed (idempotency)
   * 
   * Returns true if event is new, false if already processed.
   * In production, this should check a database table.
   */
  isNewEvent(eventId: string): boolean {
    return !processedEvents.has(eventId);
  }

  /**
   * Mark event as processed
   * 
   * In production, this should insert into a processed_webhook_events table.
   */
  markEventProcessed(eventId: string, eventType: string): void {
    processedEvents.set(eventId, {
      id: eventId,
      type: eventType,
      processedAt: new Date(),
    });
  }

  /**
   * Handle webhook event based on type
   * 
   * Implements handlers for subscription and billing events.
   * Add new event types as needed.
   */
  async handleEvent(event: Stripe.Event): Promise<void> {
    log.info(`Processing webhook event: ${event.type}`, {
      eventId: event.id,
      eventType: event.type,
    });

    switch (event.type) {
      case 'customer.subscription.created': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionCreated(subscription);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionUpdated(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleSubscriptionDeleted(subscription);
        break;
      }

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await this.handleCheckoutSessionCompleted(session);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await this.handleInvoicePaymentFailed(invoice);
        break;
      }

      case 'customer.subscription.trial_will_end': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.handleTrialWillEnd(subscription);
        break;
      }

      default:
        log.info(`Unhandled webhook event type: ${event.type}`);
    }
  }

  /**
   * Handle customer.subscription.created
   * 
   * TODO: Create subscription_tiers record with:
   * - organization_id from Stripe customer metadata
   * - tier_level from price metadata
   * - stripe_subscription_id
   * - status = 'active'
   * - current_period_end
   * - is_trial = true if trial_end is set
   */
  private async handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
    log.info('Subscription created', {
      subscriptionId: subscription.id,
      customerId: subscription.customer,
      status: subscription.status,
    });

    // TODO: Implement subscription_tiers record creation
  }

  /**
   * Handle customer.subscription.updated
   * 
   * TODO: Update subscription_tiers record:
   * - Update tier_level from price metadata if changed
   * - Update current_period_end if changed
   * - Update status
   */
  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    log.info('Subscription updated', {
      subscriptionId: subscription.id,
      status: subscription.status,
      currentPeriodEnd: subscription.current_period_end,
    });

    // TODO: Implement subscription_tiers record update
  }

  /**
   * Handle customer.subscription.deleted
   * 
   * TODO: Update subscription_tiers record:
   * - Set status = 'canceled'
   * - Downgrade organization to Starter tier
   * - Set trial_end_date = null
   */
  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    log.info('Subscription deleted', {
      subscriptionId: subscription.id,
    });

    // TODO: Implement subscription downgrade to Starter tier
  }

  /**
   * Handle checkout.session.completed
   * 
   * TODO: Update subscription_tiers record:
   * - Set is_trial = false (customer paid, no longer in trial)
   */
  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
    log.info('Checkout session completed', {
      sessionId: session.id,
      customerId: session.customer,
      subscriptionId: session.subscription,
    });

    // TODO: Implement trial completion handling
  }

  /**
   * Handle invoice.payment_failed
   * 
   * TODO: Update subscription_tiers record:
   * - Set status = 'past_due'
   * - Log dunning event
   * - Trigger dunning email notification
   */
  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    log.error('Invoice payment failed', {
      invoiceId: invoice.id,
      customerId: invoice.customer,
      amount: invoice.amount_due,
    });

    // TODO: Implement dunning strategy
  }

  /**
   * Handle customer.subscription.trial_will_end
   * 
   * TODO: Send trial conversion reminder email
   * - Query subscription_tiers where trial_end_date is in next 3 days
   * - Send conversion reminder with upgrade CTA
   * - Track trial_reminder_sent event
   */
  private async handleTrialWillEnd(subscription: Stripe.Subscription): Promise<void> {
    log.info('Trial will end soon', {
      subscriptionId: subscription.id,
      trialEnd: subscription.trial_end,
    });

    // TODO: Implement trial reminder email
  }

  /**
   * Send webhook success response
   * 
   * Return 200 OK for both new and duplicate events (idempotency)
   */
  sendSuccess(res: Response): Response {
    return res.status(200).json({ received: true });
  }

  /**
   * Send webhook error response
   * 
   * Return 4xx for client errors (signature verification, invalid format)
   * Return 5xx only for temporary server errors (will trigger Stripe retry)
   */
  sendError(res: Response, message: string, statusCode = 400): Response {
    return res.status(statusCode).json({ error: message });
  }
}

export const webhookService = new WebhookService();
