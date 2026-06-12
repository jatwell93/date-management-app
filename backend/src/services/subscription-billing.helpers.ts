import Stripe from 'stripe';
import { BillingCycle, SubscriptionStatus, TierLevel } from '../types/subscription';

interface TierPriceIds {
  monthly: string;
  annual: string;
}

interface ConfiguredStripePriceOptions {
  includeDefaults?: boolean;
}

// Keep these env keys aligned with REQUIRED_PRICE_KEYS in
// scripts/validate-stripe-deployment-config.js.
const STRIPE_PRICE_CATALOG = {
  starter: {
    monthly: {
      envKey: 'STRIPE_STARTER_MONTHLY_PRICE_ID',
      defaultPriceId: 'price_starter_monthly',
    },
    annual: {
      envKey: 'STRIPE_STARTER_ANNUAL_PRICE_ID',
      defaultPriceId: 'price_starter_annual',
    },
  },
  professional: {
    monthly: {
      envKey: 'STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID',
      defaultPriceId: 'price_professional_monthly',
    },
    annual: {
      envKey: 'STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID',
      defaultPriceId: 'price_professional_annual',
    },
  },
} as const;

type StripePriceTier = keyof typeof STRIPE_PRICE_CATALOG;

export function mapStripeSubscriptionStatusToLocal(
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
      return SubscriptionStatus.ACTIVE;
  }
}

/**
 * Map legacy tiers persisted before the launch catalog to their canonical
 * replacements (premium -> professional, concierge -> enterprise) so that
 * historical records can flow through launch-tier billing paths. Tiers that
 * are already canonical pass through unchanged.
 */
export function normalizeLegacyTier(tierLevel: TierLevel): TierLevel {
  if (tierLevel === 'premium') return 'professional';
  if (tierLevel === 'concierge') return 'enterprise';
  return tierLevel;
}

export function getPriceIdForTier(tierLevel: TierLevel, billingCycle: BillingCycle): string {
  const prices = getConfiguredStripePrices();
  const tierPrices = prices[tierLevel];

  if (!tierPrices) {
    throw new Error(`Stripe Checkout is not available for tier: ${tierLevel}`);
  }

  return billingCycle === BillingCycle.ANNUAL ? tierPrices.annual : tierPrices.monthly;
}

export function getConfiguredStripePrices(
  options: ConfiguredStripePriceOptions = {},
): Record<string, TierPriceIds> {
  const includeDefaults = options.includeDefaults ?? true;

  return Object.entries(STRIPE_PRICE_CATALOG).reduce<Record<string, TierPriceIds>>(
    (prices, [tier, cycles]) => {
      prices[tier] = {
        monthly:
          process.env[cycles.monthly.envKey] ||
          (includeDefaults ? cycles.monthly.defaultPriceId : ''),
        annual:
          process.env[cycles.annual.envKey] ||
          (includeDefaults ? cycles.annual.defaultPriceId : ''),
      };
      return prices;
    },
    {},
  );
}

export function getConfiguredStripePriceIds(options: ConfiguredStripePriceOptions = {}): string[] {
  return (Object.keys(STRIPE_PRICE_CATALOG) as StripePriceTier[]).flatMap((tier) => {
    const prices = getConfiguredStripePrices(options)[tier];
    return [prices.monthly, prices.annual].filter((priceId) => priceId.length > 0);
  });
}
