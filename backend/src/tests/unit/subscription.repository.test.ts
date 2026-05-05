import { SubscriptionRepository } from '../../repositories/subscription.repository';

describe('SubscriptionRepository', () => {
  let prisma: {
    subscriptionTier: {
      update: jest.Mock;
    };
    tierFeatureFlag: {
      count: jest.Mock;
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
  };
  let repository: SubscriptionRepository;

  beforeEach(() => {
    prisma = {
      subscriptionTier: {
        update: jest.fn(),
      },
      tierFeatureFlag: {
        count: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };
    repository = new SubscriptionRepository(prisma as never);
  });

  it('updates a subscription Stripe customer id', async () => {
    prisma.subscriptionTier.update.mockResolvedValue({ id: 1, stripeCustomerId: 'cus_123' });

    const result = await repository.updateStripeCustomerId(1, 'cus_123');

    expect(result).toEqual({ id: 1, stripeCustomerId: 'cus_123' });
    expect(prisma.subscriptionTier.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { stripeCustomerId: 'cus_123' },
    });
  });

  it('finds a tier feature flag by tier and feature key', async () => {
    prisma.tierFeatureFlag.findUnique.mockResolvedValue({
      tierLevel: 'starter',
      featureKey: 'max_skus',
      limitValue: 500,
    });

    const result = await repository.findTierFeatureFlag('starter', 'max_skus');

    expect(result).toEqual({
      tierLevel: 'starter',
      featureKey: 'max_skus',
      limitValue: 500,
    });
    expect(prisma.tierFeatureFlag.findUnique).toHaveBeenCalledWith({
      where: {
        tierLevel_featureKey: {
          tierLevel: 'starter',
          featureKey: 'max_skus',
        },
      },
    });
  });

  it('counts tier feature flags', async () => {
    prisma.tierFeatureFlag.count.mockResolvedValue(32);

    await expect(repository.countTierFeatureFlags()).resolves.toBe(32);

    expect(prisma.tierFeatureFlag.count).toHaveBeenCalledWith();
  });

  it('upserts tier feature flags and reports whether a flag was newly seeded', async () => {
    prisma.tierFeatureFlag.findUnique.mockResolvedValue(null);
    prisma.tierFeatureFlag.upsert.mockResolvedValue({ id: 1 });

    const result = await repository.seedTierFeatureFlag({
      tierLevel: 'starter',
      featureKey: 'max_skus',
      enabled: true,
      limitValue: 500,
    });

    expect(result).toEqual({ seeded: true });
    expect(prisma.tierFeatureFlag.findUnique).toHaveBeenCalledWith({
      where: {
        tierLevel_featureKey: {
          tierLevel: 'starter',
          featureKey: 'max_skus',
        },
      },
      select: { id: true },
    });
    expect(prisma.tierFeatureFlag.upsert).toHaveBeenCalledWith({
      where: {
        tierLevel_featureKey: {
          tierLevel: 'starter',
          featureKey: 'max_skus',
        },
      },
      update: {},
      create: {
        tierLevel: 'starter',
        featureKey: 'max_skus',
        enabled: true,
        limitValue: 500,
      },
    });
  });
});
