/**
 * Stripe Subscription Service
 * Handles subscription lifecycle management:
 * - Creating subscriptions in Stripe + local database
 * - Updating subscription prices (upgrades/downgrades)
 * - Canceling and reactivating subscriptions
 * - Syncing Stripe state to local database
 */

import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';
import { getDefaultDatabaseClient } from '../database/database-factory';
import { envConfig } from '../config/environment';
import { Logger } from '../utils/logger';
import { SubscriptionTier } from '../models/subscription-tier.model';
import { BillingCycle, SubscriptionStatus, TierLevel, TIER_LIMITS } from '../types/subscription';
import { InternalError, NotFoundError } from '../errors';
import * as Sentry from '@sentry/node';

export class SubscriptionService {
  private prisma: PrismaClient;
  private stripe: Stripe;

  constructor(prismaClient?: PrismaClient, stripeClient?: Stripe) {
    this.prisma = prismaClient ?? getDefaultDatabaseClient();
    this.stripe =
      stripeClient ??
      new Stripe(envConfig.STRIPE_SECRET_KEY!, {
        apiVersion: '2023-08-16',
      });
  }

  /**
   * Get pricing limits for a subscription tier
   */
  getTierLimits(tierLevel: TierLevel): Record<string, number | null> {
    return TIER_LIMITS[tierLevel] || {};
  }

