import { AnalyticsRepository } from '../../repositories/analytics.repository';

describe('AnalyticsRepository', () => {
  let prisma: {
    metricsSnapshot: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      upsert: jest.Mock;
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
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      webhookMetrics: {
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
      processedWebhookEvent: {
        count: jest.fn(),
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
});
