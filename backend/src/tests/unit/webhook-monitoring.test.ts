import { HourlyWebhookCheckJob } from '../../jobs/daily-metrics.job';
import { SaasMetricsService } from '../../services/saas-metrics.service';

jest.mock('../../services/saas-metrics.service');
jest.mock('../../database/database-factory');

describe('Webhook Monitoring', () => {
  let job: HourlyWebhookCheckJob;
  let mockSaasMetrics: jest.Mocked<SaasMetricsService>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockSaasMetrics = {
      calculateWebhookFailureRate: jest.fn().mockResolvedValue(0),
      getDailyWebhookErrorCount: jest.fn().mockResolvedValue(0),
      getProcessedWebhookEventGrowthRate: jest.fn().mockResolvedValue(1.0),
    } as any;

    (SaasMetricsService as unknown as jest.Mock).mockImplementation(() => mockSaasMetrics);
    job = new HourlyWebhookCheckJob();
  });

  it('captures Sentry alert when daily webhook error count exceeds 1', async () => {
    mockSaasMetrics.getDailyWebhookErrorCount.mockResolvedValue(2);

    const Sentry = require('@sentry/node');
    jest.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'id');

    await job.execute();

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('webhook handler errors today'),
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('does NOT alert when daily webhook error count is 0', async () => {
    mockSaasMetrics.getDailyWebhookErrorCount.mockResolvedValue(0);

    const Sentry = require('@sentry/node');
    jest.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'id');

    await job.execute();

    const rawCountAlerts = (Sentry.captureMessage as jest.Mock).mock.calls.filter(
      ([msg]: [string]) => msg.includes('webhook handler errors today'),
    );
    expect(rawCountAlerts).toHaveLength(0);
  });

  it('captures Sentry alert when replay attack growth rate exceeds threshold', async () => {
    mockSaasMetrics.getProcessedWebhookEventGrowthRate.mockResolvedValue(15.0); // 15x baseline

    const Sentry = require('@sentry/node');
    jest.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'id');

    await job.execute();

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('replay attack'),
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('does NOT alert when growth rate is normal (<=5x)', async () => {
    mockSaasMetrics.getProcessedWebhookEventGrowthRate.mockResolvedValue(2.0);

    const Sentry = require('@sentry/node');
    jest.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'id');

    await job.execute();

    const replayAlerts = (Sentry.captureMessage as jest.Mock).mock.calls.filter(([msg]: [string]) =>
      msg.includes('replay attack'),
    );
    expect(replayAlerts).toHaveLength(0);
  });
});
