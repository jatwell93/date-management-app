import { AnalyticsRepository } from '../../repositories/analytics.repository';

describe('AnalyticsRepository', () => {
  let prisma: {
    metricsSnapshot: {
      findMany: jest.Mock;
    };
  };
  let repository: AnalyticsRepository;

  beforeEach(() => {
    prisma = {
      metricsSnapshot: {
        findMany: jest.fn(),
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
});
