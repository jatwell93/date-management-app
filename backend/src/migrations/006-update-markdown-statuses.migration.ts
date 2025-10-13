import { getDb } from '../database';
import { InventoryService } from '../services/inventory.service';

export class UpdateMarkdownStatusesMigration {
  static async up() {
    console.log('Running update markdown statuses migration...');
    const db = getDb();
    const inventoryService = new InventoryService();

    const inventoryItems = db.prepare('SELECT * FROM inventory_items').all();

    let updatedCount = 0;
    for (const item of inventoryItems) {
      try {
        const newStatus = await inventoryService.calculateMarkdownStatus(item.expiry_date);
        if (newStatus) {
          db.prepare('UPDATE inventory_items SET status = ? WHERE id = ?').run(newStatus, item.id);
          updatedCount++;
        }
      } catch (error) {
        console.error(`Error updating markdown status for item ${item.id}:`, error);
      }
    }
    console.log(`Updated markdown statuses for ${updatedCount} inventory items.`);
  }

  static async down() {
    // This migration is not easily reversible as it changes data based on calculations.
    // A rollback would require storing the original statuses before updating.
    console.log('Rollback for update markdown statuses migration is not implemented.');
  }
}
