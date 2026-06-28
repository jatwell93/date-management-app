import express from 'express';
import request from 'supertest';

const mockGetSaasMetrics = vi.fn();
const mockGetApplicationMetrics = vi.fn();
const mockGroupBy = vi.fn();
const mockFindMany = vi.fn();
const mockResolve = vi.fn();
const mockGetDefaultDatabaseClient = vi.fn(() => {
  throw new Error('admin metrics routes must resolve repositories through DI');
});
const mockSubscriptionRepository = {
  groupSubscriptionCountsByTierAndStatus: (...args: unknown[]) => mockGroupBy(...args),
};
const mockAnalyticsRepository = {
  findMetricsSnapshotsSince: (...args: unknown[]) => mockFindMany(...args),
};

vi.mock('../../middleware/requireOrgRole', () => ({
  requireOrgRole:
    (...allowedRoles: string[]) =>
    (req: any, _res: any, next: any) => {
      req.organizationId = 'org-admin-test';
      req.userId = 42;
      req.userRole = allowedRoles[0] || 'admin';
      next();
    },
}));

vi.mock('../../services/application.monitoring.service', () => ({
  ApplicationMonitoringService: {
    getInstance: vi.fn(() => ({
      getMetrics: (...args: unknown[]) => mockGetApplicationMetrics(...args),
    })),
  },
}));

vi.mock('../../services/saas-metrics.service', () => ({
  SaasMetricsService: vi.fn().mockImplementation(function () {
    return {
      getSaasMetrics: (...args: unknown[]) => mockGetSaasMetrics(...args),
    };
  }),
}));

vi.mock('../../database/database-factory', () => ({
  getDefaultDatabaseClient: () => mockGetDefaultDatabaseClient(),
}));

vi.mock('../../di/container', () => ({
  getDiContainer: () => ({
    resolve: (...args: unknown[]) => mockResolve(...args),
  }),
}));

vi.mock('../../repositories/subscription.repository', () => ({
  SubscriptionRepository: class SubscriptionRepository {},
}));

vi.mock('../../repositories/analytics.repository', () => ({
  AnalyticsRepository: class AnalyticsRepository {},
}));

