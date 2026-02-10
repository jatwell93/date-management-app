"use strict";
/**
 * Audit Log data model
 * Records changes made to inventory items for auditing purposes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditLogModel = void 0;
class AuditLogModel {
    constructor(dbConnection) {
        this.db = dbConnection;
    }
    /**
     * Creates the audit_log table in the database
     */
    async createTable() {
        const query = `
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        inventory_item_id INTEGER NOT NULL,
        change_description TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id)
      )
    `;
        await this.db.run(query);
    }
    /**
     * Logs a change to the audit log
     */
    async logChange(userId, inventoryItemId, changeDescription) {
        const query = `
      INSERT INTO audit_log (user_id, inventory_item_id, change_description)
      VALUES (?, ?, ?)
      RETURNING *
    `;
        const result = await this.db.get(query, [userId, inventoryItemId, changeDescription]);
        return {
            id: result.id,
            organizationId: result.organization_id,
            user_id: result.user_id,
            inventory_item_id: result.inventory_item_id,
            change_description: result.change_description,
            created_at: result.created_at,
        };
    }
}
exports.AuditLogModel = AuditLogModel;