  /**
   * Determine if an organization should retain access based on Stripe state
   */
  async isAccessActive(subscriptionTier: SubscriptionTier): Promise<boolean> {
    if (subscriptionTier.status !== SubscriptionStatus.CANCELED) {
      return true;
    }

    if (!subscriptionTier.stripeSubscriptionId) {
      return false;
    }

    try {
      const stripeSubscription = await this.stripe.subscriptions.retrieve(
        subscriptionTier.stripeSubscriptionId,
      );

      if (stripeSubscription.status !== 'canceled') {
        return true;
      }

      const periodEnd = stripeSubscription.current_period_end
        ? new Date(stripeSubscription.current_period_end * 1000)
        : null;

      return Boolean(
        stripeSubscription.cancel_at_period_end && periodEnd && periodEnd.getTime() > Date.now(),
      );
    } catch (error) {
      Logger.warn('Failed to verify Stripe access window', {
        organizationId: subscriptionTier.organizationId,
        stripeSubscriptionId: subscriptionTier.stripeSubscriptionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Create a trial subscription for a newly created organization.
   * No Stripe subscription is created — trial is tracked locally only.
   * Stripe customer is created here so it can be reused on conversion.
   *
   * @param organizationId - Organization UUID
   * @param trialDays - Number of trial days (default: 14)
   */
  async createTrialSubscription(organizationId: string, trialDays: number = 14): Promise<void> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw new NotFoundError(`Organization ${organizationId} not found`);
    }

    // Create Stripe customer now so it's ready for conversion later
    const stripeCustomer = await this.stripe.customers.create({
      email: organization.contactEmail ?? undefined,
      description: `Org: ${organization.name}`,
      metadata: { organizationId },
    });

    const trialEndDate = new Date();
    trialEndDate.setUTCDate(trialEndDate.getUTCDate() + trialDays);
    trialEndDate.setUTCHours(0, 0, 0, 0); // Expire at 00:00 UTC on day N

    await this.prisma.subscriptionTier.create({
      data: {
        organizationId,
        tierLevel: 'professional' as TierLevel,
        status: SubscriptionStatus.TRIALING,
        stripeCustomerId: stripeCustomer.id,
        trialStartedAt: new Date(),
        trialEndDate,
        billingCycle: BillingCycle.MONTHLY,
      },
    });

    // Initialize organization usage with Professional tier limits (16A.C.1)
    const professionalLimits = TIER_LIMITS['professional'];
    await this.prisma.organizationUsage.create({
      data: {
        organizationId,
        activeUsers: 1,
        maxUsers: professionalLimits.max_users ?? 10,
        totalSkus: 0,
        maxSkus: professionalLimits.max_skus ?? 2000,
        totalInventoryItems: 0,
        maxInventoryItems: professionalLimits.max_inventory_items ?? 20000,
        storageUsedBytes: 0,
      },
    });

    // Log trial_started event (16A.C.5)
    await this.logTrialEvent(organizationId, 'trial_started', {
      trialDays,
      tierLevel: 'professional',
      trialEndDate: trialEndDate.toISOString(),
    });

    Logger.info(
      `Trial subscription created for organization ${organizationId}, ends ${trialEndDate.toISOString()}`,
    );
  }

  /**
   * Create a new subscription for an organization
   * 1. Verify organization exists
   * 2. Create Stripe customer
   * 3. Create Stripe subscription
   * 4. Store subscription ID in local database
   *
   * @param organizationId - Organization UUID
   * @param priceId - Stripe price ID
   * @param billingCycle - Monthly or Annual
   * @returns Created subscription tier
   */
  async createSubscription(
    organizationId: string,
    priceId: string,
    billingCycle: BillingCycle,
  ): Promise<SubscriptionTier> {
    try {
      // 1. Verify organization exists
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
      });

      if (!organization) {
        throw new NotFoundError(`Organization ${organizationId} not found`);
      }

      // 2. Create Stripe customer
      const stripeCustomer = await this.stripe.customers.create({
        description: `Pharmacy: ${organization.name}`,
        metadata: {
          organizationId,
        },
      });

      // 3. Create Stripe subscription
      const stripeSubscription = await this.stripe.subscriptions.create({
        customer: stripeCustomer.id,
        items: [
          {
            price: priceId,
          },
        ],
        payment_behavior: 'default_incomplete',
        collection_method: 'charge_automatically',
      });

      // 4. Extract tier from price metadata
      const tierLevel = this.extractTierFromPrice(stripeSubscription);

      // 5. Store in local database
      const subscriptionTier = await this.prisma.subscriptionTier.create({
        data: {
          organizationId,
          tierLevel,
          stripeSubscriptionId: stripeSubscription.id,
          status: this.mapStripeStatusToLocal(stripeSubscription.status),
          billingCycle,
          trialEndDate: stripeSubscription.trial_end
            ? new Date(stripeSubscription.trial_end * 1000)
            : null,
        },
      });

      Logger.info(
        `Created subscription ${stripeSubscription.id} for organization ${organizationId}`,
      );

      return this.mapPrismaToModel(subscriptionTier);
    } catch (error: any) {
      Logger.error(`Failed to create subscription: ${error}`);

      // Capture Stripe errors with request ID for debugging
      if (error instanceof Stripe.errors.StripeError) {
        Sentry.captureException(error, {
          level: 'error',
          tags: { service: 'subscription-service', event: 'create-subscription' },
          extra: {
            organizationId,
            stripeRequestId: error.requestId,
            stripeCode: error.code,
            stripeDeclineCode: error.decline_code,
          },
        });
      } else {
        Sentry.captureException(error, {
          level: 'error',
          tags: { service: 'subscription-service', event: 'create-subscription' },
          extra: { organizationId },
        });
      }

      if (error instanceof NotFoundError) {
        throw error;
      }

      if (error instanceof Error && error.message.includes('Stripe')) {
        throw new InternalError(`Stripe API error: ${error.message}`);
      }

      throw error;
    }
  }