vi.mock('../../utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import adminMetricsRouter from '../../routes/admin.metrics.routes';

const makeSnapshot = (
  dayOffset: number,
  totalRevenueCents: number,
  overrides: Record<string, unknown> = {},
) => ({
  date: new Date(Date.UTC(2026, 0, 1 + dayOffset)),
  totalRevenueCents,
  tierDistribution: JSON.stringify({ starter: 5, professional: 3 }),
  trialConversionRate: 18,
  avgRevenuePerUser: 2450,
  churnRate: 2.5,
  totalTrials: 120,
  totalConversions: 32,
  totalChurn: 5,
  ...overrides,
});

describe('admin.metrics.routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/metrics', adminMetricsRouter);

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetSaasMetrics.mockResolvedValue({
      trialConversionRate: 22,
      avgRevenuePerUser: 12345,
      churnRate: 2.1,
      monthlyRecurringRevenue: 567890,
      totalActiveSubscriptions: 321,
      newTrialsThisMonth: 50,
      conversionsThisMonth: 11,
      churnsThisMonth: 3,
      webhookFailureRate: 1.2,
      paymentFailureRate: 0.8,
      tierDistribution: { starter: 20, professional: 10 },
    });

    mockGetApplicationMetrics.mockResolvedValue({
      performance: {
        totalRequests: 1000,
        avgResponseTime: 180,
      },
      errors: {
        errorRate: 0.7,
      },
      health: {
        uptime: 9876,
      },
      webhook: {
        total: 77,
        idempotencySkips: 4,
      },
      userJourneys: {
        login: { count: 100, avgTime: 120, errorRate: 0.01 },
      },
      timestamp: new Date('2026-01-10T00:00:00.000Z'),
    });

    mockGroupBy.mockResolvedValue([]);
    mockFindMany.mockResolvedValue([]);
    mockResolve.mockImplementation((token) => {
      if (token.name === 'SubscriptionRepository') return mockSubscriptionRepository;
      if (token.name === 'AnalyticsRepository') return mockAnalyticsRepository;
      throw new Error(`Unexpected token: ${token.name}`);
    });
  });

  it('returns dashboard metrics with normalized revenue values', async () => {
    const response = await request(app).get('/api/admin/metrics/dashboard');

    expect(response.status).toBe(200);
    expect(response.body.business.avgRevenuePerUser).toBe(123.45);
    expect(response.body.business.monthlyRecurringRevenue).toBe(5678.9);
    expect(response.body.performance.totalRequests).toBe(1000);
    expect(response.body.webhooks.idempotencySkips).toBe(4);
    expect(response.body.metadata.organizationId).toBe('org-admin-test');
    expect(response.body.metadata.requestedBy).toBe(42);
  });

  it('falls back to zero business metrics when saas metrics are missing', async () => {
    mockGetSaasMetrics.mockResolvedValue(null);

    const response = await request(app).get('/api/admin/metrics/dashboard');

    expect(response.status).toBe(200);
    expect(response.body.business.trialConversionRate).toBe(0);
    expect(response.body.business.totalActiveSubscriptions).toBe(0);
    expect(response.body.tiers).toEqual({});
  });

  it('returns 500 when dashboard dependencies fail', async () => {
    mockGetApplicationMetrics.mockRejectedValue(new Error('monitoring unavailable'));

    const response = await request(app).get('/api/admin/metrics/dashboard');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Failed to retrieve dashboard metrics' });
  });

  it('returns subscription tier distribution and revenue totals', async () => {
    mockGroupBy.mockResolvedValue([
      { tierLevel: 'starter', status: 'trial', _count: 3 },
      { tierLevel: 'starter', status: 'canceled', _count: 1 },
      { tierLevel: 'professional', status: 'active', _count: 2 },
      { tierLevel: 'pro', status: 'active', _count: 1 },
      { tierLevel: 'enterprise', status: 'active', _count: 1 },
    ]);

    const response = await request(app).get('/api/admin/metrics/subscription-tiers');

    expect(response.status).toBe(200);
    expect(response.body.tiers.starter.trial).toBe(3);
    expect(response.body.tiers.starter.canceled).toBe(1);
    // Professional $99/mo: 2 active = $198
    expect(response.body.tiers.professional.monthlyRevenue).toBe(198);
    // Legacy 'pro' maps to professional pricing: 1 active = $99
    expect(response.body.tiers.pro.monthlyRevenue).toBe(99);
    // Enterprise is quote-based (TIER_PRICES.enterprise = 0)
    expect(response.body.tiers.enterprise.monthlyRevenue).toBe(0);
    expect(response.body.totalRevenue).toBe(297);
    expect(response.body.totalSubscriptions).toBe(8);
  });

  it('returns 500 when subscription tier metrics query fails', async () => {
    mockGroupBy.mockRejectedValue(new Error('groupBy failed'));

    const response = await request(app).get('/api/admin/metrics/subscription-tiers');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Failed to retrieve subscription tier metrics' });
  });

  it('returns insufficient-data projections when fewer than 30 snapshots exist', async () => {
    mockFindMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, idx) => makeSnapshot(idx, 10000)),
    );

    const response = await request(app).get('/api/admin/metrics/revenue-projections');

    expect(response.status).toBe(200);
    expect(response.body.trend).toBe('insufficient_data');
    expect(response.body.confidence).toBe('low');
    expect(response.body.projections.next30Days).toBe(0);
  });

  it('returns projections with trend data when snapshots are sufficient', async () => {
    const snapshots = Array.from({ length: 35 }, (_, idx) => makeSnapshot(idx, 10000 + idx * 2000));
    mockFindMany.mockResolvedValue(snapshots);

    const response = await request(app).get('/api/admin/metrics/revenue-projections');

    expect(response.status).toBe(200);
    expect(response.body.trend).toBe('growing');
    expect(response.body.metrics.dataPoints).toBe(35);
    expect(response.body.projections.next30Days).toBeGreaterThan(
      response.body.metrics.currentMonthlyRevenue,
    );
  });

  it('returns 500 when revenue projection query fails', async () => {
    mockFindMany.mockRejectedValue(new Error('projection query failed'));

    const response = await request(app).get('/api/admin/metrics/revenue-projections');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Failed to generate revenue projections' });
  });

  it('returns historical metrics and clamps requested day range', async () => {
    mockFindMany.mockResolvedValue([
      makeSnapshot(1, 10000, { tierDistribution: JSON.stringify({ starter: 1 }) }),
      makeSnapshot(2, 12000, { tierDistribution: '{bad-json' }),
    ]);

    const response = await request(app).get('/api/admin/metrics/historical?days=999');

    expect(response.status).toBe(200);
    expect(response.body.period.days).toBe(365);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].tierDistribution).toEqual({ starter: 1 });
    expect(response.body.data[1].tierDistribution).toEqual({});
  });

  it('enforces minimum day range for historical metrics', async () => {
    mockFindMany.mockResolvedValue([]);

    const response = await request(app).get('/api/admin/metrics/historical?days=1');

    expect(response.status).toBe(200);
    expect(response.body.period.days).toBe(7);
  });

  it('returns 500 when historical metrics query fails', async () => {
    mockFindMany.mockRejectedValue(new Error('historical query failed'));

    const response = await request(app).get('/api/admin/metrics/historical?days=30');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Failed to retrieve historical metrics' });
  });

  it('returns no-data status for alerts when saas metrics are unavailable', async () => {
    mockGetSaasMetrics.mockResolvedValue(null);

    const response = await request(app).get('/api/admin/metrics/alerts');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('no_data');
    expect(response.body.alerts).toEqual([]);
  });

  it('returns critical alert status when thresholds are breached', async () => {
    mockGetSaasMetrics.mockResolvedValue({
      trialConversionRate: 4,
      webhookFailureRate: 8,
      churnRate: 9,
      paymentFailureRate: 3,
    });

    const response = await request(app).get('/api/admin/metrics/alerts');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('critical');
    expect(response.body.alerts.map((a: { type: string }) => a.type)).toEqual(
      expect.arrayContaining([
        'LOW_TRIAL_CONVERSION',
        'HIGH_WEBHOOK_FAILURE',
        'HIGH_CHURN_RATE',
        'HIGH_PAYMENT_FAILURE',
      ]),
    );
  });

  it('returns healthy alert status when all metrics are within thresholds', async () => {
    mockGetSaasMetrics.mockResolvedValue({
      trialConversionRate: 20,
      webhookFailureRate: 1,
      churnRate: 2,
      paymentFailureRate: 0.3,
    });

    const response = await request(app).get('/api/admin/metrics/alerts');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
    expect(response.body.alerts).toEqual([]);
  });

  it('returns 500 when alert evaluation fails', async () => {
    mockGetSaasMetrics.mockRejectedValue(new Error('alerts failed'));

    const response = await request(app).get('/api/admin/metrics/alerts');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'Failed to retrieve alert status' });
  });
});
