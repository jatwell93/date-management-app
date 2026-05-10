import { TIER_LIMITS } from '../../types/subscription';
import { buildTrialSubscriptionSetup } from '../../services/subscription-trial.helpers';

describe('buildTrialSubscriptionSetup', () => {
  it('builds a professional trial starting at UTC midnight after the requested trial period', () => {
    const startedAt = new Date('2026-04-01T15:30:00.000Z');
    const setup = buildTrialSubscriptionSetup('org_123', 'cus_123', 14, startedAt);

    expect(setup.trialEndDate.toISOString()).toBe('2026-04-15T00:00:00.000Z');
    expect(setup.subscriptionTierData).toEqual({
      organizationId: 'org_123',
      tierLevel: 'professional',
      status: 'trialing',
      stripeCustomerId: 'cus_123',
      trialStartedAt: startedAt,
      trialEndDate: setup.trialEndDate,
      billingCycle: 'monthly',
    });
    expect(setup.organizationUsageData).toEqual({
      organizationId: 'org_123',
      activeUsers: 1,
      maxUsers: TIER_LIMITS.professional.max_users ?? 10,
      totalSkus: 0,
      maxSkus: TIER_LIMITS.professional.max_skus ?? 2000,
      totalInventoryItems: 0,
      maxInventoryItems: TIER_LIMITS.professional.max_inventory_items ?? 20000,
      storageUsedBytes: 0,
    });
  });
});
