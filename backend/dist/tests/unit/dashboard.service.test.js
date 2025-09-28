"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dashboard_service_1 = require("../services/dashboard.service");
const database_1 = require("../database");
// Mock the database module
jest.mock("../database", () => ({
    getDb: jest.fn(),
}));
describe("DashboardService", () => {
    let dashboardService;
    let mockDb;
    beforeEach(() => {
        dashboardService = new dashboard_service_1.DashboardService();
        mockDb = {
            get: jest.fn(),
            all: jest.fn(),
        };
        database_1.getDb.mockResolvedValue(mockDb);
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    it("should return dashboard data", async () => {
        mockDb.get
            .mockResolvedValueOnce({ count: 1500 }) // totalProducts
            .mockResolvedValueOnce({ count: 50 }) // expiringSoon
            .mockResolvedValueOnce({ count: 75 }); // markdownItems
        mockDb.all.mockResolvedValueOnce([
            {
                id: 1,
                description: "Product A scanned",
                timestamp: "2025-09-24T10:00:00Z",
            },
            {
                id: 2,
                description: "Product B marked down",
                timestamp: "2025-09-24T09:00:00Z",
            },
        ]);
        const dashboardData = await dashboardService.getDashboardData();
        expect(dashboardData).toEqual({
            totalProducts: 1500,
            expiringSoon: 50,
            markdownItems: 75,
            recentActivity: [
                {
                    id: 1,
                    description: "Product A scanned",
                    timestamp: "2025-09-24T10:00:00Z",
                },
                {
                    id: 2,
                    description: "Product B marked down",
                    timestamp: "2025-09-24T09:00:00Z",
                },
            ],
        });
        expect(database_1.getDb).toHaveBeenCalledTimes(1);
        expect(mockDb.get).toHaveBeenCalledTimes(3);
        expect(mockDb.all).toHaveBeenCalledTimes(1);
    });
});
