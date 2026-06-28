import { ReportService } from '../../services/report.service';
import { ReportRepository } from '../../repositories/report.repository';
import Database from 'better-sqlite3';

// Mock the ReportRepository
vi.mock('../../repositories/report.repository');

describe('ReportService', () => {
  let reportService: ReportService;
  let mockRepository: jest.Mocked<ReportRepository>;
  let mockDb: Partial<InstanceType<typeof Database>>;

  beforeEach(() => {
    // Create a mock database instance
    mockDb = {} as Database;

    // Create service with mock database
    reportService = new ReportService(mockDb as Database, 'test-org');

    // Create mock repository
    mockRepository = {
      getMonthlyExpiryReport: vi.fn().mockResolvedValue([]),
      getOverallExpiryReport: vi.fn().mockResolvedValue({}),
      getDetailedExpiryReport: vi.fn().mockResolvedValue([]),
      getMonthlyMarkdownReport: vi.fn().mockResolvedValue([]),
      getUsageReport: vi.fn().mockResolvedValue([]),
      getDailyUsageReport: vi.fn().mockResolvedValue([]),
      getDashboardAnalytics: vi.fn().mockResolvedValue({}),
      getLossBySkuReport: vi.fn().mockResolvedValue([]),
      getLossByDepartmentReport: vi.fn().mockResolvedValue([]),
      getItemsByUserReport: vi.fn().mockResolvedValue([]),
      getItemsByDateReport: vi.fn().mockResolvedValue([]),
    } as any;

    // Inject the mock repository into the service
    (reportService as any).repository = mockRepository;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return monthly markdown report', async () => {
    const mockReport = [
      { month: '2025-08', totalMarkdownValue: 150.75, itemCount: 25 },
      { month: '2025-09', totalMarkdownValue: 200.5, itemCount: 30 },
    ];
    (mockRepository.getMonthlyMarkdownReport as any).mockResolvedValue(mockReport);

    const report = await reportService.getMonthlyMarkdownReport();

    expect(report).toEqual(mockReport);
    expect(mockRepository.getMonthlyMarkdownReport).toHaveBeenCalledTimes(1);
  });

  it('should return usage report', async () => {
    const mockUsageReport = [
      { role: 'Manager', userCount: 5, totalActions: 100 },
      { role: 'Team Member', userCount: 10, totalActions: 150 },
    ];
    (mockRepository.getUsageReport as any).mockResolvedValue(mockUsageReport);

    const usageReport = await reportService.getUsageReport();

    expect(usageReport).toEqual(mockUsageReport);
    expect(mockRepository.getUsageReport).toHaveBeenCalledTimes(1);
  });

  it('should return monthly expiry report', async () => {
    const mockReport = [
      { month: '2025-08', expiredCount: 10, markdownCount: 5 },
      { month: '2025-09', expiredCount: 15, markdownCount: 8 },
    ];
    (mockRepository.getMonthlyExpiryReport as any).mockResolvedValue(mockReport);

    const report = await reportService.getMonthlyExpiryReport();

    expect(report).toEqual(mockReport);
    expect(mockRepository.getMonthlyExpiryReport).toHaveBeenCalledTimes(1);
  });

  it('should return dashboard analytics', async () => {
    const mockAnalytics = {
      totalItems: 1000,
      expiringThisWeek: 25,
      expiringThisMonth: 100,
      totalExpired: 50,
      totalMarkdown: 30,
      totalValue: 50000,
      expiredValue: 1500,
      markdownValue: 800,
    };
    (mockRepository.getDashboardAnalytics as any).mockResolvedValue(mockAnalytics);

    const analytics = await reportService.getDashboardAnalytics();

    expect(analytics).toEqual(mockAnalytics);
    expect(mockRepository.getDashboardAnalytics).toHaveBeenCalledTimes(1);
  });
});
