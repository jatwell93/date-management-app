import { DashboardService } from "../services/dashboard.service";
import { getDb } from "../database";

// Mock the database module
jest.mock("../database", () => ({
  getDb: jest.fn(),
}));

describe("DashboardService", () => {
  let dashboardService: DashboardService;
  interface MockDatabase {
    get: jest.Mock;
    all: jest.Mock;
  }
  let mockDb: MockDatabase;

  beforeEach(() => {
    dashboardService = new DashboardService();
    mockDb = {
      get: jest.fn(),
      all: jest.fn(),
    };
    (getDb as jest.Mock).mockResolvedValue(mockDb);
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
    expect(getDb).toHaveBeenCalledTimes(1);
    expect(mockDb.get).toHaveBeenCalledTimes(3);
    expect(mockDb.all).toHaveBeenCalledTimes(1);
  });
});
