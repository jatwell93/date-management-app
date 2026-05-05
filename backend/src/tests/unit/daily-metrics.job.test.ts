import { DailyMetricsJob } from '../../jobs/daily-metrics.job';
import { JobLockRepository } from '../../repositories/job-lock.repository';

describe('DailyMetricsJob', () => {
  let monitoringService: {
    storeDailyMetrics: jest.Mock;
  };
  let saasMetricsService: {
    checkAlerts: jest.Mock;
    getSaasMetrics: jest.Mock;
  };
  let jobLockRepository: {
    acquire: jest.Mock;
    release: jest.Mock;
  };

  beforeEach(() => {
    monitoringService = {
      storeDailyMetrics: jest.fn().mockResolvedValue(undefined),
    };
    saasMetricsService = {
      checkAlerts: jest.fn().mockResolvedValue(undefined),
      getSaasMetrics: jest.fn().mockResolvedValue(null),
    };
    jobLockRepository = {
      acquire: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
    };
  });

  it('uses the injected lock repository around daily metrics execution', async () => {
    const job = new DailyMetricsJob({
      monitoringService: monitoringService as never,
      saasMetricsService: saasMetricsService as never,
      jobLockRepository: jobLockRepository as unknown as JobLockRepository,
    });
    const jobDate = new Date('2026-02-10T23:59:00.000Z');

    await job.execute(jobDate);

    expect(jobLockRepository.acquire).toHaveBeenCalledWith('daily-metrics-2026-02-10', 10);
    expect(monitoringService.storeDailyMetrics).toHaveBeenCalledWith(jobDate);
    expect(saasMetricsService.checkAlerts).toHaveBeenCalled();
    expect(jobLockRepository.release).toHaveBeenCalledWith('daily-metrics-2026-02-10');
  });

  it('skips metrics work when the lock is not acquired', async () => {
    jobLockRepository.acquire.mockResolvedValue(false);
    const job = new DailyMetricsJob({
      monitoringService: monitoringService as never,
      saasMetricsService: saasMetricsService as never,
      jobLockRepository: jobLockRepository as unknown as JobLockRepository,
    });

    await job.execute(new Date('2026-02-10T23:59:00.000Z'));

    expect(monitoringService.storeDailyMetrics).not.toHaveBeenCalled();
    expect(saasMetricsService.checkAlerts).not.toHaveBeenCalled();
    expect(jobLockRepository.release).not.toHaveBeenCalled();
  });
});
