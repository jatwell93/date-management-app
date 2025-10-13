"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const inventory_service_1 = require("../../services/inventory.service");
const database_1 = require("../../database");
describe("InventoryService", () => {
    let inventoryService;
    let mockDb;
    let mockStatement;
    beforeEach(() => {
        inventoryService = new inventory_service_1.InventoryService();
        mockStatement = {
            run: jest.fn(),
            get: jest.fn(),
            all: jest.fn(),
        };
        mockDb = {
            prepare: jest.fn(() => mockStatement),
        };
        database_1.getDb.mockReturnValue(mockDb);
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    it("should create a new inventory item", async () => {
        const newItemData = {
            productId: 1,
            expiryDate: "2025-12-31",
            locationId: 1,
            status: "Normal",
        };
        mockDb.prepare.mockReturnValue(mockStatement);
        mockStatement.run.mockReturnValue({ lastID: 1 });
        const createdItem = await inventoryService.createInventoryItem(newItemData);
        expect(createdItem).toEqual(expect.objectContaining({
            id: 1,
            ...newItemData,
        }));
        expect(database_1.getDb).toHaveBeenCalledTimes(1);
        expect(mockDb.prepare).toHaveBeenCalledWith("INSERT INTO inventory_items (product_id, expiry_date, location_id, status) VALUES (?, ?, ?, ?)");
        expect(mockStatement.run).toHaveBeenCalledWith(newItemData.productId, newItemData.expiryDate, newItemData.locationId, newItemData.status);
    });
    it("should update an inventory item status", async () => {
        mockDb.prepare.mockReturnValue(mockStatement);
        mockStatement.run.mockReturnValue({ changes: 1 });
        const success = await inventoryService.updateInventoryItemStatus(1, "Markdown 1");
        expect(success).toBe(true);
        expect(database_1.getDb).toHaveBeenCalledTimes(1);
        expect(mockDb.prepare).toHaveBeenCalledWith("UPDATE inventory_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
        expect(mockStatement.run).toHaveBeenCalledWith("Markdown 1", 1);
    });
    it("should return false if no item was updated", async () => {
        mockDb.prepare.mockReturnValue(mockStatement);
        mockStatement.run.mockReturnValue({ changes: 0 });
        const success = await inventoryService.updateInventoryItemStatus(999, "Expired");
        expect(success).toBe(false);
        expect(database_1.getDb).toHaveBeenCalledTimes(1);
        expect(mockDb.prepare).toHaveBeenCalledWith("UPDATE inventory_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
        expect(mockStatement.run).toHaveBeenCalledWith("Expired", 999);
    });
    describe("calculateMarkdownStatusSync", () => {
        it('should return "Expired" for dates in the past', () => {
            const date = new Date();
            date.setDate(date.getDate() - 1);
            const expiryDate = date.toISOString().split("T")[0];
            expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe("Expired");
        });
        it('should return "Markdown 3" for dates within the next 7 days', () => {
            const date = new Date();
            date.setDate(date.getDate() + 7);
            const expiryDate = date.toISOString().split("T")[0];
            expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe("Markdown 3");
        });
        it("should return 'Markdown 2' for dates between 8 and 14 days from now", () => {
            const date = new Date();
            date.setDate(date.getDate() + 14);
            const expiryDate = date.toISOString().split("T")[0];
            expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe("Markdown 2");
        });
        it("should return 'Markdown 1' for dates between 15 and 30 days from now", () => {
            const date = new Date();
            date.setDate(date.getDate() + 30);
            const expiryDate = date.toISOString().split("T")[0];
            expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe("Markdown 1");
        });
        it('should return "Normal" for dates more than 30 days from now', () => {
            const date = new Date();
            date.setDate(date.getDate() + 31);
            const expiryDate = date.toISOString().split("T")[0];
            expect(inventoryService.calculateMarkdownStatusSync(expiryDate)).toBe("Normal");
        });
    });
});
