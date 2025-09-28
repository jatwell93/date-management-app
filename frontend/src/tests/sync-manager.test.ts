import { synchronizeOfflineData } from "../lib/sync-manager";
import { offlineStorage } from "../lib/offline-storage";
import { waitFor } from "@testing-library/react";

// Mock fetch API
global.fetch = jest.fn((url: RequestInfo | URL) => {
  const urlString = url.toString();
  if (urlString.includes("/inventory-items")) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({ message: "Inventory item added successfully!" }),
    } as Response);
  }
  return Promise.reject(new Error("Unhandled fetch request"));
});

// Mock offlineStorage
jest.mock("../lib/offline-storage", () => ({
  offlineStorage: {
    setItem: jest.fn(),
    getItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
    keys: jest.fn(),
  },
}));

describe("synchronizeOfflineData", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default to online
    Object.defineProperty(navigator, "onLine", { writable: true, value: true });
  });

  it("should not synchronize if token is missing", async () => {
    await synchronizeOfflineData(null);
    expect(offlineStorage.keys).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should not synchronize if offline", async () => {
    Object.defineProperty(navigator, "onLine", {
      writable: true,
      value: false,
    });
    await synchronizeOfflineData("mock_token");
    expect(offlineStorage.keys).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should synchronize pending inventory items when online", async () => {
    (offlineStorage.keys as jest.Mock).mockResolvedValueOnce([
      "pending-inventory-item-1",
      "pending-inventory-item-2",
    ]);
    (offlineStorage.getItem as jest.Mock)
      .mockResolvedValueOnce({
        product_id: 1,
        expiry_date: "2026-12-31",
        location_id: 1,
      })
      .mockResolvedValueOnce({
        product_id: 2,
        expiry_date: "2026-11-30",
        location_id: 2,
      });

    await synchronizeOfflineData("mock_token");

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    expect(offlineStorage.keys).toHaveBeenCalledTimes(1);
    expect(offlineStorage.getItem).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/inventory-items",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          product_id: 1,
          expiry_date: "2026-12-31",
          location_id: 1,
        }),
      }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3001/inventory-items",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          product_id: 2,
          expiry_date: "2026-11-30",
          location_id: 2,
        }),
      }),
    );
    expect(offlineStorage.removeItem).toHaveBeenCalledTimes(2);
    expect(offlineStorage.removeItem).toHaveBeenCalledWith(
      "pending-inventory-item-1",
    );
    expect(offlineStorage.removeItem).toHaveBeenCalledWith(
      "pending-inventory-item-2",
    );
  });

  it("should handle failed synchronization gracefully", async () => {
    (offlineStorage.keys as jest.Mock).mockResolvedValueOnce([
      "pending-inventory-item-1",
    ]);
    (offlineStorage.getItem as jest.Mock).mockResolvedValueOnce({
      product_id: 1,
      expiry_date: "2026-12-31",
      location_id: 1,
    });
    (global.fetch as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ message: "Failed to add item" }),
      } as Response),
    );

    await synchronizeOfflineData("mock_token");

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    expect(offlineStorage.keys).toHaveBeenCalledTimes(1);
    expect(offlineStorage.getItem).toHaveBeenCalledTimes(1);
    expect(offlineStorage.removeItem).not.toHaveBeenCalled(); // Should not remove on failure
  });

  it("should do nothing if no pending items", async () => {
    (offlineStorage.keys as jest.Mock).mockResolvedValueOnce([]);

    await synchronizeOfflineData("mock_token");

    expect(offlineStorage.keys).toHaveBeenCalledTimes(1);
    expect(offlineStorage.getItem).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(offlineStorage.removeItem).not.toHaveBeenCalled();
  });
});
