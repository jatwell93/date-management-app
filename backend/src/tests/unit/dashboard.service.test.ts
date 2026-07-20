import { DashboardService } from '../../services/dashboard.service';
import { ReportRepository } from '../../repositories/report.repository';

describe('DashboardService', () => {
  let dashboardService: DashboardService;
  let reportRepository: jest.Mocked<Pick<ReportRepository, 'getDashboardData'>>;

  beforeEach(() => {
    reportRepository = {
      getDashboardData: vi.fn(),
    };
    dashboardService = new DashboardService(reportRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return dashboard data', async () => {
    const mockDashboardData = {
      totalProducts: 100,
      expiringSoon: 10,
      markdownItems: 5,
      recentActivity: [],
    };

    reportRepository.getDashboardData.mockReturnValue(mockDashboardData);

    const dashboardData = await dashboardService.getDashboardData();

    expect(dashboardData).toEqual(mockDashboardData);
    expect(reportRepository.getDashboardData).toHaveBeenCalledTimes(1);
  });
});
