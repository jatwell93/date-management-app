import { InventoryService } from "../../services/inventory.service";
import { getDb } from "../../database";

// Mock the database module
jest.mock("../../database", () => ({
  getDb: jest.fn(),
}));

describe("InventoryService", () => {
  let inventoryService: InventoryService;
  interface MockDatabase {
    run: jest.Mock;
  }
  let mockDb: MockDatabase;

  beforeEach(() => {
    inventoryService = new InventoryService();
    mockDb = {
      run: jest.fn(),
    };
    (getDb as jest.Mock).mockResolvedValue(mockDb);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should create a new inventory item", async () => {
    const newItemData = {
      productId: 1,
      expiryDate: "2025-12-31",
      locationId: 1,
      status: "Normal" as "Normal" | "Markdown 1" | "Markdown 2" | "Markdown 3" | "Expired",
    };
    mockDb.run.mockResolvedValue({ lastID: 1 });

    const createdItem = await inventoryService.createInventoryItem(newItemData);

    expect(createdItem).toEqual(
      expect.objectContaining({
        id: 1,
        ...newItemData,
      }),
    );
    expect(getDb).toHaveBeenCalledTimes(1);
    expect(mockDb.run).toHaveBeenCalledWith(
      "INSERT INTO inventory_items (product_id, expiry_date, location_id, status) VALUES (?, ?, ?, ?)",
      newItemData.productId,
      newItemData.expiryDate,
      newItemData.locationId,
      newItemData.status,
    );
  });

  it("should update an inventory item status", async () => {
    mockDb.run.mockResolvedValue({ changes: 1 });

    const success = await inventoryService.updateInventoryItemStatus(
      1,
      "Markdown 1",
    );

    expect(success).toBe(true);
    expect(getDb).toHaveBeenCalledTimes(1);
    expect(mockDb.run).toHaveBeenCalledWith(
      "UPDATE inventory_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      "Markdown 1",
      1,
    );
  });

  it("should return false if no item was updated", async () => {
    mockDb.run.mockResolvedValue({ changes: 0 });

    const success = await inventoryService.updateInventoryItemStatus(
      999,
      "Expired",
    );

    expect(success).toBe(false);
    expect(getDb).toHaveBeenCalledTimes(1);
    expect(mockDb.run).toHaveBeenCalledWith(
      "UPDATE inventory_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      "Expired",
      999,
    );
  });
});
