import { SubscriptionRepository } from '../../repositories/subscription.repository';

describe('SubscriptionRepository', () => {
  let prisma: {
    subscriptionTier: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      groupBy: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
    organizationUsage: {
      upsert: jest.Mock;
    };
    tierFeatureFlag: {
      count: jest.Mock;
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    inventoryItem: {
      count: jest.Mock;
    };
  };
  let repository: SubscriptionRepository;

  beforeEach(() => {
    prisma = {
      subscriptionTier: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        groupBy: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
      organizationUsage: {
        upsert: jest.fn(),
      },
      tierFeatureFlag: {
        count: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      inventoryItem: {
        count: jest.fn(),
      },
    };
    repository = new SubscriptionRepository(prisma as never);
  });

  it('counts only unresolved active expiry records for quota enforcement', async () => {
    prisma.inventoryItem.count.mockResolvedValue(17);

    await expect(repository.countActiveExpiryItems('org-123')).resolves.toBe(17);
    expect(prisma.inventoryItem.count).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-123',
        status: {
          notIn: ['Processed', 'Completed', 'Discarded', 'Archived', 'Sold Through'],
        },
      },
    });
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

  it('groups subscriptions by tier and status for admin metrics', async () => {
    prisma.subscriptionTier.groupBy.mockResolvedValue([
      { tierLevel: 'starter', status: 'trial', _count: 3 },
      { tierLevel: 'professional', status: 'active', _count: 2 },
    ]);

    const result = await repository.groupSubscriptionCountsByTierAndStatus();

    expect(result).toEqual([
      { tierLevel: 'starter', status: 'trial', _count: 3 },
      { tierLevel: 'professional', status: 'active', _count: 2 },
    ]);
    expect(prisma.subscriptionTier.groupBy).toHaveBeenCalledWith({
      by: ['tierLevel', 'status'],
      _count: true,
    });
  });

  it('finds subscriptions linked to Stripe for reconciliation', async () => {
    prisma.subscriptionTier.findMany.mockResolvedValue([
      {
        id: 1,
        organizationId: 'org-123',
        stripeSubscriptionId: 'sub_abc',
        tierLevel: 'starter',
        status: 'active',
      },
    ]);

    const result = await repository.findStripeLinkedSubscriptions();

    expect(result).toEqual([
      {
        id: 1,
        organizationId: 'org-123',
        stripeSubscriptionId: 'sub_abc',
        tierLevel: 'starter',
        status: 'active',
      },
    ]);
    expect(prisma.subscriptionTier.findMany).toHaveBeenCalledWith({
      where: {
        stripeSubscriptionId: { not: null },
      },
      select: {
        id: true,
        organizationId: true,
        stripeSubscriptionId: true,
        tierLevel: true,
        status: true,
      },
    });
  });

  it('updates a subscription by Stripe subscription id for reconciliation', async () => {
    const trialEndDate = new Date('2026-01-31T00:00:00.000Z');
    prisma.subscriptionTier.updateMany.mockResolvedValue({ count: 1 });

    const result = await repository.updateByStripeSubscriptionId('sub_abc', {
      tierLevel: 'professional',
      status: 'active',
      trialEndDate,
    });

    expect(result).toEqual({ count: 1 });
    expect(prisma.subscriptionTier.updateMany).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: 'sub_abc' },
      data: {
        tierLevel: 'professional',
        status: 'active',
        trialEndDate,
      },
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

  it('finds the latest subscription for feature-gate limit checks', async () => {
    prisma.subscriptionTier.findFirst.mockResolvedValue({
      organizationId: 'org-123',
      tierLevel: 'professional',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    const result = await repository.findLatestByOrganizationId('org-123');

    expect(result).toEqual({
      organizationId: 'org-123',
      tierLevel: 'professional',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    expect(prisma.subscriptionTier.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org-123' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('gets or creates organization usage for feature-gate limit checks', async () => {
    prisma.organizationUsage.upsert.mockResolvedValue({
      organizationId: 'org-123',
      activeUsers: 0,
      maxUsers: 1,
      totalSkus: 0,
      maxSkus: 500,
      totalInventoryItems: 0,
      maxInventoryItems: 5000,
      storageUsedBytes: 0,
    });

    const result = await repository.getOrCreateUsage('org-123');

    expect(result).toEqual({
      organizationId: 'org-123',
      activeUsers: 0,
      maxUsers: 1,
      totalSkus: 0,
      maxSkus: 500,
      totalInventoryItems: 0,
      maxInventoryItems: 5000,
      storageUsedBytes: 0,
    });
    expect(prisma.organizationUsage.upsert).toHaveBeenCalledWith({
      where: { organizationId: 'org-123' },
      create: {
        organizationId: 'org-123',
        activeUsers: 0,
        maxUsers: 1,
        totalSkus: 0,
        maxSkus: 500,
        totalInventoryItems: 0,
        maxInventoryItems: 5000,
        storageUsedBytes: 0,
      },
      update: {},
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
