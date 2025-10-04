"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryService = void 0;
const database_1 = require("../database");
const audit_log_model_1 = require("../models/audit-log.model");
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
    async getRecentInventoryItemsByProductId(productId, limit = 5) {
        const db = await (0, database_1.getDb)();
        return db.all("SELECT * FROM inventory_items WHERE product_id = ? ORDER BY created_at DESC LIMIT ?", productId, limit);
    }
    async getInventoryItemsByLocationId(locationId) {
        const db = await (0, database_1.getDb)();
        return db.all("SELECT * FROM inventory_items WHERE location_id = ? ORDER BY expiry_date", locationId);
    }
    async createInventoryItem(item, userId) {
        const db = await (0, database_1.getDb)();
        // First check if the location exists in store_areas table
        const locationRecord = await db.get("SELECT id, sub_department FROM store_areas WHERE id = ?", item.locationId);
        if (!locationRecord) {
            throw new Error("Location does not exist");
        }
        // Calculate status based on expiry date if status is not provided
        const calculatedStatus = item.status || await this.calculateMarkdownStatus(item.expiryDate);
        const result = await db.run("INSERT INTO inventory_items (product_id, expiry_date, location_id, status) VALUES (?, ?, ?, ?)", item.productId, item.expiryDate, item.locationId, calculatedStatus);
        const newInventoryItem = {
            id: result.lastID,
            ...item,
            status: calculatedStatus,
            createdAt: new Date().toISOString(), // SQLite handles this with DEFAULT CURRENT_TIMESTAMP
            updatedAt: new Date().toISOString(), // SQLite handles this with DEFAULT CURRENT_TIMESTAMP
        };
        // Log the creation event if we have a userId
        if (userId) {
            const auditLogModel = new audit_log_model_1.AuditLogModel(db);
            await auditLogModel.logChange(userId, newInventoryItem.id, `Created inventory item with expiry date ${item.expiryDate}`);
        }
        return newInventoryItem;
    }
    async updateInventoryItem(id, item, userId) {
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
        // Log the update event if we have a userId
        if (userId && updatedItem) {
            const auditLogModel = new audit_log_model_1.AuditLogModel(db);
            const changeDescription = `Updated inventory item: ${Object.keys(item).join(', ')}`;
            await auditLogModel.logChange(userId, updatedItem.id, changeDescription);
        }
        return updatedItem;
    }
    async deleteInventoryItem(id, userId) {
        const db = await (0, database_1.getDb)();
        // First get the inventory item before deletion to use in audit log
        const item = await this.getInventoryItemById(id);
        const result = await db.run("DELETE FROM inventory_items WHERE id = ?", id);
        const success = (result.changes ?? 0) > 0;
        // Log the deletion event if we have a userId and the item existed
        if (success && userId && item) {
            const auditLogModel = new audit_log_model_1.AuditLogModel(db);
            await auditLogModel.logChange(userId, item.id, `Deleted inventory item with expiry date ${item.expiryDate}`);
        }
        return success;
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
    /**
     * Calculate markdown status based on expiry date without updating the database
     */
    async calculateMarkdownStatus(expiryDate) {
        // Convert expiry date to JavaScript date object
        const expiry = new Date(expiryDate);
        const today = new Date();
        // Normalize dates to compare just the date part (not time)
        today.setHours(0, 0, 0, 0);
        expiry.setHours(0, 0, 0, 0);
        // Calculate days difference
        const timeDiff = expiry.getTime() - today.getTime();
        const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
        // Apply markdown rules based on days difference
        if (daysDiff < 0) {
            return "Expired";
        }
        else if (daysDiff <= 30) {
            return "Markdown 3";
        }
        else if (daysDiff <= 60) {
            return "Markdown 2";
        }
        else if (daysDiff <= 90) {
            return "Markdown 1";
        }
        else {
            return "Normal";
        }
    }
}
exports.InventoryService = InventoryService;
