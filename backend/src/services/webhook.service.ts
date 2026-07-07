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
import { PrismaClient } from '@prisma/client';
import type { Prisma, SubscriptionTier } from '@prisma/client';
import { envConfig } from '../config/environment';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { SubscriptionService } from './subscription.service';
import { EmailService } from './email.service';
import { StripeWebhookSignatureService } from './stripe-webhook-signature.service';
import { TIER_LIMITS, TierLevel, SubscriptionStatus } from '../types/subscription';
import { NotFoundError } from '../errors';
import * as Sentry from '@sentry/node';
import { ApplicationMonitoringService } from './application.monitoring.service';
import { invalidateSubscriptionCache } from '../middleware/auth.middleware';
import { getTierLimits, TierLimits } from './webhook-subscription.helpers';
import { dispatchStripeWebhookEvent } from './webhook-event-dispatcher';
import { injectable, inject } from 'tsyringe';
import { Logger } from '../utils/logger';
import { OrganizationRepository } from '../repositories/organization.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { ProcessedWebhookEventRepository } from '../repositories/processed-webhook-event.repository';
import { TrialEventRepository } from '../repositories/trial-event.repository';
import { AuditLogRepository } from '../repositories/audit-log.repository';

import { DEFAULT_LIMITS } from '../constants/default-limits';

interface ErrorWithCode {
  code?: string;
}

const log = {
  info: (message: string, data?: Record<string, unknown>) =>
    Logger.info(`[WEBHOOK] ${message}`, data),
  warn: (message: string, data?: Record<string, unknown>) =>
    Logger.warn(`[WEBHOOK] ${message}`, data),
  error: (message: string, data?: Record<string, unknown>) =>
    Logger.error(`[WEBHOOK] ${message}`, data),
};

@injectable()
export class WebhookService {
  private stripe: Stripe | null;
  private prisma: PrismaClient;
  private subscriptionService: SubscriptionService;
  private emailService: EmailService;
  private signatureVerifier: StripeWebhookSignatureService;
  private orgRepo: OrganizationRepository;
  private subscriptionRepo: SubscriptionRepository;
  private processedEventRepo: ProcessedWebhookEventRepository;
  private trialEventRepo: TrialEventRepository;
  private auditLogRepo: AuditLogRepository;

  constructor(
    @inject(PrismaClient) prismaClient?: PrismaClient,
    subscriptionService?: SubscriptionService,
    emailService?: EmailService,
    signatureVerifier?: StripeWebhookSignatureService,
    orgRepo?: OrganizationRepository,
    subscriptionRepo?: SubscriptionRepository,
    processedEventRepo?: ProcessedWebhookEventRepository,
    trialEventRepo?: TrialEventRepository,
    auditLogRepo?: AuditLogRepository,
  ) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.subscriptionService = subscriptionService ?? new SubscriptionService(this.prisma);
    this.emailService = emailService ?? new EmailService(this.prisma);
    this.signatureVerifier =
      signatureVerifier ??
      new StripeWebhookSignatureService(
        envConfig.STRIPE_SECRET_KEY,
        envConfig.STRIPE_WEBHOOK_SECRET,
      );
    this.orgRepo = orgRepo ?? new OrganizationRepository(this.prisma);
    this.subscriptionRepo = subscriptionRepo ?? new SubscriptionRepository(this.prisma);
    this.processedEventRepo =
      processedEventRepo ?? new ProcessedWebhookEventRepository(this.prisma);
    this.trialEventRepo = trialEventRepo ?? new TrialEventRepository(this.prisma);
    this.auditLogRepo = auditLogRepo ?? new AuditLogRepository(this.prisma);

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

  private getStripeClient(): Stripe {
    if (!this.stripe) {
      throw new Error('Stripe client is not configured');
    }

    return this.stripe;
  }

  /**
   * Verify Stripe webhook signature
   *
   * CRITICAL: Must use raw body (not JSON parsed)
   * Stripe signature is computed over the raw request body
   */
  verifySignature(rawBody: Buffer, signature: string): Stripe.Event {
    return this.signatureVerifier.verifySignature(rawBody, signature);
  }

