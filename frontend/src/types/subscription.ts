export type TierLevel = 'starter' | 'professional' | 'premium' | 'concierge';

export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing';

export type BillingCycle = 'monthly' | 'annual';

export interface SubscriptionData {
  tierLevel: TierLevel;
  status: SubscriptionStatus;
  billingCycle: BillingCycle | null;
  currentPeriodEnd: string | null;
}

export interface UsageData {
  skus: { current: number; limit: number | null };
  users: { current: number; limit: number };
  storage: { current: number; limit: number };
  inventoryItems: { current: number; limit: number | null };
}

export interface TierFeature {
  name: string;
  starter: boolean | string;
  professional: boolean | string;
  premium: boolean | string;
  concierge: boolean | string;
}
