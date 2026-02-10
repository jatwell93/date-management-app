"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const report_service_1 = require("../../services/report.service");
// Mock the ReportRepository
jest.mock('../../repositories/report.repository');
describe('ReportService', () => {
    let reportService;
    let mockRepository;
    let mockDb;
    beforeEach(() => {
        // Create a mock database instance
        mockDb = {};
        // Create service with mock database
        reportService = new report_service_1.ReportService(mockDb);
        // Create mock repository
        mockRepository = {
            getMonthlyExpiryReport: jest.fn().mockResolvedValue([]),
            getOverallExpiryReport: jest.fn().mockResolvedValue({}),
            getDetailedExpiryReport: jest.fn().mockResolvedValue([]),
            getMonthlyMarkdownReport: jest.fn().mockResolvedValue([]),
            getUsageReport: jest.fn().mockResolvedValue([]),
            getDailyUsageReport: jest.fn().mockResolvedValue([]),
            getDashboardAnalytics: jest.fn().mockResolvedValue({}),
            getLossBySkuReport: jest.fn().mockResolvedValue([]),
            getLossByDepartmentReport: jest.fn().mockResolvedValue([]),
            getItemsByUserReport: jest.fn().mockResolvedValue([]),
            getItemsByDateReport: jest.fn().mockResolvedValue([]),
        };
        // Inject the mock repository into the service
        reportService.repository = mockRepository;
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    it('should return monthly markdown report', async () => {
        const mockReport = [
            { month: '2025-08', totalMarkdownValue: 150.75, itemCount: 25 },
            { month: '2025-09', totalMarkdownValue: 200.5, itemCount: 30 },
        ];
        mockRepository.getMonthlyMarkdownReport.mockResolvedValue(mockReport);
        const report = await reportService.getMonthlyMarkdownReport();
        expect(report).toEqual(mockReport);
        expect(mockRepository.getMonthlyMarkdownReport).toHaveBeenCalledTimes(1);
    });
    it('should return usage report', async () => {
        const mockUsageReport = [
            { role: 'Manager', userCount: 5, totalActions: 100 },
            { role: 'Team Member', userCount: 10, totalActions: 150 },
        ];
        mockRepository.getUsageReport.mockResolvedValue(mockUsageReport);
        const usageReport = await reportService.getUsageReport();
        expect(usageReport).toEqual(mockUsageReport);
        expect(mockRepository.getUsageReport).toHaveBeenCalledTimes(1);
    });
    it('should return monthly expiry report', async () => {
        const mockReport = [
            { month: '2025-08', expiredCount: 10, markdownCount: 5 },
            { month: '2025-09', expiredCount: 15, markdownCount: 8 },
        ];
        mockRepository.getMonthlyExpiryReport.mockResolvedValue(mockReport);
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
        mockRepository.getDashboardAnalytics.mockResolvedValue(mockAnalytics);
        const analytics = await reportService.getDashboardAnalytics();
        expect(analytics).toEqual(mockAnalytics);
        expect(mockRepository.getDashboardAnalytics).toHaveBeenCalledTimes(1);
    });
});
