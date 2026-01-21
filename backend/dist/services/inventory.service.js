"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InventoryService = void 0;
const database_1 = require("../database");
const product_service_1 = require("./product.service");
const store_area_service_1 = require("./store-area.service");
const db = (0, database_1.getDb)();
class InventoryService {
    constructor() {
        this.productService = new product_service_1.ProductService();
        this.storeAreaService = new store_area_service_1.StoreAreaService();
    }
    /**
     * Get all inventory items
     */
    async getAllInventoryItems() {
        return db.prepare("SELECT * FROM inventory_items").all();
    }
    /**
     * Get an inventory item by its ID
     */
    async getInventoryItemById(id) {
        const item = db
            .prepare("SELECT * FROM inventory_items WHERE id = ?")
            .get(id);
        return item || null;
    }
    /**
     * Get all inventory items for a specific product
     */
    async getInventoryItemsByProductId(productId) {
        return db
            .prepare("SELECT * FROM inventory_items WHERE product_id = ?")
            .all(productId);
    }
    /**
     * Get recent inventory items for a specific product
     */
    async getRecentInventoryItemsByProductId(productId, limit) {
        return db
            .prepare("SELECT * FROM inventory_items WHERE product_id = ? ORDER BY created_at DESC LIMIT ?")
            .all(productId, limit);
    }
    /**
     * Get all inventory items for a specific location
     */
    async getInventoryItemsByLocationId(locationId) {
        return db
            .prepare("SELECT * FROM inventory_items WHERE location_id = ?")
            .all(locationId);
    }
    /**
     * Create a new inventory item
     */
    async createInventoryItem(item, userId) {
        const { productId, expiryDate, locationId } = item;
        // Calculate markdown status
        const calculatedStatus = item.status || await this.calculateMarkdownStatus(item.expiryDate);
        const result = db
            .prepare("INSERT INTO inventory_items (product_id, expiry_date, location_id, status) VALUES (?, ?, ?, ?)")
            .run(productId, expiryDate, locationId, calculatedStatus);
        const newItemId = result.lastInsertRowid;
        // Create audit log entry
        const changeDescription = `Inventory item created with expiry date ${expiryDate} and status ${calculatedStatus}.`;
        this.createAuditLog(userId, newItemId, changeDescription);
        return {
            id: newItemId,
            ...item,
            status: calculatedStatus,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
    }
    /**
     * Update an existing inventory item
     */
    async updateInventoryItem(id, updates, userId) {
        const existingItem = await this.getInventoryItemById(id);
        if (!existingItem) {
            return null;
        }
        // Build the update query dynamically
        const fields = Object.keys(updates);
        const values = Object.values(updates);
        const setClause = fields.map((field) => {
            let col = field;
            if (field === 'productId')
                col = 'product_id';
            else if (field === 'expiryDate')
                col = 'expiry_date';
            else if (field === 'locationId')
                col = 'location_id';
            else
                col = field;
            return `${col} = ?`;
        }).join(", ");
        if (fields.length === 0) {
            return existingItem; // No updates to perform
        }
        // If expiry date is updated, recalculate markdown status
        if (updates.expiryDate) {
            updates.status = await this.calculateMarkdownStatus(updates.expiryDate);
        }
        const stmt = db.prepare(`UPDATE inventory_items SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
        stmt.run(...values, id);
        // Create audit log entry
        const changeDescription = `Inventory item updated: ${JSON.stringify(updates)}`;
        this.createAuditLog(userId, id, changeDescription);
        return this.getInventoryItemById(id);
    }
    /**
     * Delete an inventory item
     */
    async deleteInventoryItem(id, userId) {
        // Get the item before deleting to use in audit log
        const item = await this.getInventoryItemById(id);
        if (!item) {
            return false; // Item doesn't exist
        }
        // Create audit log entry before deleting the item
        const changeDescription = `Inventory item with ID ${id} deleted.`;
        this.createAuditLog(userId, id, changeDescription);
        const result = db.prepare("DELETE FROM inventory_items WHERE id = ?").run(id);
        return result.changes > 0;
    }
    /**
     * Synchronous version of calculateMarkdownStatus for use in batch operations
     */
    calculateMarkdownStatusSync(expiryDate) {
        if (!expiryDate) {
            return "Normal";
        }
        const now = new Date();
        const expiry = new Date(expiryDate);
        const daysDiff = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff <= 0) {
            return "Expired";
        }
        // Apply markdown rules based on days difference (from feature requirements)
        // Note: These are simple examples. Real logic might be more complex.
        if (daysDiff <= 30) {
            // Within 1 month from expiry: cost price - 20% (Markdown 3)
            return "Markdown 3";
        }
        else if (daysDiff <= 60) {
            // Within 2 months from expiry: cost price (Markdown 2)
            return "Markdown 2";
        }
        else if (daysDiff <= 90) {
            // Within 3 months from expiry: cost price + 20% (Markdown 1)
            return "Markdown 1";
        }
        else {
            // More than 3 months from expiry: Normal (no markdown)
            return "Normal";
        }
    }
    /**
     * FR-003: Implement logic for automated markdown calculations
     */
    async autoCalculateMarkdownStatus(itemId, expiryDate) {
        const now = new Date();
        const expiry = new Date(expiryDate);
        const daysDiff = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        let status = "Normal";
        if (daysDiff <= 0) {
            status = "Expired";
        }
        else {
            // Apply markdown rules based on days difference (from feature requirements)
            // Note: These are simple examples. Real logic might be more complex.
            if (daysDiff <= 30) {
                // Within 1 month from expiry: cost price - 20% (Markdown 3)
                status = "Markdown 3";
            }
            else if (daysDiff <= 60) {
                // Within 2 months from expiry: cost price (Markdown 2)
                status = "Markdown 2";
            }
            else if (daysDiff <= 90) {
                // Within 3 months from expiry: cost price + 20% (Markdown 1)
                status = "Markdown 1";
            }
            else {
                // More than 3 months from expiry: Normal (no markdown)
                status = "Normal";
            }
        }
        // Update the inventory item's status in the database
        db.prepare("UPDATE inventory_items SET status = ? WHERE id = ?").run(status, itemId);
    }
    /**
     * Calculate markdown status based on expiry date without updating the database
     */
    async calculateMarkdownStatus(expiryDate) {
        if (!expiryDate) {
            return "Normal";
        }
        const now = new Date();
        const expiry = new Date(expiryDate);
        const daysDiff = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff <= 0) {
            return "Expired";
        }
        // Apply markdown rules based on days difference (from feature requirements)
        // Note: These are simple examples. Real logic might be more complex.
        if (daysDiff <= 30) {
            // Within 1 month from expiry: cost price - 20% (Markdown 3)
            return "Markdown 3";
        }
        else if (daysDiff <= 60) {
            // Within 2 months from expiry: cost price (Markdown 2)
            return "Markdown 2";
        }
        else if (daysDiff <= 90) {
            // Within 3 months from expiry: cost price + 20% (Markdown 1)
            return "Markdown 1";
        }
        else {
            // More than 3 months from expiry: Normal (no markdown)
            return "Normal";
        }
    }
    /**
     * Create an audit log entry
     */
    createAuditLog(userId, inventoryItemId, changeDescription) {
        db.prepare("INSERT INTO audit_log (user_id, inventory_item_id, change_description) VALUES (?, ?, ?)").run(userId, inventoryItemId, changeDescription);
    }
    /**
     * Log an item transaction
     */
    async logTransaction(transaction) {
        const { inventory_item_id, user_id, type, quantity_change, notes } = transaction;
        const result = db.prepare("INSERT INTO item_transactions (inventory_item_id, user_id, type, quantity_change, notes) VALUES (?, ?, ?, ?, ?)").run(inventory_item_id, user_id, type, quantity_change, notes);
        return result.lastInsertRowid;
    }
}
exports.InventoryService = InventoryService;
