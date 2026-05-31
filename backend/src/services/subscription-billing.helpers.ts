import Stripe from 'stripe';
import { BillingCycle, SubscriptionStatus, TierLevel } from '../types/subscription';
import { Logger } from '../utils/logger';

interface TierPriceIds {
  monthly: string;
  annual: string;
}

interface ConfiguredStripePriceOptions {
  includeDefaults?: boolean;
}

const STRIPE_PRICE_CATALOG = {
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
  premium: {
    monthly: {
      envKey: 'STRIPE_PREMIUM_MONTHLY_PRICE_ID',
      defaultPriceId: 'price_premium_monthly',
    },
    annual: {
      envKey: 'STRIPE_PREMIUM_ANNUAL_PRICE_ID',
      defaultPriceId: 'price_premium_annual',
    },
  },
  concierge: {
    monthly: {
      envKey: 'STRIPE_CONCIERGE_MONTHLY_PRICE_ID',
      defaultPriceId: 'price_concierge_monthly',
    },
    annual: {
      envKey: 'STRIPE_CONCIERGE_ANNUAL_PRICE_ID',
      defaultPriceId: 'price_concierge_annual',
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

export function getPriceIdForTier(tierLevel: TierLevel, billingCycle: BillingCycle): string {
  const prices = getConfiguredStripePrices();

  const tierPrices = prices[tierLevel] || prices.professional;

  if (!prices[tierLevel]) {
    Logger.warn(`Unknown tier ${tierLevel} for Stripe price lookup, using professional fallback`);
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
