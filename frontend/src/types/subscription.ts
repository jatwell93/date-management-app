export type TierLevel =
  | 'free'
  | 'starter'
  | 'professional'
  | 'enterprise'
  | 'premium'
  | 'concierge';

export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing';

export type BillingCycle = 'monthly' | 'annual';

export interface SubscriptionData {
  tierLevel: TierLevel;
  status: SubscriptionStatus;
  billingCycle: BillingCycle | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd?: boolean;
}

export interface UsageData {
  skus: { current: number; limit: number | null };
  users: { current: number; limit: number };
  storage: { current: number; limit: number };
  inventoryItems: { current: number; limit: number | null };
}

export interface TierFeature {
  name: string;
  free: boolean | string;
  starter: boolean | string;
  professional: boolean | string;
  enterprise: boolean | string;
  premium: boolean | string;
  concierge: boolean | string;
}
