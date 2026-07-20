import { BillingCycle, SubscriptionStatus } from '../../types/subscription';
import {
  getConfiguredStripePriceIds,
  getPriceIdForTier,
  mapStripeSubscriptionStatusToLocal,
} from '../../services/subscription-billing.helpers';

describe('subscription-billing helpers', () => {
  describe('mapStripeSubscriptionStatusToLocal', () => {
    it('maps Stripe statuses to local subscription statuses', () => {
      expect(mapStripeSubscriptionStatusToLocal('active')).toBe(SubscriptionStatus.ACTIVE);
      expect(mapStripeSubscriptionStatusToLocal('canceled')).toBe(SubscriptionStatus.CANCELED);
      expect(mapStripeSubscriptionStatusToLocal('past_due')).toBe(SubscriptionStatus.PAST_DUE);
      expect(mapStripeSubscriptionStatusToLocal('trialing')).toBe(SubscriptionStatus.TRIALING);
    });

    it('defaults incomplete states to active', () => {
      expect(mapStripeSubscriptionStatusToLocal('incomplete')).toBe(SubscriptionStatus.ACTIVE);
      expect(mapStripeSubscriptionStatusToLocal('mystery')).toBe(SubscriptionStatus.ACTIVE);
    });
  });

  describe('getPriceIdForTier', () => {
    const originalStarterMonthly = process.env.STRIPE_STARTER_MONTHLY_PRICE_ID;
    const originalStarterAnnual = process.env.STRIPE_STARTER_ANNUAL_PRICE_ID;
    const originalProfessionalMonthly = process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID;
    const originalProfessionalAnnual = process.env.STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID;
    const originalPremiumMonthly = process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID;

    beforeEach(() => {
      process.env.STRIPE_STARTER_MONTHLY_PRICE_ID = 'price_starter_monthly_test';
      process.env.STRIPE_STARTER_ANNUAL_PRICE_ID = 'price_starter_annual_test';
      process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID = 'price_prof_monthly_test';
      process.env.STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID = 'price_prof_annual_test';
      process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID = 'price_premium_monthly_test';
    });

    afterEach(() => {
      if (originalStarterMonthly === undefined) {
        delete process.env.STRIPE_STARTER_MONTHLY_PRICE_ID;
      } else {
        process.env.STRIPE_STARTER_MONTHLY_PRICE_ID = originalStarterMonthly;
      }

      if (originalStarterAnnual === undefined) {
        delete process.env.STRIPE_STARTER_ANNUAL_PRICE_ID;
      } else {
        process.env.STRIPE_STARTER_ANNUAL_PRICE_ID = originalStarterAnnual;
      }

      if (originalProfessionalMonthly === undefined) {
        delete process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID;
      } else {
        process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID = originalProfessionalMonthly;
      }

      if (originalProfessionalAnnual === undefined) {
        delete process.env.STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID;
      } else {
        process.env.STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID = originalProfessionalAnnual;
      }

      if (originalPremiumMonthly === undefined) {
        delete process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID;
      } else {
        process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID = originalPremiumMonthly;
      }
    });

    it('returns configured Starter and Professional prices for each billing cycle', () => {
      expect(getPriceIdForTier('starter', BillingCycle.MONTHLY)).toBe('price_starter_monthly_test');
      expect(getPriceIdForTier('starter', BillingCycle.ANNUAL)).toBe('price_starter_annual_test');
      expect(getPriceIdForTier('professional', BillingCycle.MONTHLY)).toBe(
        'price_prof_monthly_test',
      );
      expect(getPriceIdForTier('professional', BillingCycle.ANNUAL)).toBe('price_prof_annual_test');
    });

    it.each(['free', 'enterprise', 'premium', 'concierge', 'custom-tier'])(
      'rejects %s as a new Checkout tier',
      (tier) => {
        expect(() => getPriceIdForTier(tier as never, BillingCycle.MONTHLY)).toThrow(
          `Stripe Checkout is not available for tier: ${tier}`,
        );
      },
    );

    it('exposes exactly the four configured launch price ids', () => {
      const configuredPriceIds = getConfiguredStripePriceIds({ includeDefaults: false });

      expect(configuredPriceIds).toEqual([
        'price_starter_monthly_test',
        'price_starter_annual_test',
        'price_prof_monthly_test',
        'price_prof_annual_test',
      ]);
    });

    it('does not allow configured legacy price variables into the Checkout allowlist', () => {
      expect(getConfiguredStripePriceIds({ includeDefaults: false })).not.toContain(
        'price_premium_monthly_test',
      );
    });
  });
});
