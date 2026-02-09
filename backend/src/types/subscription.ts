/**
 * Subscription tier and feature types for multi-tenant SaaS
 */

export type TierLevel = 'starter' | 'professional' | 'premium' | 'concierge';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  CANCELED = 'canceled',
  PAST_DUE = 'past_due',
  TRIALING = 'trialing',
}

export enum BillingCycle {
  MONTHLY = 'monthly',
  ANNUAL = 'annual',
}

/**
 * Feature flag keys available for tier-based gating
 */
export const AVAILABLE_FEATURES = {
  MAX_SKUS: 'max_skus',
  MAX_USERS: 'max_users',
  ADVANCED_ANALYTICS: 'advanced_analytics',
  API_ACCESS: 'api_access',
  PRIORITY_SUPPORT: 'priority_support',
  DEDICATED_SUPPORT: 'dedicated_support',
  CUSTOM_INTEGRATIONS: 'custom_integrations',
} as const;

export type FeatureKey = typeof AVAILABLE_FEATURES[keyof typeof AVAILABLE_FEATURES];

/**
 * Tier configuration with default limits
 */
export const TIER_LIMITS: Record<TierLevel, Record<string, number | null>> = {
  starter: {
    max_skus: 500,
    max_users: 1,
  },
  professional: {
    max_skus: 2000,
    max_users: 3,
  },
  premium: {
    max_skus: null, // unlimited
    max_users: 10,
  },
  concierge: {
    max_skus: null, // unlimited
    max_users: 10,
  },
};
