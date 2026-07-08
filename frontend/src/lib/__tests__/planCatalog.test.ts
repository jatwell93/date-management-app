import { formatPrice, getTierPricing, tierRank, LAUNCH_TIERS } from '../planCatalog';

describe('planCatalog', () => {
  it('orders tiers so upgrades rank above the current plan', () => {
    expect(tierRank('free')).toBeLessThan(tierRank('starter'));
    expect(tierRank('starter')).toBeLessThan(tierRank('professional'));
    expect(tierRank('professional')).toBeLessThan(tierRank('enterprise'));
  });

  it('never treats contract-only tiers as a downgrade', () => {
    expect(tierRank('premium')).toBe(tierRank('professional'));
    expect(tierRank('concierge')).toBe(tierRank('enterprise'));
  });

  it('exposes exactly the four self-serve launch tiers', () => {
    expect(LAUNCH_TIERS).toEqual(['free', 'starter', 'professional', 'enterprise']);
  });

  it('returns monthly pricing at the monthly cycle', () => {
    expect(getTierPricing('professional', 'monthly')).toEqual({
      monthlyEquivalent: 99,
      annualBilled: null,
      isContactSales: false,
    });
  });

  it('returns the monthly-equivalent and annual total at the annual cycle', () => {
    expect(getTierPricing('professional', 'annual')).toEqual({
      monthlyEquivalent: 82.5,
      annualBilled: 990,
      isContactSales: false,
    });
  });

  it('marks Enterprise as contact-sales', () => {
    expect(getTierPricing('enterprise', 'monthly').isContactSales).toBe(true);
  });

  it('formats whole dollars without decimals and part-dollars with two', () => {
    expect(formatPrice(99)).toBe('99');
    expect(formatPrice(82.5)).toBe('82.50');
    expect(formatPrice(0)).toBe('0');
  });
});
