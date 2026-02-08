"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const report_service_1 = require("../../services/report.service");
const database_1 = require("../../database");
// Mock the database module
jest.mock('../../database', () => ({
    getDb: jest.fn(),
}));
describe('ReportService', () => {
    let reportService;
    beforeEach(() => {
        reportService = new report_service_1.ReportService();
        const mockStatement = {
            run: jest.fn(),
            all: jest.fn(),
            get: jest.fn(),
        };
        const mockDb = {
            prepare: jest.fn(() => mockStatement),
        };
        database_1.getDb.mockReturnValue(mockDb);
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    it('should return monthly markdown report', async () => {
        const mockReport = [
            { month: '2025-08', totalMarkdownValue: 150.75, itemCount: 25 },
            { month: '2025-09', totalMarkdownValue: 200.5, itemCount: 30 },
        ];
        const mockStatement = (0, database_1.getDb)().prepare();
        mockStatement.all.mockResolvedValue(mockReport);
        const report = await reportService.getMonthlyMarkdownReport();
        expect(report).toEqual(mockReport);
    });
    it('should return usage report', async () => {
        const mockUsageReport = [
            { user: 'Manager', scans: 100, markdowns: 10 },
            { user: 'Team Member', scans: 50, markdowns: 5 },
        ];
        const mockStatement = (0, database_1.getDb)().prepare();
        mockStatement.all.mockResolvedValue(mockUsageReport);
        const usageReport = await reportService.getUsageReport();
        expect(usageReport).toEqual(mockUsageReport);
    });
});