  /**
   * Uses database for persistent idempotency checking.
   */
  async isNewEvent(eventId: string): Promise<boolean> {
    const existing = await this.processedEventRepo.findById(eventId);
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
      await this.processedEventRepo.create(eventId, eventType);
    } catch (error: unknown) {
      const prismaErrorCode =
        error && typeof error === 'object' && 'code' in error
          ? (error as ErrorWithCode).code
          : undefined;

      // P2002 = unique constraint violation (already processed)
      if (prismaErrorCode === 'P2002') {
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

    try {
      await dispatchStripeWebhookEvent(event, {
        handleSubscriptionCreated: this.handleSubscriptionCreated.bind(this),
        handleSubscriptionUpdated: this.handleSubscriptionUpdated.bind(this),
        handleSubscriptionDeleted: this.handleSubscriptionDeleted.bind(this),
        handleCheckoutSessionCompleted: this.handleCheckoutSessionCompleted.bind(this),
        handleInvoicePaymentFailed: this.handleInvoicePaymentFailed.bind(this),
        handleTrialWillEnd: this.handleTrialWillEnd.bind(this),
        handlePaymentIntentSucceeded: this.handlePaymentIntentSucceeded.bind(this),
        handlePaymentIntentFailed: this.handlePaymentIntentFailed.bind(this),
        handleUnhandledEvent: (eventType: string) => {
          log.info(`Unhandled webhook event type: ${eventType}`);
        },
      });
    } catch (error) {
      // Report webhook processing error with context
      this.reportWebhookError(error as Error, {
        eventType: event.type,
        eventId: event.id,
      });
      throw error;
    }
  }

  /**
   * Validate and extract organizationId from Stripe customer metadata
   * DECISION 17.5.5: Stripe customer metadata is source of truth
   */
  private async validateWebhookMetadata(customerId: string): Promise<string> {
    const monitor = ApplicationMonitoringService.getInstance();
    try {
      const customer = await this.getStripeClient().customers.retrieve(customerId);

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
      const organization = await this.orgRepo.findById(organizationId);

      if (!organization) {
        const err = new NotFoundError(`Organization ${organizationId} not found`);
        log.error('Organization not found', { organizationId, customerId });

        // Report critical webhook failure - organization not found
        this.reportCriticalWebhookFailure(
          `Organization ${organizationId} not found for customer ${customerId}`,
          {
            eventType: 'validate_metadata',
            details: {
              customerId,
              organizationId,
              customerEmail: customer.email,
            },
          },
        );

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
    return extractTierFromSubscriptionPrice(subscription);
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
        await this.subscriptionRepo.create(
          {
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
          tx,
        );

        // Update organization_usage limits based on tier
        const limits = TIER_LIMITS[tierLevel];
        await this.subscriptionRepo.upsertUsage(
          organizationId,
          {
            maxSkus: limits.max_skus || 999999,
            maxUsers: limits.max_users || 999999,
            maxInventoryItems: limits.max_inventory_items || 999999,
          },
          {
            organizationId,
            maxSkus: limits.max_skus || 999999,
            maxUsers: limits.max_users || 999999,
            activeUsers: 0,
            totalSkus: 0,
            totalInventoryItems: 0,
            storageUsedBytes: 0,
          },
          tx,
        );

        // Clear creation lock if org was previously locked (new subscription covers usage)
        await this.orgRepo.updateById(organizationId, { isCreationLocked: false }, tx);

        // Log audit event
        await this.auditLogRepo.create(
          {
            organizationId,
            action: 'subscription_created',
            changeDescription: `Subscription created: ${tierLevel} tier`,
          },
          tx,
        );
      });

      // Instantly invalidate auth cache to apply tier changes
      invalidateSubscriptionCache(organizationId);

      const duration = Date.now() - start;
      monitor.recordWebhookEvent('customer.subscription.created', duration, 'success');

      log.info('Subscription handled successfully', {
        organizationId,
        subscriptionId: subscription.id,
      });
    } catch (error: unknown) {
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

      const organizationId = await this.validateWebhookMetadata(subscription.customer as string);
      const oldTier = await this.getOldSubscriptionTier(organizationId);
      const newTierLevel = this.extractTierFromPrice(subscription);
      const isDowngrade = this.isDowngrade(oldTier, newTierLevel);

      await this.updateSubscriptionAndLimits(
        organizationId,
        subscription,
        newTierLevel,
        isDowngrade,
      );

      invalidateSubscriptionCache(organizationId);

      const duration = Date.now() - start;
      monitor.recordWebhookEvent('customer.subscription.updated', duration, 'success');

      log.info('Subscription updated successfully', { organizationId, newTierLevel });
    } catch (error: unknown) {
      this.handleWebhookError('customer.subscription.updated', error, {
        subscriptionId: subscription.id,
        customerId: subscription.customer as string | undefined,
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
        // Set status to canceled and downgrade to Free
        await this.subscriptionRepo.updateManyByOrganizationId(
          organizationId,
          {
            status: SubscriptionStatus.CANCELED,
            tierLevel: 'free',
            trialEndDate: null,
          },
          tx,
        );

        // Update usage limits to Free tier
        const freeLimits = TIER_LIMITS.free;
        await this.subscriptionRepo.updateUsage(
          organizationId,
          {
            maxSkus: freeLimits.max_skus || 500,
            maxUsers: freeLimits.max_users || 1,
            maxInventoryItems: freeLimits.max_inventory_items || 500,
          },
          tx,
        );

        // Apply creation lock if usage exceeds Free limits
        const usage = await this.subscriptionRepo.findUsageByOrganizationId(organizationId, tx);

        if (usage) {
          const isOverSkuLimit = usage.totalSkus > (freeLimits.max_skus || 500);
          const isOverInventoryLimit =
            usage.totalInventoryItems > (freeLimits.max_inventory_items || 500);

          if (isOverSkuLimit || isOverInventoryLimit) {
            await this.orgRepo.updateById(organizationId, { isCreationLocked: true }, tx);

            log.warn('Creation lock applied on subscription cancellation', {
              organizationId,
              currentSkus: usage.totalSkus,
              currentInventoryItems: usage.totalInventoryItems,
              freeSkuLimit: freeLimits.max_skus,
              freeInventoryLimit: freeLimits.max_inventory_items,
            });

            await this.emailService.sendDowngradeWarningEmail(
              organizationId,
              usage.totalSkus,
              freeLimits.max_skus || 500,
            );
          }
        }

        // Log audit event
        await this.auditLogRepo.create(
          {
            organizationId,
            action: 'subscription_canceled',
            changeDescription: `Subscription canceled, downgraded to Starter tier`,
          },
          tx,
        );
      });

      const duration = Date.now() - start;
      monitor.recordWebhookEvent('customer.subscription.deleted', duration, 'success');

      log.info('Subscription deleted successfully', { organizationId });
    } catch (error: unknown) {
      const duration = Date.now() - start;
      monitor.recordWebhookEvent('customer.subscription.deleted', duration, 'error');
      Sentry.captureException(error, {
        level: 'error',
        extra: { subscriptionId: subscription.id },
      });
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

      const organizationId = await this.validateWebhookMetadata(session.customer as string);
      const checkoutData = await this.validateAndExtractCheckoutData(session);

      await this.processCheckoutCompletion(organizationId, session, checkoutData);

      invalidateSubscriptionCache(organizationId);

      log.info('Checkout completed successfully', { organizationId });
      const duration = Date.now() - start;
      monitor.recordWebhookEvent('checkout.session.completed', duration, 'success');
    } catch (error: unknown) {
      this.handleWebhookError('checkout.session.completed', error, {
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

      // Determine if this is the FIRST failure (transition) or a retry
      const currentTier = await this.subscriptionRepo.findByOrganizationId(organizationId);

      const isFirstFailure = currentTier?.status !== SubscriptionStatus.PAST_DUE;

      // Update subscription status to past_due
      await this.prisma.$transaction(async (tx) => {
        await this.subscriptionRepo.updateManyByOrganizationId(
          organizationId,
          {
            status: SubscriptionStatus.PAST_DUE,
            // Only set pastDueSince on first transition — do NOT reset on Stripe retries
            ...(isFirstFailure ? { pastDueSince: new Date() } : {}),
          },
          tx,
        );

        // Log dunning event
        await this.auditLogRepo.create(
          {
            organizationId,
            action: 'payment_failed',
            changeDescription: `Invoice ${invoice.id} payment failed: ${invoice.amount_due} cents (attempt ${isFirstFailure ? 1 : 'retry'})`,
          },
          tx,
        );
      });

      // Queue dunning email (non-blocking)
      await this.emailService.sendDunningEmail(
        organizationId,
        invoice.hosted_invoice_url || undefined,
      );

      log.info('Payment failure handled', { organizationId, invoiceId: invoice.id });
      const duration = Date.now() - start;
      monitor.recordWebhookEvent('invoice.payment_failed', duration, 'success');
    } catch (error: unknown) {
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
    } catch (error: unknown) {
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
   * Handle payment_intent.succeeded
   *
   * Confirms payment for trial conversion, updates subscription status to ACTIVE.
   */
  private async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const monitor = ApplicationMonitoringService.getInstance();
    const start = Date.now();

    try {
      log.info('Payment intent succeeded', {
        paymentIntentId: paymentIntent.id,
        customerId: paymentIntent.customer,
        amount: paymentIntent.amount,
      });

      // Extract organizationId from customer metadata
      const organizationId = await this.validateWebhookMetadata(paymentIntent.customer as string);

      // Find subscription by customer and update status to ACTIVE
      await this.prisma.$transaction(async (tx) => {
        // Find the TRIALING subscription for this organization
        const subscription = await this.subscriptionRepo.findTrialingByOrganizationId(
          organizationId,
          tx,
        );

        if (!subscription) {
          log.warn(
            'No TRIALING subscription found for organization, skipping payment confirmation',
            {
              organizationId,
              paymentIntentId: paymentIntent.id,
            },
          );
          return;
        }

        // Update status to ACTIVE and clear pastDueSince (recovery from past_due)
        await this.subscriptionRepo.update(
          subscription.id,
          {
            status: SubscriptionStatus.ACTIVE,
            trialConvertedAt: new Date(),
            pastDueSince: null,
          },
          tx,
        );

        // Log trial conversion event
        await this.trialEventRepo.create(
          {
            organizationId,
            eventType: 'payment_confirmed',
            metadata: JSON.stringify({
              paymentIntentId: paymentIntent.id,
              amount: paymentIntent.amount,
            }),
          },
          tx,
        );

        // Log audit event
        await this.auditLogRepo.create(
          {
            organizationId,
            action: 'trial_converted',
            changeDescription: `Trial converted to paid subscription via payment intent ${paymentIntent.id}`,
          },
          tx,
        );
      });

      const duration = Date.now() - start;
      monitor.recordWebhookEvent('payment_intent.succeeded', duration, 'success');

      log.info('Payment intent processed successfully', {
        organizationId,
        paymentIntentId: paymentIntent.id,
      });
    } catch (error: unknown) {
      const duration = Date.now() - start;
      monitor.recordWebhookEvent('payment_intent.succeeded', duration, 'error');
      Sentry.captureException(error, {
        level: 'error',
        extra: { paymentIntentId: paymentIntent.id },
      });
      log.error('Failed to handle payment intent succeeded', {
        error: error instanceof Error ? error.message : 'Unknown error',
        paymentIntentId: paymentIntent.id,
      });
      throw error;
    }
  }

  /**
   * Handle payment_intent.payment_failed
   *
   * Logs failure event and sends alert email to admin.
   */
  private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const monitor = ApplicationMonitoringService.getInstance();
    const start = Date.now();

    try {
      log.error('Payment intent failed', {
        paymentIntentId: paymentIntent.id,
        customerId: paymentIntent.customer,
        amount: paymentIntent.amount,
        error: paymentIntent.last_payment_error?.message,
      });

      // Extract organizationId from customer metadata
      const organizationId = await this.validateWebhookMetadata(paymentIntent.customer as string);

      // Log failure event
      await this.trialEventRepo.create({
        organizationId,
        eventType: 'payment_failed',
        metadata: JSON.stringify({
          paymentIntentId: paymentIntent.id,
          amount: paymentIntent.amount,
          error: paymentIntent.last_payment_error?.message,
          errorCode: paymentIntent.last_payment_error?.code,
        }),
      });

      // Send alert email to admin
      await this.emailService.sendPaymentFailedEmail({
        organizationId,
        paymentIntentId: paymentIntent.id,
        errorMessage: paymentIntent.last_payment_error?.message || 'Unknown error',
      });

      const duration = Date.now() - start;
      monitor.recordWebhookEvent('payment_intent.payment_failed', duration, 'success');

      log.info('Payment failure handled', { organizationId, paymentIntentId: paymentIntent.id });
    } catch (error: unknown) {
      const duration = Date.now() - start;
      monitor.recordWebhookEvent('payment_intent.payment_failed', duration, 'error');
      Sentry.captureException(error, {
        level: 'error',
        extra: { paymentIntentId: paymentIntent.id },
      });
      log.error('Failed to handle payment intent failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        paymentIntentId: paymentIntent.id,
      });
      throw error;
    }
  }

  /**
   * Report webhook processing error to Sentry with context
   */
  private reportWebhookError(
    error: Error,
    context: {
      eventType: string;
      eventId?: string;
      organizationId?: string;
      customerId?: string;
      subscriptionId?: string;
    },
  ): void {
    Sentry.captureException(error, {
      tags: {
        component: 'webhook',
        event_type: context.eventType,
        error_type: error.constructor.name,
      },
      extra: {
        eventId: context.eventId,
        organizationId: context.organizationId,
        customerId: context.customerId,
        subscriptionId: context.subscriptionId,
        errorMessage: error.message,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Report webhook critical failure
   */
  private reportCriticalWebhookFailure(
    message: string,
    context: {
      eventType: string;
      eventId?: string;
      details?: Record<string, unknown>;
    },
  ): void {
    Sentry.captureMessage(message, {
      level: 'fatal',
      tags: {
        component: 'webhook',
        event_type: context.eventType,
        severity: 'critical',
      },
      extra: {
        eventId: context.eventId,
        ...context.details,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Get the old subscription tier for an organization
   */
  private async getOldSubscriptionTier(organizationId: string) {
    return await this.subscriptionRepo.findByOrganizationId(organizationId);
  }

  /**
   * Check if a tier change is a downgrade
   */
  private isDowngrade(oldTier: SubscriptionTier | null, newTierLevel: TierLevel): boolean {
    if (!oldTier) return false;

    return (
      TIER_LIMITS[newTierLevel].max_skus !== null &&
      (TIER_LIMITS[oldTier.tierLevel as TierLevel].max_skus === null ||
        (TIER_LIMITS[newTierLevel].max_skus as number) <
          (TIER_LIMITS[oldTier.tierLevel as TierLevel].max_skus as number))
    );
  }

  /**
   * Update subscription and usage limits in a transaction
   */
  private async updateSubscriptionAndLimits(
    organizationId: string,
    subscription: Stripe.Subscription,
    newTierLevel: TierLevel,
    isDowngrade: boolean,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const limits = getTierLimits(newTierLevel);

      // Sync subscription state
      await this.syncSubscriptionTier(tx, organizationId, subscription, newTierLevel);

      // Update usage limits
      await this.updateUsageLimits(tx, organizationId, limits);

      // Handle creation lock if downgrading
      await this.handleCreationLock(tx, organizationId, limits, isDowngrade);

      // Log audit event
      await this.auditLogRepo.create(
        {
          organizationId,
          action: 'subscription_updated',
          changeDescription: `Subscription updated to ${newTierLevel} tier`,
        },
        tx,
      );
    });
  }

  /**
   * Sync subscription tier (create or update)
   */
  private async syncSubscriptionTier(
    tx: Prisma.TransactionClient,
    organizationId: string,
    subscription: Stripe.Subscription,
    newTierLevel: TierLevel,
  ): Promise<void> {
    const existingTier = await this.subscriptionRepo.findByOrganizationId(organizationId, tx);

    const subscriptionData = {
      tierLevel: newTierLevel,
      stripeSubscriptionId: subscription.id,
      status: subscription.status,
      trialEndDate: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
      billingCycle:
        subscription.items.data[0]?.price.recurring?.interval === 'year' ? 'annual' : 'monthly',
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodEnd: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null,
    };

    if (existingTier) {
      await this.subscriptionRepo.update(existingTier.id, subscriptionData, tx);
    } else {
      await this.subscriptionRepo.create(
        {
          organizationId,
          ...subscriptionData,
        },
        tx,
      );
    }
  }

  /**
   * Update organization usage limits
   */
  private async updateUsageLimits(
    tx: Prisma.TransactionClient,
    organizationId: string,
    limits: TierLimits,
  ): Promise<void> {
    await this.subscriptionRepo.upsertUsage(
      organizationId,
      {
        maxSkus: limits.max_skus ?? DEFAULT_LIMITS.UNLIMITED_SKUS,
        maxUsers: limits.max_users ?? DEFAULT_LIMITS.UNLIMITED_USERS,
        maxInventoryItems: limits.max_inventory_items ?? DEFAULT_LIMITS.UNLIMITED_INVENTORY_ITEMS,
      },
      {
        organizationId,
        activeUsers: 0,
        totalSkus: 0,
        totalInventoryItems: 0,
        storageUsedBytes: 0,
        maxSkus: limits.max_skus ?? DEFAULT_LIMITS.UNLIMITED_SKUS,
        maxUsers: limits.max_users ?? DEFAULT_LIMITS.UNLIMITED_USERS,
        maxInventoryItems: limits.max_inventory_items ?? DEFAULT_LIMITS.UNLIMITED_INVENTORY_ITEMS,
      },
      tx,
    );
  }

  /**
   * Handle creation lock for downgrades
   */
  private async handleCreationLock(
    tx: Prisma.TransactionClient,
    organizationId: string,
    limits: TierLimits,
    isDowngrade: boolean,
  ): Promise<void> {
    if (!isDowngrade) {
      await this.orgRepo.updateById(organizationId, { isCreationLocked: false }, tx);
      return;
    }

    const result = await applyCreationLockIfNeeded(organizationId, limits, tx, {
      orgRepo: this.orgRepo,
      subscriptionRepo: this.subscriptionRepo,
      emailService: this.emailService,
    });

    if (result.lockApplied) {
      log.warn('Creation lock applied on tier downgrade', {
        organizationId,
        currentSkus: result.currentSkus,
        currentInventoryItems: result.currentInventoryItems,
        newSkuLimit: result.skuLimit,
        newInventoryLimit: result.inventoryLimit,
      });
    }
  }

  /**
   * Handle webhook errors consistently
   */
  private handleWebhookError(
    eventType: string,
    error: Error | unknown,
    context: {
      subscriptionId?: string;
      customerId?: string;
      sessionId?: string;
    },
  ): void {
    const monitor = ApplicationMonitoringService.getInstance();
    const monitorWithStartTime = monitor as { lastStartTime?: number };
    const duration =
      typeof monitorWithStartTime.lastStartTime === 'number'
        ? Date.now() - monitorWithStartTime.lastStartTime
        : 0;

    monitor.recordWebhookEvent(eventType, duration, 'error');

    Sentry.captureException(error, {
      level: 'error',
      extra: context,
    });

    log.error(`Failed to handle ${eventType}`, {
      error: error instanceof Error ? error.message : 'Unknown error',
      ...context,
    });
  }

  /**
   * Validate and extract data from checkout session
   */
  private async validateAndExtractCheckoutData(session: Stripe.Checkout.Session): Promise<{
    stripeSubscription: Stripe.Subscription;
    tierLevel: TierLevel;
    limits: TierLimits;
  }> {
    if (!session.subscription || typeof session.subscription !== 'string') {
      throw new Error('checkout.session.completed missing subscription id');
    }

    const stripeSubscriptionResponse = await this.getStripeClient().subscriptions.retrieve(
      session.subscription,
    );
    const stripeSubscription = stripeSubscriptionResponse as Stripe.Subscription;
    const tierLevel = this.extractTierFromPrice(stripeSubscription);
    const limits = getTierLimits(tierLevel);

    return {
      stripeSubscription,
      tierLevel,
      limits,
    };
  }

  /**
   * Process checkout completion in a transaction
   */
  private async processCheckoutCompletion(
    organizationId: string,
    session: Stripe.Checkout.Session,
    checkoutData: {
      stripeSubscription: Stripe.Subscription;
      tierLevel: TierLevel;
      limits: TierLimits;
    },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Update subscription tier
      await this.updateSubscriptionFromCheckout(tx, organizationId, session, checkoutData);

      // Update usage limits
      await this.updateUsageLimitsFromCheckout(tx, organizationId, checkoutData.limits);

      // Unlock creation
      await this.orgRepo.updateById(organizationId, { isCreationLocked: false }, tx);

      // Log audit event
      await this.auditLogRepo.create(
        {
          organizationId,
          action: 'trial_converted',
          changeDescription: `Trial converted to paid subscription (${checkoutData.tierLevel})`,
        },
        tx,
      );
    });
  }

  /**
   * Update subscription tier from checkout
   */
  private async updateSubscriptionFromCheckout(
    tx: Prisma.TransactionClient,
    organizationId: string,
    session: Stripe.Checkout.Session,
    checkoutData: {
      stripeSubscription: Stripe.Subscription;
      tierLevel: TierLevel;
    },
  ): Promise<void> {
    await this.subscriptionRepo.updateManyByOrganizationIdAndStripeSubscriptionId(
      organizationId,
      session.subscription as string,
      {
        tierLevel: checkoutData.tierLevel,
        trialEndDate: null, // Clear trial end date
        status: SubscriptionStatus.ACTIVE, // Set to active
        billingCycle:
          checkoutData.stripeSubscription.items.data[0]?.price.recurring?.interval === 'year'
            ? 'annual'
            : 'monthly',
      },
      tx,
    );
  }

  /**
   * Update usage limits from checkout
   */
  private async updateUsageLimitsFromCheckout(
    tx: Prisma.TransactionClient,
    organizationId: string,
    limits: TierLimits,
  ): Promise<void> {
    await this.subscriptionRepo.upsertUsage(
      organizationId,
      {
        maxSkus: limits.max_skus ?? DEFAULT_LIMITS.UNLIMITED_SKUS,
        maxUsers: limits.max_users ?? DEFAULT_LIMITS.UNLIMITED_USERS,
        maxInventoryItems: limits.max_inventory_items ?? DEFAULT_LIMITS.UNLIMITED_INVENTORY_ITEMS,
      },
      {
        organizationId,
        maxSkus: limits.max_skus ?? DEFAULT_LIMITS.UNLIMITED_SKUS,
        maxUsers: limits.max_users ?? DEFAULT_LIMITS.UNLIMITED_USERS,
        maxInventoryItems: limits.max_inventory_items ?? DEFAULT_LIMITS.UNLIMITED_INVENTORY_ITEMS,
        activeUsers: 0,
        totalSkus: 0,
        totalInventoryItems: 0,
        storageUsedBytes: 0,
      },
      tx,
    );
  }
}

// ============================================================================
// Standalone Helper Functions (independently testable)
// ============================================================================

export function extractTierFromSubscriptionPrice(subscription: Stripe.Subscription): TierLevel {
  const price = subscription.items.data[0]?.price;
  if (!price) {
    log.warn('No price found on subscription, defaulting to free', {
      subscriptionId: subscription.id,
    });
    return 'free';
  }

  const tier = (price.metadata?.tier as TierLevel) || 'free';
  if (!Object.keys(TIER_LIMITS).includes(tier)) {
    log.warn('Unknown tier in price metadata, defaulting to free', {
      subscriptionId: subscription.id,
      priceId: price.id,
      tier,
    });
    return 'free';
  }

  return tier;
}

export interface CreationLockDeps {
  orgRepo: OrganizationRepository;
  subscriptionRepo: SubscriptionRepository;
  emailService: EmailService;
}

export interface CreationLockResult {
  lockApplied: boolean;
  currentSkus?: number;
  currentInventoryItems?: number;
  skuLimit?: number | null;
  inventoryLimit?: number | null;
}

export async function applyCreationLockIfNeeded(
  organizationId: string,
  limits: TierLimits,
  tx: Prisma.TransactionClient,
  deps: CreationLockDeps,
): Promise<CreationLockResult> {
  const usage = await deps.subscriptionRepo.findUsageByOrganizationId(organizationId, tx);

  if (!usage) {
    return { lockApplied: false };
  }

  const isOverSkuLimit = limits.max_skus !== null && usage.totalSkus > limits.max_skus;
  const isOverInventoryLimit =
    limits.max_inventory_items !== null && usage.totalInventoryItems > limits.max_inventory_items;

  if (isOverSkuLimit || isOverInventoryLimit) {
    await deps.orgRepo.updateById(organizationId, { isCreationLocked: true }, tx);

    if (isOverSkuLimit && limits.max_skus !== null) {
      await deps.emailService.sendDowngradeWarningEmail(
        organizationId,
        usage.totalSkus,
        limits.max_skus,
      );
    }

    return {
      lockApplied: true,
      currentSkus: usage.totalSkus,
      currentInventoryItems: usage.totalInventoryItems,
      skuLimit: limits.max_skus,
      inventoryLimit: limits.max_inventory_items,
    };
  }

  return { lockApplied: false };
}

export const webhookService = new WebhookService();
