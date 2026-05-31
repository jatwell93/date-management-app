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
    const originalProfessionalMonthly = process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID;
    const originalProfessionalAnnual = process.env.STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID;
    const originalPremiumMonthly = process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID;

    beforeEach(() => {
      process.env.STRIPE_PROFESSIONAL_MONTHLY_PRICE_ID = 'price_prof_monthly_test';
      process.env.STRIPE_PROFESSIONAL_ANNUAL_PRICE_ID = 'price_prof_annual_test';
      process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID = 'price_premium_monthly_test';
    });

    afterEach(() => {
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

    it('returns the configured tier price for the requested billing cycle', () => {
      expect(getPriceIdForTier('professional', BillingCycle.MONTHLY)).toBe(
        'price_prof_monthly_test',
      );
      expect(getPriceIdForTier('professional', BillingCycle.ANNUAL)).toBe('price_prof_annual_test');
    });

    it('falls back to professional pricing for unknown tiers', () => {
      expect(getPriceIdForTier('custom-tier' as never, BillingCycle.MONTHLY)).toBe(
        'price_prof_monthly_test',
      );
    });

    it('exposes configured price ids from the billing price catalog without development defaults', () => {
      const configuredPriceIds = getConfiguredStripePriceIds({ includeDefaults: false });

      expect(configuredPriceIds).toEqual(
        expect.arrayContaining([
          'price_prof_monthly_test',
          'price_prof_annual_test',
          'price_premium_monthly_test',
        ]),
      );
      expect(configuredPriceIds).not.toContain('price_premium_annual');
    });
  });
});
