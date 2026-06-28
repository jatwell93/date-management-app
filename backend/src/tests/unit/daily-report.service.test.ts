import { DailyReportService } from '../../services/daily-report.service';

describe('DailyReportService', () => {
  it('loads comparison snapshots through the analytics repository', async () => {
    const reportDate = new Date(2026, 1, 10, 12);
    const normalizedReportDate = new Date(reportDate);
    normalizedReportDate.setHours(0, 0, 0, 0);
    const previousDate = new Date(normalizedReportDate);
    previousDate.setDate(previousDate.getDate() - 1);
    const weekAgoDate = new Date(normalizedReportDate);
    weekAgoDate.setDate(weekAgoDate.getDate() - 7);
    const saasMetricsService = {
      getSaasMetrics: vi.fn().mockResolvedValue({
        trialConversionRate: 25,
        avgRevenuePerUser: 40,
        churnRate: 3,
        webhookFailureRate: 1,
        paymentFailureRate: null,
        tierDistribution: { professional: 2 },
        totalActiveSubscriptions: 2,
        monthlyRecurringRevenue: 80,
        newTrialsThisMonth: 5,
        conversionsThisMonth: 3,
        churnsThisMonth: 1,
      }),
    };
    const emailService = {};
    const analyticsRepo = {
      findMetricsSnapshotByDate: vi
        .fn()
        .mockResolvedValueOnce({
          totalRevenueCents: 6000,
          totalConversions: 2,
          totalChurn: 1,
        })
        .mockResolvedValueOnce({
          totalRevenueCents: 5000,
          totalConversions: 1,
          totalChurn: 0,
        }),
    };

    const service = new DailyReportService(
      {} as never,
      saasMetricsService as never,
      emailService as never,
      analyticsRepo as never,
    );

    const report = await service.generateDailyReport(reportDate);

    expect(report.summary.revenueChange).toBe(20);
    expect(analyticsRepo.findMetricsSnapshotByDate).toHaveBeenCalledTimes(2);
    expect(analyticsRepo.findMetricsSnapshotByDate).toHaveBeenNthCalledWith(1, previousDate);
    expect(analyticsRepo.findMetricsSnapshotByDate).toHaveBeenNthCalledWith(2, weekAgoDate);
  });
});