  /**
   * Update an existing subscription with a new price
   * Handles tier upgrades/downgrades with prorating
   *
   * @param organizationId - Organization UUID
   * @param newPriceId - New Stripe price ID
   * @returns Updated subscription tier
   */
  async updateSubscription(organizationId: string, newPriceId: string): Promise<SubscriptionTier> {
    try {
      // Find existing subscription
      const subscriptionTier = await this.prisma.subscriptionTier.findFirst({
        where: { organizationId },
      });

      if (!subscriptionTier || !subscriptionTier.stripeSubscriptionId) {
        throw new NotFoundError(`No subscription found for organization ${organizationId}`);
      }

      // Get current Stripe subscription to access subscription items
      const stripeSubscription = await this.stripe.subscriptions.retrieve(
        subscriptionTier.stripeSubscriptionId,
      );

      // Update subscription with new price
      const itemId = stripeSubscription.items.data[0]?.id;
      if (!itemId) {
        throw new InternalError('No subscription items found in Stripe subscription');
      }

      const updatedSubscription = await this.stripe.subscriptions.update(
        subscriptionTier.stripeSubscriptionId,
        {
          items: [
            {
              id: itemId,
              price: newPriceId,
            },
          ],
          proration_behavior: 'create_prorations',
        },
      );

      // Extract new tier from updated subscription
      const newTierLevel = this.extractTierFromPrice(updatedSubscription);

      // Update local database
      const updated = await this.prisma.subscriptionTier.update({
        where: { id: subscriptionTier.id },
        data: {
          tierLevel: newTierLevel,
          status: this.mapStripeStatusToLocal(updatedSubscription.status),
        },
      });

      Logger.info(`Updated subscription for organization ${organizationId} to ${newTierLevel}`);

      return this.mapPrismaToModel(updated);
    } catch (error) {
      Logger.error(`Failed to update subscription: ${error}`);

      if (error instanceof NotFoundError || error instanceof InternalError) {
        throw error;
      }

      if (error instanceof Error && error.message.includes('Stripe')) {
        throw new InternalError(`Stripe API error: ${error.message}`);
      }

      throw error;
    }
  }

  /**
   * Cancel a subscription at the end of the billing period
   * Keeps the subscription record and customer for future reactivation
   *
   * @param organizationId - Organization UUID
   * @returns Updated subscription tier
   */
  async cancelSubscription(organizationId: string): Promise<SubscriptionTier> {
    try {
      // Find existing subscription
      const subscriptionTier = await this.prisma.subscriptionTier.findFirst({
        where: { organizationId },
      });

      if (!subscriptionTier || !subscriptionTier.stripeSubscriptionId) {
        throw new NotFoundError(`No subscription found for organization ${organizationId}`);
      }

      // Cancel at period end (preserves data until end of billing cycle)
      const canceledSubscription = await this.stripe.subscriptions.update(
        subscriptionTier.stripeSubscriptionId,
        {
          cancel_at_period_end: true,
        },
      );

      // Update local database
      const updated = await this.prisma.subscriptionTier.update({
        where: { id: subscriptionTier.id },
        data: {
          status: this.mapStripeStatusToLocal(canceledSubscription.status),
        },
      });

      Logger.info(`Canceled subscription ${subscriptionTier.stripeSubscriptionId} at period end`);

      return this.mapPrismaToModel(updated);
    } catch (error) {
      Logger.error(`Failed to cancel subscription: ${error}`);

      if (error instanceof NotFoundError) {
        throw error;
      }

      if (error instanceof Error && error.message.includes('Stripe')) {
        throw new InternalError(`Stripe API error: ${error.message}`);
      }

      throw error;
    }
  }

  /**
   * Reactivate a previously canceled subscription
   *
   * @param organizationId - Organization UUID
   * @returns Updated subscription tier
   */
  async reactivateSubscription(organizationId: string): Promise<SubscriptionTier> {
    try {
      // Find existing subscription
      const subscriptionTier = await this.prisma.subscriptionTier.findFirst({
        where: { organizationId },
      });

      if (!subscriptionTier || !subscriptionTier.stripeSubscriptionId) {
        throw new NotFoundError(`No subscription found for organization ${organizationId}`);
      }

      // Resume subscription
      const reactivatedSubscription = await this.stripe.subscriptions.update(
        subscriptionTier.stripeSubscriptionId,
        {
          cancel_at_period_end: false,
        },
      );

      // Update local database
      const updated = await this.prisma.subscriptionTier.update({
        where: { id: subscriptionTier.id },
        data: {
          status: this.mapStripeStatusToLocal(reactivatedSubscription.status),
        },
      });

      Logger.info(
        `Reactivated subscription ${subscriptionTier.stripeSubscriptionId} for organization ${organizationId}`,
      );

      return this.mapPrismaToModel(updated);
    } catch (error) {
      Logger.error(`Failed to reactivate subscription: ${error}`);

      if (error instanceof NotFoundError) {
        throw error;
      }

      if (error instanceof Error && error.message.includes('Stripe')) {
        throw new InternalError(`Stripe API error: ${error.message}`);
      }

      throw error;
    }
  }

