import { BillingCycle, SubscriptionStatus, TierLevel, TIER_LIMITS } from '../types/subscription';

export interface TrialSubscriptionSetup {
  trialEndDate: Date;
  subscriptionTierData: {
    organizationId: string;
    tierLevel: TierLevel;
    status: SubscriptionStatus;
    stripeCustomerId: string;
    trialStartedAt: Date;
    trialEndDate: Date;
    billingCycle: BillingCycle;
  };
  organizationUsageData: {
    organizationId: string;
    activeUsers: number;
    maxUsers: number;
    totalSkus: number;
    maxSkus: number;
    totalInventoryItems: number;
    maxInventoryItems: number;
    storageUsedBytes: number;
  };
}

export function buildTrialSubscriptionSetup(
  organizationId: string,
  stripeCustomerId: string,
  trialDays = 14,
  startedAt = new Date(),
): TrialSubscriptionSetup {
  const trialEndDate = new Date(startedAt);
  trialEndDate.setUTCDate(trialEndDate.getUTCDate() + trialDays);
  trialEndDate.setUTCHours(0, 0, 0, 0);

  const professionalLimits = TIER_LIMITS.professional;

  return {
    trialEndDate,
    subscriptionTierData: {
      organizationId,
      tierLevel: 'professional',
      status: SubscriptionStatus.TRIALING,
      stripeCustomerId,
      trialStartedAt: startedAt,
      trialEndDate,
      billingCycle: BillingCycle.MONTHLY,
    },
    organizationUsageData: {
      organizationId,
      activeUsers: 1,
      maxUsers: professionalLimits.max_users ?? 10,
      totalSkus: 0,
      maxSkus: professionalLimits.max_skus ?? 2000,
      totalInventoryItems: 0,
      maxInventoryItems: professionalLimits.max_inventory_items ?? 20000,
      storageUsedBytes: 0,
    },
  };
}
