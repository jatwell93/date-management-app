import express from 'express';
import request from 'supertest';

// The vi.mock factory references MockServiceProvider directly, so it (and the
// mocks it closes over) must be initialized before the hoisted factory runs.
// vi.hoisted() lifts the whole interdependent group above the mock.
const { mockGetDashboardData, mockGetDashboardService, MockServiceProvider } = vi.hoisted(() => {
  const mockGetDashboardData = vi.fn();
  const mockGetDashboardService = vi.fn(() => ({
    getDashboardData: (...args: unknown[]) => mockGetDashboardData(...args),
  }));
  const MockServiceProvider = vi.fn().mockImplementation(function () {
    return {
      getDashboardService: mockGetDashboardService,
    };
  });
  return { mockGetDashboardData, mockGetDashboardService, MockServiceProvider };
});

vi.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../services/service-provider', () => ({
  ServiceProvider: MockServiceProvider,
}));

import dashboardRouter from '../../routes/dashboard.routes';

describe('dashboard.routes', () => {
  const app = express();

  app.use(express.json());
  app.use('/dashboard', dashboardRouter);

  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ message: err.message });
    },
  );

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDashboardData.mockResolvedValue({
      totalProducts: 12,
      totalInventoryItems: 34,
      totalValue: 567.89,
    });
  });

  it('returns dashboard payload on GET /dashboard', async () => {
    const response = await request(app).get('/dashboard');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      totalProducts: 12,
      totalInventoryItems: 34,
      totalValue: 567.89,
    });
    expect(MockServiceProvider).toHaveBeenCalledTimes(1);
    expect(mockGetDashboardService).toHaveBeenCalledTimes(1);
  });

  it('forwards service errors to error middleware on GET /dashboard', async () => {
    mockGetDashboardData.mockRejectedValue(new Error('dashboard service unavailable'));

    const response = await request(app).get('/dashboard');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'dashboard service unavailable' });
  });
});
