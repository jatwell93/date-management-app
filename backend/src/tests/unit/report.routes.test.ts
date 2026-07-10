import express from 'express';
import request from 'supertest';

const mockReportService = {
  getMonthlyExpiryReport: vi.fn(),
  getOverallExpiryReport: vi.fn(),
  getDetailedExpiryReport: vi.fn(),
  getActiveExpiryEntries: vi.fn(),
  getMonthlyMarkdownReport: vi.fn(),
  updateAllMarkdownStatuses: vi.fn(),
  getUsageReport: vi.fn(),
  getDailyUsageReport: vi.fn(),
  getLossBySkuReport: vi.fn(),
  getLossByDepartmentReport: vi.fn(),
  getItemsByUserReport: vi.fn(),
  getItemsByDateReport: vi.fn(),
  getStoreWalkAuditReport: vi.fn(),
  getDashboardAnalytics: vi.fn(),
};

const mockServiceProviderCtor = vi.fn().mockImplementation(function () {
  return {
    getReportService: () => mockReportService,
  };
});

// Invoked at the SUT's module-load (requireFeature() builds middleware), so it
// must exist before the hoisted vi.mock factory runs — wrap in vi.hoisted()
// (Vitest auto-hoists bare vi.fn() but not chained .mockImplementation()).
const mockRequireFeature = vi.hoisted(() =>
  vi.fn().mockImplementation(() => (_req: any, _res: any, next: any) => next()),
);

vi.mock('../../services/service-provider', () => ({
  ServiceProvider: function ServiceProvider(...args: unknown[]) {
    return mockServiceProviderCtor(...args);
  },
}));

vi.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.organizationId = req.get('x-org-id') || 'org-report-test';
    req.userId = 101;
    next();
  },
}));

vi.mock('../../middleware/feature-gate.middleware', () => ({
  requireFeature: (...args: unknown[]) => mockRequireFeature(...args),
}));

import reportRouter from '../../routes/report.routes';

describe('report.routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/reports', reportRouter);
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ message: err.message || 'Internal server error' });
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockReportService.getMonthlyExpiryReport.mockResolvedValue({ report: 'expiry' });
    mockReportService.getOverallExpiryReport.mockResolvedValue({ report: 'overall' });
    mockReportService.getDetailedExpiryReport.mockResolvedValue({ report: 'details' });
    mockReportService.getActiveExpiryEntries.mockResolvedValue({ report: 'entries' });
    mockReportService.getMonthlyMarkdownReport.mockResolvedValue({ report: 'markdown' });
    mockReportService.updateAllMarkdownStatuses.mockResolvedValue(undefined);
    mockReportService.getUsageReport.mockResolvedValue({ report: 'usage' });
    mockReportService.getDailyUsageReport.mockResolvedValue({ report: 'daily-usage' });
    mockReportService.getLossBySkuReport.mockResolvedValue({ report: 'loss-by-sku' });
    mockReportService.getLossByDepartmentReport.mockResolvedValue({ report: 'loss-by-department' });
    mockReportService.getItemsByUserReport.mockResolvedValue({ report: 'items-by-user' });
    mockReportService.getItemsByDateReport.mockResolvedValue({ report: 'items-by-date' });
    mockReportService.getStoreWalkAuditReport.mockResolvedValue({ report: 'store-walk-audit' });
    mockReportService.getDashboardAnalytics.mockResolvedValue({ report: 'analytics' });
  });

  it('returns expiry report and uses organization-scoped service provider', async () => {
    const response = await request(app).get('/reports/expiry');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ report: 'expiry' });
    expect(mockServiceProviderCtor).toHaveBeenCalledWith({ organizationId: 'org-report-test' });
    expect(mockReportService.getMonthlyExpiryReport).toHaveBeenCalledTimes(1);
  });

  it('returns payloads for standard report endpoints', async () => {
    const cases = [
      ['/reports/expiry-overall', { report: 'overall' }, 'getOverallExpiryReport'],
      ['/reports/expiry-details', { report: 'details' }, 'getDetailedExpiryReport'],
      ['/reports/expiry-entries', { report: 'entries' }, 'getActiveExpiryEntries'],
      ['/reports/monthly-markdown', { report: 'markdown' }, 'getMonthlyMarkdownReport'],
      ['/reports/usage', { report: 'usage' }, 'getUsageReport'],
      ['/reports/daily-usage', { report: 'daily-usage' }, 'getDailyUsageReport'],
      ['/reports/loss-by-sku', { report: 'loss-by-sku' }, 'getLossBySkuReport'],
      [
        '/reports/loss-by-department',
        { report: 'loss-by-department' },
        'getLossByDepartmentReport',
      ],
      ['/reports/items-by-date', { report: 'items-by-date' }, 'getItemsByDateReport'],
      ['/reports/store-walk-audit', { report: 'store-walk-audit' }, 'getStoreWalkAuditReport'],
      ['/reports/analytics', { report: 'analytics' }, 'getDashboardAnalytics'],
    ] as const;

    for (const [path, expectedPayload, methodName] of cases) {
      const response = await request(app).get(path);
      expect(response.status).toBe(200);
      expect(response.body).toEqual(expectedPayload);
      expect(mockReportService[methodName]).toHaveBeenCalled();
    }
  });

  it('returns success message for update-statuses endpoint', async () => {
    const response = await request(app).post('/reports/update-statuses');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: 'All inventory markdown statuses updated successfully.',
    });
    expect(mockReportService.updateAllMarkdownStatuses).toHaveBeenCalledTimes(1);
  });

  it('returns 400 for invalid items-by-user timeframe and does not call service', async () => {
    const response = await request(app).get('/reports/items-by-user').query({ timeFrame: '0' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: 'Invalid timeFrame value' });
    expect(mockReportService.getItemsByUserReport).not.toHaveBeenCalled();
  });

  it('passes valid timeframe to items-by-user report service', async () => {
    const response = await request(app).get('/reports/items-by-user').query({ timeFrame: '30' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ report: 'items-by-user' });
    expect(mockReportService.getItemsByUserReport).toHaveBeenCalledWith('30');
  });

  it('passes undefined timeframe when items-by-user query is omitted', async () => {
    const response = await request(app).get('/reports/items-by-user');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ report: 'items-by-user' });
    expect(mockReportService.getItemsByUserReport).toHaveBeenCalledWith(undefined);
  });

  it('forwards endpoint failures to error middleware', async () => {
    mockReportService.getOverallExpiryReport.mockRejectedValue(new Error('report failed'));

    const response = await request(app).get('/reports/expiry-overall');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'report failed' });
  });

  it('forwards loss-by-department failures to error middleware', async () => {
    mockReportService.getLossByDepartmentReport.mockRejectedValue(
      new Error('loss-by-department failed'),
    );

    const response = await request(app).get('/reports/loss-by-department');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'loss-by-department failed' });
  });

  it('forwards items-by-user failures to error middleware', async () => {
    mockReportService.getItemsByUserReport.mockRejectedValue(new Error('items-by-user failed'));

    const response = await request(app).get('/reports/items-by-user').query({ timeFrame: '30' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'items-by-user failed' });
  });

  it('forwards items-by-date failures to error middleware', async () => {
    mockReportService.getItemsByDateReport.mockRejectedValue(new Error('items-by-date failed'));

    const response = await request(app).get('/reports/items-by-date');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'items-by-date failed' });
  });

  it('forwards analytics failures to error middleware', async () => {
    mockReportService.getDashboardAnalytics.mockRejectedValue(new Error('analytics failed'));

    const response = await request(app).get('/reports/analytics');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'analytics failed' });
  });
});
