/**
 * Audit Log data model
 * Records changes made to inventory items for auditing purposes
 */

import { Database } from "sqlite";

export interface AuditLog {
  id: number;
  user_id: number;
  inventory_item_id: number;
  change_description: string;
  created_at: string;
}

export class AuditLogModel {
  private db: Database; // In a real implementation, this would be a proper database connection

  constructor(dbConnection: Database) {
    this.db = dbConnection;
  }

  /**
   * Creates the audit_log table in the database
   */
  async createTable(): Promise<void> {
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
  async logChange(
    userId: number,
    inventoryItemId: number,
    changeDescription: string,
  ): Promise<AuditLog> {
    const query = `
      INSERT INTO audit_log (user_id, inventory_item_id, change_description)
      VALUES (?, ?, ?)
      RETURNING *
    `;

    const result = await this.db.get(query, [
      userId,
      inventoryItemId,
      changeDescription,
    ]);
    return {
      id: result.id,
      user_id: result.user_id,
      inventory_item_id: result.inventory_item_id,
      change_description: result.change_description,
      created_at: result.created_at,
    };
  }
}
