"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryService = void 0;
const database_1 = require("../database");
class InventoryService {
    async getAllInventoryItems() {
        const db = await (0, database_1.getDb)();
        return db.all("SELECT * FROM inventory_items");
    }
    async getInventoryItemById(id) {
        const db = await (0, database_1.getDb)();
        const item = await db.get("SELECT * FROM inventory_items WHERE id = ?", id);
        return item || null;
    }
    async getInventoryItemsByProductId(productId) {
        const db = await (0, database_1.getDb)();
        return db.all("SELECT * FROM inventory_items WHERE product_id = ? ORDER BY expiry_date", productId);
    }
    async getInventoryItemsByLocationId(locationId) {
        const db = await (0, database_1.getDb)();
        return db.all("SELECT * FROM inventory_items WHERE location_id = ? ORDER BY expiry_date", locationId);
    }
    async createInventoryItem(item) {
        const db = await (0, database_1.getDb)();
        // First check if the location exists in store_areas table
        const locationRecord = await db.get("SELECT id, sub_department FROM store_areas WHERE id = ?", item.locationId);
        if (!locationRecord) {
            throw new Error("Location does not exist");
        }
        // We could implement additional logic here to verify sub-department
        // if needed, but for now just ensure the location exists
        const result = await db.run("INSERT INTO inventory_items (product_id, expiry_date, location_id, status) VALUES (?, ?, ?, ?)", item.productId, item.expiryDate, item.locationId, item.status || "Normal");
        const newInventoryItem = {
            id: result.lastID,
            ...item,
            createdAt: new Date().toISOString(), // SQLite handles this with DEFAULT CURRENT_TIMESTAMP
            updatedAt: new Date().toISOString(), // SQLite handles this with DEFAULT CURRENT_TIMESTAMP
        };
        // Log the creation event
        // Note: In a real application, we'd have userId from auth middleware
        // For now, we're omitting logging during creation for simplicity
        return newInventoryItem;
    }
    async updateInventoryItem(id, item) {
        const db = await (0, database_1.getDb)();
        const fields = Object.keys(item);
        if (fields.length === 0) {
            return null;
        }
        const setClause = fields.map((field) => `${field} = ?`).join(", ");
        const values = [...Object.values(item), id];
        const result = await db.run(`UPDATE inventory_items SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, ...values);
        if (result.changes === 0) {
            return null;
        }
        // Return the updated item
        const updatedItem = await this.getInventoryItemById(id);
        return updatedItem;
    }
    async deleteInventoryItem(id) {
        const db = await (0, database_1.getDb)();
        const result = await db.run("DELETE FROM inventory_items WHERE id = ?", id);
        return (result.changes ?? 0) > 0;
    }
    async updateInventoryItemStatus(itemId, status) {
        const db = await (0, database_1.getDb)();
        const result = await db.run("UPDATE inventory_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", status, itemId);
        return (result.changes ?? 0) > 0;
    }
    /**
     * Automatically calculate and update inventory item status based on expiry date
     * FR-003: Implement logic for automated markdown calculations
     */
    async autoCalculateMarkdownStatus(itemId, expiryDate) {
        const db = await (0, database_1.getDb)();
        // Convert expiry date to JavaScript date object
        const expiry = new Date(expiryDate);
        const today = new Date();
        // Normalize dates to compare just the date part (not time)
        today.setHours(0, 0, 0, 0);
        expiry.setHours(0, 0, 0, 0);
        // Calculate days difference
        const timeDiff = expiry.getTime() - today.getTime();
        const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
        let status;
        // Apply markdown rules based on days difference
        if (daysDiff < 0) {
            status = "Expired";
        }
        else if (daysDiff <= 30) {
            status = "Markdown 3";
        }
        else if (daysDiff <= 60) {
            status = "Markdown 2";
        }
        else if (daysDiff <= 90) {
            status = "Markdown 1";
        }
        else {
            status = "Normal";
        }
        // Update the inventory item with calculated status
        const result = await db.run("UPDATE inventory_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", status, itemId);
        if ((result.changes ?? 0) > 0) {
            return status;
        }
        return null;
    }
}
exports.InventoryService = InventoryService;
