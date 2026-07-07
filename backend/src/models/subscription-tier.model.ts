/**
 * Subscription tier data model
 * Represents an organization's current subscription plan
 */

import { TierLevel, SubscriptionStatus, BillingCycle } from '../types/subscription';

export interface SubscriptionTier {
  id: number;
  organizationId: string;
  tierLevel: TierLevel;
  stripeSubscriptionId?: string;
  trialEndDate?: Date;
  trialStartedAt?: Date;
  trialConvertedAt?: Date;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  cancelAtPeriodEnd?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSubscriptionTierInput {
  organizationId: string;
  tierLevel: TierLevel;
  status?: SubscriptionStatus;
  billingCycle?: BillingCycle;
  trialEndDate?: Date;
}

export interface UpdateSubscriptionTierInput {
  tierLevel?: TierLevel;
  status?: SubscriptionStatus;
  billingCycle?: BillingCycle;
  stripeSubscriptionId?: string;
  trialEndDate?: Date;
  cancelAtPeriodEnd?: boolean;
}