  /**
   * Sync Stripe subscription state to local database
   * Called from webhook handlers to keep local state in sync
   *
   * @param organizationId - Organization UUID
   * @param stripeSubscription - Stripe subscription object from webhook
   * @returns Updated subscription tier
   */
  async syncSubscriptionState(
    organizationId: string,
    stripeSubscription: Stripe.Subscription,
  ): Promise<SubscriptionTier> {
    try {
      // Find existing subscription
      const subscriptionTier = await this.prisma.subscriptionTier.findFirst({
        where: { organizationId },
      });

      if (!subscriptionTier) {
        throw new NotFoundError(`No subscription found for organization ${organizationId}`);
      }

      // Extract tier from price metadata
      const tierLevel = this.extractTierFromPrice(stripeSubscription);

      // Update local database atomically
      const updated = await this.prisma.subscriptionTier.update({
        where: { id: subscriptionTier.id },
        data: {
          tierLevel,
          status: this.mapStripeStatusToLocal(stripeSubscription.status),
          trialEndDate: stripeSubscription.trial_end
            ? new Date(stripeSubscription.trial_end * 1000)
            : null,
          stripeSubscriptionId: stripeSubscription.id,
        },
      });

      Logger.info(`Synced subscription state for organization ${organizationId}`);

      return this.mapPrismaToModel(updated);
    } catch (error) {
      Logger.error(`Failed to sync subscription state: ${error}`);

      if (error instanceof NotFoundError) {
        throw error;
      }

      throw error;
    }
  }

  /**
   * Extract tier level from Stripe subscription's price metadata
   * Relies on price metadata: { tier: 'starter' | 'professional' | 'premium' | 'concierge' }
   */
  private extractTierFromPrice(subscription: Stripe.Subscription): TierLevel {
    const price = subscription.items.data[0]?.price;
    if (!price) {
      Logger.warn('No price found in subscription items');
      return 'starter'; // Default fallback
    }

    const tier = (price.metadata?.tier as TierLevel) || 'starter';

    // Validate tier is known
    if (!Object.keys(TIER_LIMITS).includes(tier)) {
      Logger.warn(`Unknown tier ${tier} from price metadata, using starter`);
      return 'starter';
    }

    return tier;
  }

  /**
   * Map Stripe subscription status to local SubscriptionStatus enum
   */
  private mapStripeStatusToLocal(
    stripeStatus: Stripe.Subscription.Status | string,
  ): SubscriptionStatus {
    switch (stripeStatus) {
      case 'active':
        return SubscriptionStatus.ACTIVE;
      case 'canceled':
        return SubscriptionStatus.CANCELED;
      case 'past_due':
        return SubscriptionStatus.PAST_DUE;
      case 'trialing':
        return SubscriptionStatus.TRIALING;
      case 'incomplete':
      case 'incomplete_expired':
      default:
        // Map incomplete states to active (they may transition)
        return SubscriptionStatus.ACTIVE;
    }
  }

  // ========== Phase 5: Trial Reminder System ==========

