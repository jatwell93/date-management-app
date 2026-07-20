import { HourlyWebhookCheckJob } from '../../jobs/daily-metrics.job';
import { SaasMetricsService } from '../../services/saas-metrics.service';

vi.mock('../../services/saas-metrics.service');
vi.mock('../../database/database-factory');
// Auto-mock Sentry so its exports are Vitest-controlled vi.fns shared with the
// SUT's module graph. (Spying on a real `await import('@sentry/node')` namespace
// fails with "Cannot redefine property" — ESM namespaces are non-configurable.)
vi.mock('@sentry/node');

describe('Webhook Monitoring', () => {
  let job: HourlyWebhookCheckJob;
  let mockSaasMetrics: jest.Mocked<SaasMetricsService>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockSaasMetrics = {
      calculateWebhookFailureRate: vi.fn().mockResolvedValue(0),
      getDailyWebhookErrorCount: vi.fn().mockResolvedValue(0),
      getProcessedWebhookEventGrowthRate: vi.fn().mockResolvedValue(1.0),
    } as any;

    // A regular function (not an arrow) is required: Vitest invokes the mock impl
    // with `new` here (the SUT does `new SaasMetricsService()`), and arrows cannot
    // be constructed.
    (SaasMetricsService as unknown as jest.Mock).mockImplementation(function () {
      return mockSaasMetrics;
    });
    job = new HourlyWebhookCheckJob();
  });

  it('captures Sentry alert when daily webhook error count exceeds 1', async () => {
    mockSaasMetrics.getDailyWebhookErrorCount.mockResolvedValue(2);

    const Sentry = await import('@sentry/node');
    vi.mocked(Sentry.captureMessage).mockImplementation(() => 'id');

    await job.execute();

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('webhook handler errors today'),
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('does NOT alert when daily webhook error count is 0', async () => {
    mockSaasMetrics.getDailyWebhookErrorCount.mockResolvedValue(0);

    const Sentry = await import('@sentry/node');
    vi.mocked(Sentry.captureMessage).mockImplementation(() => 'id');

    await job.execute();

    const rawCountAlerts = (Sentry.captureMessage as jest.Mock).mock.calls.filter(
      ([msg]: [string]) => msg.includes('webhook handler errors today'),
    );
    expect(rawCountAlerts).toHaveLength(0);
  });

  it('captures Sentry alert when replay attack growth rate exceeds threshold', async () => {
    mockSaasMetrics.getProcessedWebhookEventGrowthRate.mockResolvedValue(15.0); // 15x baseline

    const Sentry = await import('@sentry/node');
    vi.mocked(Sentry.captureMessage).mockImplementation(() => 'id');

    await job.execute();

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining('replay attack'),
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('does NOT alert when growth rate is normal (<=5x)', async () => {
    mockSaasMetrics.getProcessedWebhookEventGrowthRate.mockResolvedValue(2.0);

    const Sentry = await import('@sentry/node');
    vi.mocked(Sentry.captureMessage).mockImplementation(() => 'id');

    await job.execute();

    const replayAlerts = (Sentry.captureMessage as jest.Mock).mock.calls.filter(([msg]: [string]) =>
      msg.includes('replay attack'),
    );
    expect(replayAlerts).toHaveLength(0);
  });
});
