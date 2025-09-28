"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const inventory_service_1 = require("../services/inventory.service");
const database_1 = require("../database");
// Mock the database module
jest.mock("../database", () => ({
    getDb: jest.fn(),
}));
describe("InventoryService", () => {
    let inventoryService;
    let mockDb;
    beforeEach(() => {
        inventoryService = new inventory_service_1.InventoryService();
        mockDb = {
            run: jest.fn(),
        };
        database_1.getDb.mockResolvedValue(mockDb);
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    it("should create a new inventory item", async () => {
        const newItemData = {
            product_id: 1,
            expiry_date: "2025-12-31",
            location_id: 1,
            status: "Normal",
        };
        mockDb.run.mockResolvedValue({ lastID: 1 });
        const createdItem = await inventoryService.createInventoryItem(newItemData);
        expect(createdItem).toEqual(expect.objectContaining({
            id: 1,
            ...newItemData,
        }));
        expect(database_1.getDb).toHaveBeenCalledTimes(1);
        expect(mockDb.run).toHaveBeenCalledWith("INSERT INTO inventory_items (product_id, expiry_date, location_id, status) VALUES (?, ?, ?, ?)", newItemData.product_id, newItemData.expiry_date, newItemData.location_id, newItemData.status);
    });
    it("should update an inventory item status", async () => {
        mockDb.run.mockResolvedValue({ changes: 1 });
        const success = await inventoryService.updateInventoryItemStatus(1, "Markdown 1");
        expect(success).toBe(true);
        expect(database_1.getDb).toHaveBeenCalledTimes(1);
        expect(mockDb.run).toHaveBeenCalledWith("UPDATE inventory_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", "Markdown 1", 1);
    });
    it("should return false if no item was updated", async () => {
        mockDb.run.mockResolvedValue({ changes: 0 });
        const success = await inventoryService.updateInventoryItemStatus(999, "Expired");
        expect(success).toBe(false);
        expect(database_1.getDb).toHaveBeenCalledTimes(1);
        expect(mockDb.run).toHaveBeenCalledWith("UPDATE inventory_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", "Expired", 999);
    });
});
