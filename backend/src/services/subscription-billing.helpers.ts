import Stripe from 'stripe';
import { BillingCycle, SubscriptionStatus, TierLevel } from '../types/subscription';
import { Logger } from '../utils/logger';

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
  const prices: Record<string, { monthly: string; annual: string }> = {
    professional: {
      monthly: process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID || 'price_professional_monthly',
      annual: process.env.STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID || 'price_professional_annual',
    },
    premium: {
      monthly: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID || 'price_premium_monthly',
      annual: process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID || 'price_premium_annual',
    },
    concierge: {
      monthly: process.env.STRIPE_CONCIERGE_MONTHLY_PRICE_ID || 'price_concierge_monthly',
      annual: process.env.STRIPE_CONCIERGE_ANNUAL_PRICE_ID || 'price_concierge_annual',
    },
  };

  const tierPrices = prices[tierLevel] || prices.professional;

  if (!prices[tierLevel]) {
    Logger.warn(`Unknown tier ${tierLevel} for Stripe price lookup, using professional fallback`);
  }

  return billingCycle === BillingCycle.ANNUAL ? tierPrices.annual : tierPrices.monthly;
}
