import express from 'express';
import request from 'supertest';

const mockGetDashboardData = jest.fn();
const MockDashboardService = jest.fn().mockImplementation(() => ({
  getDashboardData: (...args: unknown[]) => mockGetDashboardData(...args),
}));

jest.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

jest.mock('../../services/dashboard.service', () => ({
  DashboardService: MockDashboardService,
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
    jest.clearAllMocks();
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
    expect(MockDashboardService).toHaveBeenCalledTimes(1);
  });

  it('forwards service errors to error middleware on GET /dashboard', async () => {
    mockGetDashboardData.mockRejectedValue(new Error('dashboard service unavailable'));

    const response = await request(app).get('/dashboard');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: 'dashboard service unavailable' });
  });
});
