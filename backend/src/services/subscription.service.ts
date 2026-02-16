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
    } catch (error) {
      Logger.error(`Failed to create subscription: ${error}`);

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
