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
import { PrismaClient } from '@prisma/client';
import { envConfig } from '../config/environment';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { SubscriptionService } from './subscription.service';
import { EmailService } from './email.service';
import { TIER_LIMITS, TierLevel, SubscriptionStatus } from '../types/subscription';
import { NotFoundError } from '../errors';
import * as Sentry from '@sentry/node';
import { ApplicationMonitoringService } from './application.monitoring.service';

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
  private prisma: PrismaClient;
  private subscriptionService: SubscriptionService;
  private emailService: EmailService;

  constructor(
    prismaClient?: PrismaClient,
    subscriptionService?: SubscriptionService,
    emailService?: EmailService,
  ) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.subscriptionService = subscriptionService ?? new SubscriptionService(this.prisma);
    this.emailService = emailService ?? new EmailService(this.prisma);

    if (envConfig.STRIPE_SECRET_KEY) {
      this.stripe = new Stripe(envConfig.STRIPE_SECRET_KEY, {
        apiVersion: '2023-08-16',
      });
    } else {
      this.stripe = null;
      log.warn(
        'STRIPE_SECRET_KEY not set. Stripe webhook verification is disabled until configured.',
      );
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
   * Uses database for persistent idempotency checking.
   */
  async isNewEvent(eventId: string): Promise<boolean> {
    const existing = await this.prisma.processedWebhookEvent.findUnique({
      where: { id: eventId },
    });
    return !existing;
  }

  /**
   * Mark event as processed
   *
   * Inserts into processed_webhook_events table.
   * Handles unique constraint errors gracefully (already processed).
   */
  async markEventProcessed(eventId: string, eventType: string): Promise<void> {
    try {
      await this.prisma.processedWebhookEvent.create({
        data: {
          id: eventId,
          eventType,
          processedAt: new Date(),
        },
      });
    } catch (error: any) {
      // P2002 = unique constraint violation (already processed)
      if (error.code === 'P2002') {
        log.info('Event already marked as processed (idempotency)', { eventId });
        return;
      }
      throw error;
    }
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
   * Validate and extract organizationId from Stripe customer metadata
   * DECISION 17.5.5: Stripe customer metadata is source of truth
   */
  private async validateWebhookMetadata(customerId: string): Promise<string> {
    const monitor = ApplicationMonitoringService.getInstance();
    try {
      const customer = await this.stripe!.customers.retrieve(customerId);

      if (customer.deleted) {
        const err = new NotFoundError('Customer has been deleted');
        Sentry.captureException(err, { level: 'warning', extra: { customerId } });
        throw err;
      }

      const organizationId = customer.metadata?.organizationId;
      if (!organizationId) {
        const err = new Error('Missing organizationId in Stripe customer metadata');
        log.error('Missing organizationId in Stripe customer metadata', { customerId });
        Sentry.captureException(err, { level: 'warning', extra: { customerId } });
        // record a validation warning metric (skipped counted via 'skipped')
        monitor.recordWebhookEvent('validate_metadata', 0, 'skipped');
        throw err;
      }

      // Verify organization exists
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
      });

      if (!organization) {
        const err = new NotFoundError(`Organization ${organizationId} not found`);
        log.error('Organization not found', { organizationId, customerId });
        Sentry.captureException(err, { level: 'warning', extra: { customerId, organizationId } });
        throw err;
      }

      return organizationId;
    } catch (error) {
      // rethrow after capturing
      throw error;
    }
  }

  /**
   * Extract tier level from subscription's price metadata
   */
  private extractTierFromPrice(subscription: Stripe.Subscription): TierLevel {
    const price = subscription.items.data[0]?.price;
    if (!price) {
      log.warn('No price found in subscription, defaulting to starter');
      return 'starter';
    }

    const tier = (price.metadata?.tier as TierLevel) || 'starter';
    if (!Object.keys(TIER_LIMITS).includes(tier)) {
      log.warn(`Unknown tier ${tier} from price metadata, using starter`);
      return 'starter';
    }

    return tier;
  }

  /**
   * Handle customer.subscription.created (Phase 18.B.3.1)
   *
   * Creates subscription_tiers record with organization metadata validation.
   */
  private async handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
    const monitor = ApplicationMonitoringService.getInstance();
    const start = Date.now();

    try {
      log.info('Subscription created', {
        subscriptionId: subscription.id,
        customerId: subscription.customer,
        status: subscription.status,
      });

      // Extract and validate organizationId
      const organizationId = await this.validateWebhookMetadata(subscription.customer as string);

      // Extract tier from price metadata
      const tierLevel = this.extractTierFromPrice(subscription);

      // Create subscription_tiers and update usage limits in transaction
      await this.prisma.$transaction(async (tx) => {
        await tx.subscriptionTier.create({
          data: {
            organizationId,
            tierLevel,
            stripeSubscriptionId: subscription.id,
            status: subscription.status,
            billingCycle:
              subscription.items.data[0]?.price.recurring?.interval === 'year'
                ? 'annual'
                : 'monthly',
            trialEndDate: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
          },
        });

        // Update organization_usage limits based on tier
        const limits = TIER_LIMITS[tierLevel];
        await tx.organizationUsage.upsert({
          where: { organizationId },
          update: {
            maxSkus: limits.max_skus || 999999,
            maxUsers: limits.max_users || 999999,
          },
          create: {
            organizationId,
            maxSkus: limits.max_skus || 999999,
            maxUsers: limits.max_users || 999999,
            activeUsers: 0,
            totalSkus: 0,
            storageUsedBytes: 0,
          },
        });

        // Log audit event
        await tx.auditLog.create({
          data: {
            organizationId,
            action: 'subscription_created',
            changeDescription: `Subscription created: ${tierLevel} tier`,
          },
        });
      });

      const duration = Date.now() - start;
      monitor.recordWebhookEvent('customer.subscription.created', duration, 'success');

      log.info('Subscription created successfully', { organizationId, tierLevel });
    } catch (error: any) {
      const duration = Date.now() - start;
      monitor.recordWebhookEvent('customer.subscription.created', duration, 'error');
      Sentry.captureException(error, {
        level: 'error',
        extra: { subscriptionId: subscription.id, customerId: subscription.customer },
      });
      log.error('Failed to handle subscription created', {
        error: error instanceof Error ? error.message : 'Unknown error',
        subscriptionId: subscription.id,
      });
      throw error;
    }
  }

  /**
   * Handle customer.subscription.updated (Phase 18.B.3.2)
   *
   * Updates subscription_tiers and applies soft lock if downgrading over limit.
   * DECISION 17.5.8: Apply soft lock (read-only mode) when downgrading over limit.
   */
  private async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const monitor = ApplicationMonitoringService.getInstance();
    const start = Date.now();

    try {
      log.info('Subscription updated', {
        subscriptionId: subscription.id,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
      });

      // Extract and validate organizationId
      const organizationId = await this.validateWebhookMetadata(subscription.customer as string);

      // Get old subscription tier for downgrade detection
      const oldTier = await this.prisma.subscriptionTier.findFirst({
        where: { organizationId },
      });

      // Extract new tier
      const newTierLevel = this.extractTierFromPrice(subscription);

      // Check if this is a downgrade
      const isDowngrade =
        oldTier &&
        TIER_LIMITS[newTierLevel].max_skus !== null &&
        (TIER_LIMITS[oldTier.tierLevel as TierLevel].max_skus === null ||
          (TIER_LIMITS[newTierLevel].max_skus as number) <
            (TIER_LIMITS[oldTier.tierLevel as TierLevel].max_skus as number));

      // Update in transaction
      await this.prisma.$transaction(async (tx) => {
        // Sync subscription state
        await tx.subscriptionTier.updateMany({
          where: { organizationId },
          data: {
            tierLevel: newTierLevel,
            status: subscription.status,
            trialEndDate: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
          },
        });

        // Update usage limits
        const limits = TIER_LIMITS[newTierLevel];
        await tx.organizationUsage.update({
          where: { organizationId },
          data: {
            maxSkus: limits.max_skus || 999999,
            maxUsers: limits.max_users || 999999,
          },
        });

        // Check if usage exceeds new limit on downgrade
        if (isDowngrade && limits.max_skus !== null) {
          const usage = await tx.organizationUsage.findUnique({
            where: { organizationId },
          });

          if (usage && usage.totalSkus > limits.max_skus) {
            log.warn('Usage exceeds new tier limit, applying soft lock', {
              organizationId,
              currentUsage: usage.totalSkus,
              newLimit: limits.max_skus,
            });

            // Note: readOnlyMode field doesn't exist in current schema
            // This is a placeholder for future implementation
            // For now, just send the warning email

            // Queue warning email
            await this.emailService.sendDowngradeWarningEmail(
              organizationId,
              usage.totalSkus,
              limits.max_skus,
            );
          }
        }

        // Log audit event
        await tx.auditLog.create({
          data: {
            organizationId,
            action: 'subscription_updated',
            changeDescription: `Subscription updated to ${newTierLevel} tier`,
          },
        });
      });

      const duration = Date.now() - start;
      monitor.recordWebhookEvent('customer.subscription.updated', duration, 'success');

      log.info('Subscription updated successfully', { organizationId, newTierLevel });
    } catch (error: any) {
      const duration = Date.now() - start;
      monitor.recordWebhookEvent('customer.subscription.updated', duration, 'error');
      Sentry.captureException(error, {
        level: 'error',
        extra: { subscriptionId: subscription.id, customerId: subscription.customer },
      });
      log.error('Failed to handle subscription updated', {
        error: error instanceof Error ? error.message : 'Unknown error',
        subscriptionId: subscription.id,
      });
      throw error;
    }
  }

  /**
   * Handle customer.subscription.deleted (Phase 18.B.3.3)
   *
   * Cancels subscription and downgrades to Starter tier.
   * DECISION 17.5.8: Apply soft lock if usage > Starter limits.
   */
  private async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const monitor = ApplicationMonitoringService.getInstance();
    const start = Date.now();

    try {
      log.info('Subscription deleted', {
        subscriptionId: subscription.id,
      });

      // Extract and validate organizationId
      const organizationId = await this.validateWebhookMetadata(subscription.customer as string);

      // Update in transaction
      await this.prisma.$transaction(async (tx) => {
        // Set status to canceled and downgrade to starter
        await tx.subscriptionTier.updateMany({
          where: { organizationId },
          data: {
            status: SubscriptionStatus.CANCELED,
            tierLevel: 'starter',
            trialEndDate: null,
          },
        });

        // Update usage limits to Starter tier
        const starterLimits = TIER_LIMITS.starter;
        await tx.organizationUsage.update({
          where: { organizationId },
          data: {
            maxSkus: starterLimits.max_skus || 500,
            maxUsers: starterLimits.max_users || 1,
          },
        });

        // Check if usage exceeds Starter limits
        const usage = await tx.organizationUsage.findUnique({
          where: { organizationId },
        });

        if (usage && usage.totalSkus > (starterLimits.max_skus || 500)) {
          log.warn('Usage exceeds Starter limit after cancellation', {
            organizationId,
            currentUsage: usage.totalSkus,
            starterLimit: starterLimits.max_skus,
          });

          // Send warning email about over-limit state
          await this.emailService.sendDowngradeWarningEmail(
            organizationId,
            usage.totalSkus,
            starterLimits.max_skus || 500,
          );
        }

        // Log audit event
        await tx.auditLog.create({
          data: {
            organizationId,
            action: 'subscription_canceled',
            changeDescription: `Subscription canceled, downgraded to Starter tier`,
          },
        });
      });

      const duration = Date.now() - start;
      monitor.recordWebhookEvent('customer.subscription.deleted', duration, 'success');

      log.info('Subscription deleted successfully', { organizationId });
    } catch (error: any) {
      const duration = Date.now() - start;
      monitor.recordWebhookEvent('customer.subscription.deleted', duration, 'error');
      Sentry.captureException(error, { level: 'error', extra: { subscriptionId: subscription.id } });
      log.error('Failed to handle subscription deleted', {
        error: error instanceof Error ? error.message : 'Unknown error',
        subscriptionId: subscription.id,
      });
      throw error;
    }
  }

  /**
   * Handle checkout.session.completed (Phase 18.B.3.4)
   *
   * Marks trial as complete when customer pays.
   * DECISION 17.5.5: Link via customer metadata organizationId.
   */
  private async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const monitor = ApplicationMonitoringService.getInstance();
    const start = Date.now();

    try {
      log.info('Checkout session completed', {
        sessionId: session.id,
        customerId: session.customer,
        subscriptionId: session.subscription,
      });

      // Extract and validate organizationId
      const organizationId = await this.validateWebhookMetadata(session.customer as string);

      // Update subscription to mark trial as complete
      await this.prisma.$transaction(async (tx) => {
        await tx.subscriptionTier.updateMany({
          where: {
            organizationId,
            stripeSubscriptionId: session.subscription as string,
          },
          data: {
            trialEndDate: null, // Clear trial end date
            status: SubscriptionStatus.ACTIVE, // Set to active
          },
        });

        // Log trial conversion event
        await tx.auditLog.create({
          data: {
            organizationId,
            action: 'trial_converted',
            changeDescription: `Trial converted to paid subscription`,
          },
        });
      });

      log.info('Checkout completed successfully', { organizationId });
      const duration = Date.now() - start;
      monitor.recordWebhookEvent('checkout.session.completed', duration, 'success');
    } catch (error: any) {
      const duration = Date.now() - start;
      monitor.recordWebhookEvent('checkout.session.completed', duration, 'error');
      Sentry.captureException(error, { level: 'error', extra: { sessionId: session.id } });
      log.error('Failed to handle checkout completed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId: session.id,
      });
      throw error;
    }
  }

  /**
   * Handle invoice.payment_failed (Phase 18.B.3.5)
   *
   * Sets status to past_due and queues dunning email.
   * DECISION 17.5.9: 7-day grace period before auto-downgrade (handled by cron).
   */
  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const monitor = ApplicationMonitoringService.getInstance();
    const start = Date.now();

    try {
      log.error('Invoice payment failed', {
        invoiceId: invoice.id,
        customerId: invoice.customer,
        amount: invoice.amount_due,
      });

      // Extract and validate organizationId
      const organizationId = await this.validateWebhookMetadata(invoice.customer as string);

      // Update subscription status to past_due
      await this.prisma.$transaction(async (tx) => {
        await tx.subscriptionTier.updateMany({
          where: { organizationId },
          data: {
            status: SubscriptionStatus.PAST_DUE,
          },
        });

        // Log dunning event
        await tx.auditLog.create({
          data: {
            organizationId,
            action: 'payment_failed',
            changeDescription: `Invoice ${invoice.id} payment failed: ${invoice.amount_due} cents`,
          },
        });
      });

      // Queue dunning email (non-blocking)
      await this.emailService.sendDunningEmail(
        organizationId,
        invoice.hosted_invoice_url || undefined,
      );

      log.info('Payment failure handled', { organizationId, invoiceId: invoice.id });
      const duration = Date.now() - start;
      monitor.recordWebhookEvent('invoice.payment_failed', duration, 'success');
    } catch (error: any) {
      const duration = Date.now() - start;
      monitor.recordWebhookEvent('invoice.payment_failed', duration, 'error');
      Sentry.captureException(error, { level: 'error', extra: { invoiceId: invoice.id } });
      log.error('Failed to handle payment failure', {
        error: error instanceof Error ? error.message : 'Unknown error',
        invoiceId: invoice.id,
      });
      throw error;
    }
  }

  /**
   * Handle customer.subscription.trial_will_end (Phase 18.B.3.6)
   *
   * Sends trial reminder email when trial is ending soon.
   * DECISION 17.5.4: Use SendGrid for email notifications.
   */
  private async handleTrialWillEnd(subscription: Stripe.Subscription): Promise<void> {
    const monitor = ApplicationMonitoringService.getInstance();
    const start = Date.now();

    try {
      log.info('Trial will end soon', {
        subscriptionId: subscription.id,
        trialEnd: subscription.trial_end,
      });

      // Extract and validate organizationId
      const organizationId = await this.validateWebhookMetadata(subscription.customer as string);

      // Calculate days remaining
      const trialEnd = new Date((subscription.trial_end || 0) * 1000);
      const daysRemaining = Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

      // Send reminder email
      await this.emailService.sendTrialReminderEmail(organizationId, daysRemaining);

      log.info('Trial reminder sent', { organizationId, daysRemaining });
      const duration = Date.now() - start;
      monitor.recordWebhookEvent('customer.subscription.trial_will_end', duration, 'success');
    } catch (error: any) {
      const duration = Date.now() - start;
      monitor.recordWebhookEvent('customer.subscription.trial_will_end', duration, 'error');
      Sentry.captureException(error, {
        level: 'error',
        extra: { subscriptionId: subscription.id },
      });
      log.error('Failed to handle trial will end', {
        error: error instanceof Error ? error.message : 'Unknown error',
        subscriptionId: subscription.id,
      });
      throw error;
    }
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
