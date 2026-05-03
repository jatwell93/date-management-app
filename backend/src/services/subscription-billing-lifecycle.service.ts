import { PrismaClient } from '@prisma/client';
import * as Sentry from '@sentry/node';
import Stripe from 'stripe';
import { InternalError, NotFoundError } from '../errors';
import { SubscriptionTier } from '../models/subscription-tier.model';
import { BillingCycle, SubscriptionStatus, TIER_LIMITS } from '../types/subscription';
import { Logger } from '../utils/logger';
import { mapStripeSubscriptionStatusToLocal } from './subscription-billing.helpers';
import {
  extractTierFromPrice,
  getErrorMessage,
  mapPrismaSubscriptionTierToModel,
} from './subscription-mapping.helpers';

export class SubscriptionBillingLifecycleService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly stripe: Stripe,
  ) {}

  async createSubscription(
    organizationId: string,
    priceId: string,
    billingCycle: BillingCycle,
  ): Promise<SubscriptionTier> {
    try {
      const organization = await this.prisma.organization.findUnique({
        where: { id: organizationId },
      });

      if (!organization) {
        throw new NotFoundError(`Organization ${organizationId} not found`);
      }

      const stripeCustomer = await this.stripe.customers.create({
        description: `Pharmacy: ${organization.name}`,
        metadata: {
          organizationId,
        },
      });

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

      const tierLevel = extractTierFromPrice(stripeSubscription);

      const subscriptionTier = await this.prisma.subscriptionTier.create({
        data: {
          organizationId,
          tierLevel,
          stripeSubscriptionId: stripeSubscription.id,
          status: mapStripeSubscriptionStatusToLocal(stripeSubscription.status),
          billingCycle,
          trialEndDate: stripeSubscription.trial_end
            ? new Date(stripeSubscription.trial_end * 1000)
            : null,
        },
      });

      Logger.info(
        `Created subscription ${stripeSubscription.id} for organization ${organizationId}`,
      );

      return mapPrismaSubscriptionTierToModel(subscriptionTier);
    } catch (error: unknown) {
      Logger.error(`Failed to create subscription: ${getErrorMessage(error)}`);

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

  async updateSubscription(organizationId: string, newPriceId: string): Promise<SubscriptionTier> {
    try {
      const subscriptionTier = await this.prisma.subscriptionTier.findFirst({
        where: { organizationId },
      });

      if (!subscriptionTier || !subscriptionTier.stripeSubscriptionId) {
        throw new NotFoundError(`No subscription found for organization ${organizationId}`);
      }

      const stripeSubscription = await this.stripe.subscriptions.retrieve(
        subscriptionTier.stripeSubscriptionId,
      );

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

      const newTierLevel = extractTierFromPrice(updatedSubscription);

      const updated = await this.prisma.subscriptionTier.update({
        where: { id: subscriptionTier.id },
        data: {
          tierLevel: newTierLevel,
          status: mapStripeSubscriptionStatusToLocal(updatedSubscription.status),
        },
      });

      Logger.info(`Updated subscription for organization ${organizationId} to ${newTierLevel}`);

      return mapPrismaSubscriptionTierToModel(updated);
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

  async cancelSubscription(organizationId: string): Promise<SubscriptionTier> {
    try {
      const subscriptionTier = await this.prisma.subscriptionTier.findFirst({
        where: { organizationId },
      });

      if (!subscriptionTier || !subscriptionTier.stripeSubscriptionId) {
        throw new NotFoundError(`No subscription found for organization ${organizationId}`);
      }

      const canceledSubscription = await this.stripe.subscriptions.update(
        subscriptionTier.stripeSubscriptionId,
        {
          cancel_at_period_end: true,
        },
      );

      const updated = await this.prisma.subscriptionTier.update({
        where: { id: subscriptionTier.id },
        data: {
          status: mapStripeSubscriptionStatusToLocal(canceledSubscription.status),
        },
      });

      Logger.info(`Canceled subscription ${subscriptionTier.stripeSubscriptionId} at period end`);

      return mapPrismaSubscriptionTierToModel(updated);
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

  async reactivateSubscription(organizationId: string): Promise<SubscriptionTier> {
    try {
      const subscriptionTier = await this.prisma.subscriptionTier.findFirst({
        where: { organizationId },
      });

      if (!subscriptionTier || !subscriptionTier.stripeSubscriptionId) {
        throw new NotFoundError(`No subscription found for organization ${organizationId}`);
      }

      const reactivatedSubscription = await this.stripe.subscriptions.update(
        subscriptionTier.stripeSubscriptionId,
        {
          cancel_at_period_end: false,
        },
      );

      const updated = await this.prisma.subscriptionTier.update({
        where: { id: subscriptionTier.id },
        data: {
          status: mapStripeSubscriptionStatusToLocal(reactivatedSubscription.status),
        },
      });

      Logger.info(
        `Reactivated subscription ${subscriptionTier.stripeSubscriptionId} for organization ${organizationId}`,
      );

      return mapPrismaSubscriptionTierToModel(updated);
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

  async syncSubscriptionState(
    organizationId: string,
    stripeSubscription: Stripe.Subscription,
  ): Promise<SubscriptionTier> {
    try {
      const subscriptionTier = await this.prisma.subscriptionTier.findFirst({
        where: { organizationId },
      });

      if (!subscriptionTier) {
        throw new NotFoundError(`No subscription found for organization ${organizationId}`);
      }

      const tierLevel = extractTierFromPrice(stripeSubscription);

      const updated = await this.prisma.subscriptionTier.update({
        where: { id: subscriptionTier.id },
        data: {
          tierLevel,
          status: mapStripeSubscriptionStatusToLocal(stripeSubscription.status),
          trialEndDate: stripeSubscription.trial_end
            ? new Date(stripeSubscription.trial_end * 1000)
            : null,
          stripeSubscriptionId: stripeSubscription.id,
        },
      });

      Logger.info(`Synced subscription state for organization ${organizationId}`);

      return mapPrismaSubscriptionTierToModel(updated);
    } catch (error) {
      Logger.error(`Failed to sync subscription state: ${error}`);

      if (error instanceof NotFoundError) {
        throw error;
      }

      throw error;
    }
  }

  async downgradeExpiredPastDue(): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

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
          await tx.subscriptionTier.updateMany({
            where: { organizationId: tier.organizationId },
            data: {
              status: SubscriptionStatus.ACTIVE,
              tierLevel: 'starter',
              pastDueSince: null,
            },
          });

          await tx.organizationUsage.update({
            where: { organizationId: tier.organizationId },
            data: {
              maxSkus: starterLimits.max_skus ?? 500,
              maxUsers: starterLimits.max_users ?? 1,
              maxInventoryItems: starterLimits.max_inventory_items ?? 5000,
            },
          });

          const usage = await tx.organizationUsage.findUnique({
            where: { organizationId: tier.organizationId },
          });

          const isOverSkuLimit =
            starterLimits.max_skus !== null && usage && usage.totalSkus > starterLimits.max_skus;

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

          await tx.auditLog.create({
            data: {
              organizationId: tier.organizationId,
              action: 'dunning_downgrade',
              changeDescription: `Dunning auto-downgrade to Starter after 7-day past_due grace period. SKUs: ${usage?.totalSkus ?? 0}, InventoryItems: ${usage?.totalInventoryItems ?? 0}`,
            },
          });
        });

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
        Logger.error(`Dunning downgrade failed for org ${tier.organizationId}: ${String(error)}`);
        Sentry.captureException(error, {
          level: 'error',
          tags: { component: 'dunning', event: 'downgrade_failed' },
          extra: { organizationId: tier.organizationId },
        });
      }
    }

    return downgradedCount;
  }
}
