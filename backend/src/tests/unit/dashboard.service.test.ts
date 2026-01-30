import { DashboardService } from '../../services/dashboard.service';
import { getDb } from '../../database';

jest.mock('../../database');

describe('DashboardService', () => {
  let dashboardService: DashboardService;

  beforeEach(() => {
    dashboardService = new DashboardService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return dashboard data', async () => {
    const mockDashboardData = {
      totalProducts: 100,
      expiringSoon: 10,
      markdownItems: 5,
      recentActivity: [],
    };

    const mockStatement = {
      get: jest
        .fn()
        .mockReturnValueOnce({ count: 100 })
        .mockReturnValueOnce({ count: 10 })
        .mockReturnValueOnce({ count: 5 }),
      all: jest.fn().mockReturnValueOnce([]),
    };

    const mockDb = {
      prepare: jest.fn(() => mockStatement),
    };

    (getDb as jest.Mock).mockReturnValue(mockDb);

    const dashboardData = await dashboardService.getDashboardData();

    expect(dashboardData).toEqual(mockDashboardData);
    expect(getDb).toHaveBeenCalledTimes(1);
    expect(mockDb.prepare).toHaveBeenCalledTimes(4);
    expect(mockStatement.get).toHaveBeenCalledTimes(3);
    expect(mockStatement.all).toHaveBeenCalledTimes(1);
  });
});
