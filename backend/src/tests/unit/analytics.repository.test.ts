import { AnalyticsRepository } from '../../repositories/analytics.repository';

describe('AnalyticsRepository', () => {
  let prisma: {
    metricsSnapshot: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    subscriptionTier: {
      findMany: jest.Mock;
      aggregate: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
    };
    organizationUsage: {
      aggregate: jest.Mock;
    };
    webhookMetrics: {
      findMany: jest.Mock;
      upsert: jest.Mock;
    };
    processedWebhookEvent: {
      count: jest.Mock;
    };
  };
  let repository: AnalyticsRepository;

  beforeEach(() => {
    prisma = {
      metricsSnapshot: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
      subscriptionTier: {
        findMany: vi.fn(),
        aggregate: vi.fn(),
        count: vi.fn(),
        groupBy: vi.fn(),
      },
      organizationUsage: {
        aggregate: vi.fn(),
      },
      webhookMetrics: {
        findMany: vi.fn(),
        upsert: vi.fn(),
      },
      processedWebhookEvent: {
        count: vi.fn(),
      },
    };
    repository = new AnalyticsRepository(prisma as never);
  });

  it('finds metrics snapshots since a start date in ascending order', async () => {
    const startDate = new Date('2026-01-01T00:00:00.000Z');
    const snapshots = [{ id: 1, date: startDate, totalRevenueCents: 10000 }];
    prisma.metricsSnapshot.findMany.mockResolvedValue(snapshots);

    const result = await repository.findMetricsSnapshotsSince(startDate);

    expect(result).toBe(snapshots);
    expect(prisma.metricsSnapshot.findMany).toHaveBeenCalledWith({
      where: {
        date: {
          gte: startDate,
        },
      },
      orderBy: { date: 'asc' },
    });
  });

  it('finds a metrics snapshot by date', async () => {
    const date = new Date('2026-01-31T00:00:00.000Z');
    const snapshot = { id: 1, date, totalConversions: 3, totalChurn: 1 };
    prisma.metricsSnapshot.findUnique.mockResolvedValue(snapshot);

    const result = await repository.findMetricsSnapshotByDate(date);

    expect(result).toBe(snapshot);
    expect(prisma.metricsSnapshot.findUnique).toHaveBeenCalledWith({
      where: { date },
    });
  });

  it('upserts a daily metrics snapshot with serialized tier distribution', async () => {
    const date = new Date('2026-01-31T00:00:00.000Z');
    const snapshot = {
      date,
      trialConversionRate: 42,
      avgRevenuePerUser: 99,
      churnRate: 5,
      totalTrials: 10,
      totalConversions: 4,
      totalChurn: 1,
      totalRevenueCents: 9900,
      tierDistribution: { pro: 3, basic: 2 },
    };
    prisma.metricsSnapshot.upsert.mockResolvedValue({ id: 1 });

    await repository.upsertMetricsSnapshot(snapshot);

    const expectedData = {
      ...snapshot,
      tierDistribution: JSON.stringify(snapshot.tierDistribution),
    };
    expect(prisma.metricsSnapshot.upsert).toHaveBeenCalledWith({
      where: { date },
      update: expectedData,
      create: expectedData,
    });
  });

  it('finds webhook metrics since a start date', async () => {
    const startDate = new Date('2026-01-31T00:00:00.000Z');
    const metrics = [{ totalCount: 10, failureCount: 2 }];
    prisma.webhookMetrics.findMany.mockResolvedValue(metrics);

    const result = await repository.findWebhookMetricsSince(startDate);

    expect(result).toBe(metrics);
    expect(prisma.webhookMetrics.findMany).toHaveBeenCalledWith({
      where: {
        date: {
          gte: startDate,
        },
      },
    });
  });

  it('counts processed webhook events within a date range', async () => {
    const startDate = new Date('2026-01-31T00:00:00.000Z');
    const endDate = new Date('2026-01-31T01:00:00.000Z');
    prisma.processedWebhookEvent.count.mockResolvedValue(8);

    const result = await repository.countProcessedWebhookEventsBetween(startDate, endDate);

    expect(result).toBe(8);
    expect(prisma.processedWebhookEvent.count).toHaveBeenCalledWith({
      where: {
        processedAt: {
          gte: startDate,
          lt: endDate,
        },
      },
    });
  });

  it('increments webhook metrics for an event date', async () => {
    const date = new Date('2026-01-31T00:00:00.000Z');
    prisma.webhookMetrics.upsert.mockResolvedValue({ id: 1 });

    await repository.incrementWebhookMetrics('invoice.payment_failed', false, date);

    expect(prisma.webhookMetrics.upsert).toHaveBeenCalledWith({
      where: {
        eventType_date: {
          eventType: 'invoice.payment_failed',
          date,
        },
      },
      update: {
        totalCount: { increment: 1 },
        failureCount: { increment: 1 },
      },
      create: {
        eventType: 'invoice.payment_failed',
        date,
        totalCount: 1,
        failureCount: 1,
      },
    });
  });

  it('finds trials ending in a date range for conversion metrics', async () => {
    const startDate = new Date('2026-01-01T00:00:00.000Z');
    const endDate = new Date('2026-01-31T00:00:00.000Z');
    const trials = [{ stripeSubscriptionId: 'sub_123', status: 'active' }];
    prisma.subscriptionTier.findMany.mockResolvedValue(trials);

    const result = await repository.findTrialsEndedBetween(startDate, endDate);

    expect(result).toBe(trials);
    expect(prisma.subscriptionTier.findMany).toHaveBeenCalledWith({
      where: {
        trialEndDate: {
          lte: endDate,
          gte: startDate,
        },
      },
      select: {
        stripeSubscriptionId: true,
        status: true,
      },
    });
  });

  it('finds active paid subscription tier levels for revenue metrics', async () => {
    const subscriptions = [{ tierLevel: 'premium' }];
    prisma.subscriptionTier.findMany.mockResolvedValue(subscriptions);

    const result = await repository.findActivePaidSubscriptionTierLevels();

    expect(result).toBe(subscriptions);
    expect(prisma.subscriptionTier.findMany).toHaveBeenCalledWith({
      where: {
        status: 'active',
        stripeSubscriptionId: { not: null },
      },
      select: {
        tierLevel: true,
      },
    });
  });

  it('sums active organization users for revenue metrics', async () => {
    prisma.organizationUsage.aggregate.mockResolvedValue({ _sum: { activeUsers: 12 } });

    const result = await repository.sumActiveOrganizationUsers();

    expect(result).toBe(12);
    expect(prisma.organizationUsage.aggregate).toHaveBeenCalledWith({
      _sum: { activeUsers: true },
    });
  });

  it('returns zero active users when the aggregate is null', async () => {
    prisma.organizationUsage.aggregate.mockResolvedValue({ _sum: { activeUsers: null } });

    await expect(repository.sumActiveOrganizationUsers()).resolves.toBe(0);
  });

  it('counts churn input subscriptions through named repository methods', async () => {
    const since = new Date('2026-01-01T00:00:00.000Z');
    prisma.subscriptionTier.count
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);

    const result = await Promise.all([
      repository.countActiveSubscriptions(),
      repository.countActiveSubscriptionsCreatedSince(since),
      repository.countCanceledSubscriptionsUpdatedSince(since),
    ]);

    expect(result).toEqual([9, 3, 2]);
    expect(prisma.subscriptionTier.count).toHaveBeenNthCalledWith(1, {
      where: { status: 'active' },
    });
    expect(prisma.subscriptionTier.count).toHaveBeenNthCalledWith(2, {
      where: {
        status: 'active',
        createdAt: { gte: since },
      },
    });
    expect(prisma.subscriptionTier.count).toHaveBeenNthCalledWith(3, {
      where: {
        status: 'canceled',
        updatedAt: { gte: since },
      },
    });
  });

  it('groups subscription tiers by tier level', async () => {
    const distribution = [{ tierLevel: 'basic', _count: 4 }];
    prisma.subscriptionTier.groupBy.mockResolvedValue(distribution);

    const result = await repository.groupSubscriptionTiersByTierLevel();

    expect(result).toBe(distribution);
    expect(prisma.subscriptionTier.groupBy).toHaveBeenCalledWith({
      by: ['tierLevel'],
      _count: true,
    });
  });

  it('counts monthly SaaS summary inputs', async () => {
    const since = new Date('2026-01-01T00:00:00.000Z');
    prisma.subscriptionTier.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(7);

    const result = await Promise.all([
      repository.countTrialsEndingSince(since),
      repository.countPaidSubscriptionsCreatedSince(since),
      repository.countCanceledSubscriptionsUpdatedSince(since),
    ]);

    expect(result).toEqual([5, 6, 7]);
    expect(prisma.subscriptionTier.count).toHaveBeenNthCalledWith(1, {
      where: {
        trialEndDate: { gte: since },
      },
    });
    expect(prisma.subscriptionTier.count).toHaveBeenNthCalledWith(2, {
      where: {
        stripeSubscriptionId: { not: null },
        createdAt: { gte: since },
      },
    });
    expect(prisma.subscriptionTier.count).toHaveBeenNthCalledWith(3, {
      where: {
        status: 'canceled',
        updatedAt: { gte: since },
      },
    });
  });
});
