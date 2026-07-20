import type { TierLevel } from '../types/subscription';

/**
 * Single frontend source of truth for launch-tier pricing and feature copy.
 *
 * This replaces the three previously-divergent tables that lived inside
 * `UpgradeModal` (TIER_PRICING/TIER_FEATURES) and `TrialUpgradeFlow` (inline
 * A$99 / A$82.50). All three already agreed numerically ($39 / $99 / $990) —
 * this consolidation removes the duplication so the upgrade popup and the
 * upgrade page can never drift.
 *
 * Note on labels: the brand guidelines (§1.7) favour a simpler "Free / Pro"
 * scheme, but Stripe products, the backend, and existing tests use the four
 * distinct tier keys below, so we keep the current display names.
 */

export type LaunchTier = 'free' | 'starter' | 'professional' | 'enterprise';

export const LAUNCH_TIERS: LaunchTier[] = ['free', 'starter', 'professional', 'enterprise'];

export type BillingCycle = 'monthly' | 'annual';

interface TierPricing {
  /** Monthly price in AUD. */
  monthly: number;
  /** Total billed once per year in AUD. */
  annual: number;
}

/** Dollar amounts mirror shared/types/subscription.ts (TIER_PRICES, in cents). */
const TIER_PRICING: Record<'free' | 'starter' | 'professional', TierPricing> = {
  free: { monthly: 0, annual: 0 },
  starter: { monthly: 39, annual: 390 },
  professional: { monthly: 99, annual: 990 },
};

export interface TierFeatureRow {
  name: string;
  free: boolean | string;
  starter: boolean | string;
  professional: boolean | string;
  enterprise: boolean | string;
}

export const TIER_FEATURES: TierFeatureRow[] = [
  {
    name: 'Max SKUs',
    free: '500',
    starter: '5,000',
    professional: '50,000',
    enterprise: '250,000 default',
  },
  { name: 'Max Users', free: '1', starter: '3', professional: '10', enterprise: 'Contract limit' },
  {
    name: 'Active expiry entries',
    free: '500',
    starter: '5,000',
    professional: '50,000',
    enterprise: '250,000 default',
  },
  {
    name: 'Storage',
    free: '1 GB',
    starter: '10 GB',
    professional: '100 GB',
    enterprise: 'Contract limit',
  },
  { name: 'Advanced Analytics', free: false, starter: false, professional: true, enterprise: true },
  { name: 'API Access', free: false, starter: true, professional: true, enterprise: true },
  { name: 'Priority Support', free: false, starter: false, professional: true, enterprise: true },
  { name: 'Dedicated Support', free: false, starter: false, professional: false, enterprise: true },
];

/**
 * Rank of a tier within the upgrade ladder. Higher = more capacity.
 * `premium`/`concierge` (contract-only tiers not sold self-serve) map to the
 * professional/enterprise ranks so they are never treated as a downgrade.
 */
export function tierRank(tier: TierLevel): number {
  switch (tier) {
    case 'free':
      return 0;
    case 'starter':
      return 1;
    case 'professional':
    case 'premium':
      return 2;
    case 'enterprise':
    case 'concierge':
      return 3;
    default:
      return -1;
  }
}

export interface TierPriceView {
  /** Price shown as the large per-month figure (annual shows monthly-equivalent). */
  monthlyEquivalent: number | null;
  /** Total billed annually, when the annual cycle is selected. */
  annualBilled: number | null;
  /** Enterprise is quote-based, so it renders "Contact Sales" instead of a price. */
  isContactSales: boolean;
}

export function getTierPricing(tier: LaunchTier, cycle: BillingCycle): TierPriceView {
  if (tier === 'enterprise') {
    return { monthlyEquivalent: null, annualBilled: null, isContactSales: true };
  }
  const pricing = TIER_PRICING[tier];
  if (cycle === 'annual') {
    return {
      monthlyEquivalent: pricing.annual / 12,
      annualBilled: pricing.annual,
      isContactSales: false,
    };
  }
  return { monthlyEquivalent: pricing.monthly, annualBilled: null, isContactSales: false };
}

/** Formats an AUD amount without trailing ".00" so whole dollars read as "99". */
export function formatPrice(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

export function tierDisplayName(tier: LaunchTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
