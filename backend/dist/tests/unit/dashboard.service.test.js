"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dashboard_service_1 = require("../../services/dashboard.service");
const database_1 = require("../../database");
jest.mock("../../database");
describe("DashboardService", () => {
    let dashboardService;
    beforeEach(() => {
        dashboardService = new dashboard_service_1.DashboardService();
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    it("should return dashboard data", async () => {
        const mockDashboardData = {
            totalProducts: 100,
            expiringSoon: 10,
            markdownItems: 5,
            recentActivity: [],
        };
        const mockStatement = {
            get: jest.fn()
                .mockReturnValueOnce({ count: 100 })
                .mockReturnValueOnce({ count: 10 })
                .mockReturnValueOnce({ count: 5 }),
            all: jest.fn().mockReturnValueOnce([]),
        };
        const mockDb = {
            prepare: jest.fn(() => mockStatement),
        };
        database_1.getDb.mockReturnValue(mockDb);
        const dashboardData = await dashboardService.getDashboardData();
        expect(dashboardData).toEqual(mockDashboardData);
        expect(database_1.getDb).toHaveBeenCalledTimes(1);
        expect(mockDb.prepare).toHaveBeenCalledTimes(4);
        expect(mockStatement.get).toHaveBeenCalledTimes(3);
        expect(mockStatement.all).toHaveBeenCalledTimes(1);
    });
});
