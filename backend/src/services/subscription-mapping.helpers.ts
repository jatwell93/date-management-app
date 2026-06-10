import { SubscriptionTier as PrismaSubscriptionTier } from '@prisma/client';
import Stripe from 'stripe';
import { SubscriptionTier } from '../models/subscription-tier.model';
import { BillingCycle, SubscriptionStatus, TierLevel, TIER_LIMITS } from '../types/subscription';
import { Logger } from '../utils/logger';

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function extractTierFromPrice(subscription: Stripe.Subscription): TierLevel {
  const price = subscription.items.data[0]?.price;
  if (!price) {
    Logger.warn('No price found in subscription items');
    return 'free';
  }

  const tier = (price.metadata?.tier as TierLevel) || 'free';

  if (!Object.keys(TIER_LIMITS).includes(tier)) {
    Logger.warn(`Unknown tier ${tier} from price metadata, using free`);
    return 'free';
  }

  return tier;
}

export function mapPrismaSubscriptionTierToModel(
  prismaRecord: PrismaSubscriptionTier,
): SubscriptionTier {
  return {
    id: prismaRecord.id,
    organizationId: prismaRecord.organizationId,
    tierLevel: prismaRecord.tierLevel as TierLevel,
    stripeSubscriptionId: prismaRecord.stripeSubscriptionId ?? undefined,
    trialEndDate: prismaRecord.trialEndDate ?? undefined,
    status: prismaRecord.status as SubscriptionStatus,
    billingCycle: prismaRecord.billingCycle as BillingCycle,
    createdAt: prismaRecord.createdAt,
    updatedAt: prismaRecord.updatedAt,
  };
}