  /**
   * Find trials that need reminder emails
   * Queries trials where trialEndDate is in the next 14 days AND daysRemaining is [10, 5, 2]
   * Filters out trials where reminder already sent (check sentRemindersAt in trial_events)
   */
  async findTrialsNeedingReminders(): Promise<
    Array<{
      organizationId: string;
      organizationName: string;
      contactEmail: string | null;
      daysRemaining: number;
      trialEndDate: Date;
    }>
  > {
    const now = new Date();
    const fourteenDaysFromNow = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    // Find trials expiring in the next 14 days
    const expiringTrials = await this.prisma.subscriptionTier.findMany({
      where: {
        status: SubscriptionStatus.TRIALING,
        trialEndDate: {
          gte: now,
          lte: fourteenDaysFromNow,
        },
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            contactEmail: true,
          },
        },
      },
    });

    const results: Array<{
      organizationId: string;
      organizationName: string;
      contactEmail: string | null;
      daysRemaining: number;
      trialEndDate: Date;
    }> = [];

    for (const trial of expiringTrials) {
      const daysRemaining = Math.ceil(
        (trial.trialEndDate!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      // Only send for specific day thresholds
      if (![10, 5, 2].includes(daysRemaining)) continue;

      // Check if reminder already sent for this day
      const existingEvent = await this.prisma.trialEvent.findFirst({
        where: {
          organizationId: trial.organizationId,
          eventType: 'trial_reminder_sent',
          occurredAt: {
            gte: new Date(now.getTime() - 24 * 60 * 60 * 1000), // Last 24h
          },
        },
      });

      if (existingEvent) continue;

      results.push({
        organizationId: trial.organizationId,
        organizationName: trial.organization.name,
        contactEmail: trial.organization.contactEmail,
        daysRemaining,
        trialEndDate: trial.trialEndDate!,
      });
    }

    return results;
  }

  /**
   * Log a trial event for tracking reminders and conversions
   */
  async logTrialEvent(
    organizationId: string,
    eventType: string,
    metadata: Record<string, any> = {},
  ): Promise<void> {
    await this.prisma.trialEvent.create({
      data: {
        organizationId,
        eventType,
        metadata: JSON.stringify(metadata),
        occurredAt: new Date(),
      },
    });
  }

  // ========== Phase 6: Trial Downgrade (Expired → Starter) ==========

  /**
   * Downgrade all expired trials to starter tier
   * Uses prisma.$transaction() for atomicity
   * Returns count of downgraded trials
   */
  async downgradeExpiredTrials(): Promise<number> {
    const now = new Date();

    // Find all TRIALING subscriptions that have expired
    const expiredTrials = await this.prisma.subscriptionTier.findMany({
      where: {
        status: SubscriptionStatus.TRIALING,
        trialEndDate: {
          lt: now,
        },
      },
      select: {
        id: true,
        organizationId: true,
      },
    });

    if (expiredTrials.length === 0) {
      return 0;
    }

    // Downgrade each in a transaction
    let downgradedCount = 0;

    for (const trial of expiredTrials) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // Update subscription to starter tier
          await tx.subscriptionTier.update({
            where: { id: trial.id },
            data: {
              status: SubscriptionStatus.ACTIVE,
              tierLevel: 'starter',
              stripeSubscriptionId: null,
            },
          });

          // Log the event
          await tx.trialEvent.create({
            data: {
              organizationId: trial.organizationId,
              eventType: 'trial_expired',
              metadata: JSON.stringify({ downgradedTo: 'starter' }),
              occurredAt: new Date(),
            },
          });
        });

        downgradedCount++;
        Logger.info(`Downgraded expired trial for organization ${trial.organizationId}`);
      } catch (error) {
        Logger.error(`Failed to downgrade trial for org ${trial.organizationId}: ${String(error)}`);
        // Continue with other trials even if one fails
      }
    }

    return downgradedCount;
  }

  // ========== Dunning: Auto-downgrade past_due subscriptions (7-day grace period) ==========

  /**
   * Downgrade subscriptions that have been past_due for more than 7 days.
   * DECISION 8A.9: 7-day grace period before auto-downgrade.
   *
   * For each expired past_due subscription:
   * 1. Atomically update to starter tier (status=active)
   * 2. Reset organization_usage limits to Starter
   * 3. Apply isCreationLocked if usage exceeds Starter limits
   * 4. Log dunning_downgrade audit event
   * 5. Send Sentry fatal escalation alert
   *
   * @returns Number of organizations downgraded
   */
  async downgradeExpiredPastDue(): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Find all past_due subscriptions that have exceeded the grace period
    const expiredPastDue = await this.prisma.subscriptionTier.findMany({
      where: {
        status: SubscriptionStatus.PAST_DUE,
        pastDueSince: { lte: sevenDaysAgo },
      },
      select: {
        id: true,
        organizationId: true,
        pastDueSince: true,
      },
    });

    if (expiredPastDue.length === 0) {
      return 0;
    }

    const starterLimits = TIER_LIMITS.starter;
    let downgradedCount = 0;

    for (const tier of expiredPastDue) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // 1. Downgrade to Starter, clear pastDueSince
          await tx.subscriptionTier.updateMany({
            where: { organizationId: tier.organizationId },
            data: {
              status: SubscriptionStatus.ACTIVE,
              tierLevel: 'starter',
              pastDueSince: null,
            },
          });

          // 2. Reset usage limits to Starter tier
          await tx.organizationUsage.update({
            where: { organizationId: tier.organizationId },
            data: {
              maxSkus: starterLimits.max_skus ?? 500,
              maxUsers: starterLimits.max_users ?? 1,
              maxInventoryItems: starterLimits.max_inventory_items ?? 5000,
            },
          });

          // 3. Check if usage exceeds new Starter limits — apply creation lock if so
          const usage = await tx.organizationUsage.findUnique({
            where: { organizationId: tier.organizationId },
          });

          const isOverSkuLimit =
            starterLimits.max_skus !== null &&
            usage &&
            usage.totalSkus > starterLimits.max_skus;

          const isOverInventoryLimit =
            starterLimits.max_inventory_items !== null &&
            usage &&
            usage.totalInventoryItems > starterLimits.max_inventory_items;

          const isOverUserLimit =
            starterLimits.max_users !== null &&
            usage &&
            usage.activeUsers > starterLimits.max_users;

          if (isOverSkuLimit || isOverInventoryLimit || isOverUserLimit) {
            await tx.organization.update({
              where: { id: tier.organizationId },
              data: { isCreationLocked: true },
            });

            Logger.warn('Creation lock applied after dunning downgrade', {
              organizationId: tier.organizationId,
              totalSkus: usage?.totalSkus,
              totalInventoryItems: usage?.totalInventoryItems,
              starterSkuLimit: starterLimits.max_skus,
              starterInventoryLimit: starterLimits.max_inventory_items,
            });
          }

          // 4. Log audit event
          await tx.auditLog.create({
            data: {
              organizationId: tier.organizationId,
              action: 'dunning_downgrade',
              changeDescription: `Dunning auto-downgrade to Starter after 7-day past_due grace period. SKUs: ${usage?.totalSkus ?? 0}, InventoryItems: ${usage?.totalInventoryItems ?? 0}`,
            },
          });
        });

        // 5. Sentry fatal escalation alert (outside transaction — non-critical path)
        Sentry.captureMessage(
          `[DUNNING] Organization ${tier.organizationId} auto-downgraded to Starter after 7-day past_due grace period`,
          {
            level: 'fatal',
            tags: { component: 'dunning', event: 'auto_downgrade' },
            extra: {
              organizationId: tier.organizationId,
              pastDueSince: tier.pastDueSince?.toISOString(),
              gracePeriodDays: 7,
            },
          },
        );

        downgradedCount++;
        Logger.warn(`Dunning downgrade completed for organization ${tier.organizationId}`);
      } catch (error) {
        Logger.error(
          `Dunning downgrade failed for org ${tier.organizationId}: ${String(error)}`,
        );
        Sentry.captureException(error, {
          level: 'error',
          tags: { component: 'dunning', event: 'downgrade_failed' },
          extra: { organizationId: tier.organizationId },
        });
        // Continue with remaining orgs
      }
    }

    return downgradedCount;
  }

  // ========== Phase 7: Trial Conversion (Trial → Paid) ==========

  /**
   * Convert a trial subscription to a paid subscription
   * Uses prisma.$transaction() for atomicity
   */
  async convertTrialToPaid(
    organizationId: string,
    stripePaymentMethodId: string,
    billingCycle: BillingCycle,
  ): Promise<SubscriptionTier> {
    // Get the trial subscription
    const trial = await this.prisma.subscriptionTier.findFirst({
      where: {
        organizationId,
        status: SubscriptionStatus.TRIALING,
      },
      include: {
        organization: true,
      },
    });

    if (!trial) {
      throw new NotFoundError(`No active trial found for organization ${organizationId}`);
    }

    if (!trial.stripeCustomerId) {
      throw new InternalError('No Stripe customer found for this trial');
    }

    // Get the price ID based on tier and billing cycle
    const priceId = this.getPriceIdForTier(trial.tierLevel as TierLevel, billingCycle);

    try {
      // Create the subscription in Stripe
      const stripeSubscription = await this.stripe.subscriptions.create({
        customer: trial.stripeCustomerId,
        items: [{ price: priceId }],
        default_payment_method: stripePaymentMethodId,
        payment_behavior: 'error_if_incomplete',
      });

      // Update local database in transaction
      const updated = await this.prisma.$transaction(async (tx) => {
        // Update subscription tier
        const updatedTier = await tx.subscriptionTier.update({
          where: { id: trial.id },
          data: {
            status: SubscriptionStatus.ACTIVE,
            stripeSubscriptionId: stripeSubscription.id,
            trialConvertedAt: new Date(),
            billingCycle,
          },
        });

        // Log the conversion event
        await tx.trialEvent.create({
          data: {
            organizationId,
            eventType: 'trial_converted',
            metadata: JSON.stringify({
              stripeSubscriptionId: stripeSubscription.id,
              billingCycle,
            }),
            occurredAt: new Date(),
          },
        });

        return updatedTier;
      });

      Logger.info(`Converted trial to paid for organization ${organizationId}`);
      return this.mapPrismaToModel(updated);
    } catch (error: any) {
      Logger.error(`Failed to convert trial for org ${organizationId}:`, error);

      // Capture Stripe errors with request ID for debugging
      if (error instanceof Stripe.errors.StripeError) {
        Sentry.captureException(error, {
          level: 'error',
          tags: { service: 'subscription-service', event: 'convert-trial' },
          extra: {
            organizationId,
            stripeRequestId: error.requestId,
            stripeCode: error.code,
          },
        });
      } else {
        Sentry.captureException(error, {
          level: 'error',
          tags: { service: 'subscription-service', event: 'convert-trial' },
          extra: { organizationId },
        });
      }

      throw new InternalError(`Payment failed: ${error.message}`);
    }
  }

  /**
   * Get recently downgraded trials (last 24 hours) for sending warning emails
   */
  async getRecentlyDowngradedTrials(): Promise<
    Array<{
      organizationId: string;
      organizationName: string;
      contactEmail: string | null;
    }>
  > {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const events = await this.prisma.trialEvent.findMany({
      where: {
        eventType: 'trial_expired',
        occurredAt: {
          gte: yesterday,
        },
      },
      orderBy: {
        occurredAt: 'desc',
      },
    });

    const results: Array<{
      organizationId: string;
      organizationName: string;
      contactEmail: string | null;
    }> = [];

    for (const event of events) {
      const org = await this.prisma.organization.findUnique({
        where: { id: event.organizationId },
        select: { name: true, contactEmail: true },
      });

      if (org) {
        results.push({
          organizationId: event.organizationId,
          organizationName: org.name,
          contactEmail: org.contactEmail,
        });
      }
    }

    return results;
  }

  /**
   * Get Stripe price ID for a given tier and billing cycle
   */
  private getPriceIdForTier(tierLevel: TierLevel, billingCycle: BillingCycle): string {
    const prices: Record<string, { monthly: string; annual: string }> = {
      professional: {
        monthly: process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID || 'price_professional_monthly',
        annual: process.env.STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID || 'price_professional_annual',
      },
      premium: {
        monthly: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID || 'price_premium_monthly',
        annual: process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID || 'price_premium_annual',
      },
      concierge: {
        monthly: process.env.STRIPE_CONCIERGE_MONTHLY_PRICE_ID || 'price_concierge_monthly',
        annual: process.env.STRIPE_CONCIERGE_ANNUAL_PRICE_ID || 'price_concierge_annual',
      },
    };

    const tierPrices = prices[tierLevel] || prices.professional;
    return billingCycle === BillingCycle.ANNUAL ? tierPrices.annual : tierPrices.monthly;
  }

  /**
   * Map Prisma SubscriptionTier to business model
   */
  private mapPrismaToModel(prismaRecord: any): SubscriptionTier {
    return {
      id: prismaRecord.id,
      organizationId: prismaRecord.organizationId,
      tierLevel: prismaRecord.tierLevel as TierLevel,
      stripeSubscriptionId: prismaRecord.stripeSubscriptionId,
      trialEndDate: prismaRecord.trialEndDate,
      status: prismaRecord.status as SubscriptionStatus,
      billingCycle: prismaRecord.billingCycle as BillingCycle,
      createdAt: prismaRecord.createdAt,
      updatedAt: prismaRecord.updatedAt,
    };
  }
}

export default SubscriptionService;
