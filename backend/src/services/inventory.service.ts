import { getDb } from "../database";
import { InventoryItem } from "../models/inventory-item.model";

export class InventoryService {
  async getAllInventoryItems(): Promise<InventoryItem[]> {
    const db = await getDb();
    return db.all("SELECT * FROM inventory_items");
  }

  async getInventoryItemById(id: number): Promise<InventoryItem | null> {
    const db = await getDb();
    const item: InventoryItem | undefined = await db.get(
      "SELECT * FROM inventory_items WHERE id = ?",
      id,
    );
    return item || null;
  }

  async getInventoryItemsByProductId(
    productId: number,
  ): Promise<InventoryItem[]> {
    const db = await getDb();
    return db.all(
      "SELECT * FROM inventory_items WHERE product_id = ? ORDER BY expiry_date",
      productId,
    );
  }

  async getInventoryItemsByLocationId(
    locationId: number,
  ): Promise<InventoryItem[]> {
    const db = await getDb();
    return db.all(
      "SELECT * FROM inventory_items WHERE location_id = ? ORDER BY expiry_date",
      locationId,
    );
  }

  async createInventoryItem(
    item: Omit<InventoryItem, "id" | "createdAt" | "updatedAt">,
  ): Promise<InventoryItem> {
    const db = await getDb();
    const result = await db.run(
      "INSERT INTO inventory_items (product_id, expiry_date, location_id, status) VALUES (?, ?, ?, ?)",
      item.productId,
      item.expiryDate,
      item.locationId,
      item.status || "Normal",
    );
    const newInventoryItem: InventoryItem = {
      id: result.lastID!,
      ...item,
      createdAt: new Date().toISOString(), // SQLite handles this with DEFAULT CURRENT_TIMESTAMP
      updatedAt: new Date().toISOString(), // SQLite handles this with DEFAULT CURRENT_TIMESTAMP
    };

    // Log the creation event
    // Note: In a real application, we'd have userId from auth middleware
    // For now, we're omitting logging during creation for simplicity

    return newInventoryItem;
  }

  async updateInventoryItem(
    id: number,
    item: Partial<Omit<InventoryItem, "id" | "createdAt" | "updatedAt">>,
  ): Promise<InventoryItem | null> {
    const db = await getDb();
    const fields = Object.keys(item);

    if (fields.length === 0) {
      return null;
    }

    const setClause = fields.map((field) => `${field} = ?`).join(", ");
    const values = [...Object.values(item), id];

    const result = await db.run(
      `UPDATE inventory_items SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ...values,
    );

    if (result.changes === 0) {
      return null;
    }

    // Return the updated item
    const updatedItem = await this.getInventoryItemById(id);
    return updatedItem;
  }

  async deleteInventoryItem(id: number): Promise<boolean> {
    const db = await getDb();
    const result = await db.run("DELETE FROM inventory_items WHERE id = ?", id);
    return result.changes > 0;
  }

  async updateInventoryItemStatus(
    itemId: number,
    status: string,
  ): Promise<boolean> {
    const db = await getDb();
    const result = await db.run(
      "UPDATE inventory_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      status,
      itemId,
    );
    return (result.changes ?? 0) > 0;
  }

  /**
   * Automatically calculate and update inventory item status based on expiry date
   * FR-003: Implement logic for automated markdown calculations
   */
  async autoCalculateMarkdownStatus(
    itemId: number,
    expiryDate: string,
  ): Promise<string | null> {
    const db = await getDb();

    // Convert expiry date to JavaScript date object
    const expiry = new Date(expiryDate);
    const today = new Date();

    // Normalize dates to compare just the date part (not time)
    today.setHours(0, 0, 0, 0);
    expiry.setHours(0, 0, 0, 0);

    // Calculate days difference
    const timeDiff = expiry.getTime() - today.getTime();
    const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

    let status: string;

    // Apply markdown rules based on days difference
    if (daysDiff < 0) {
      status = "Expired";
    } else if (daysDiff <= 30) {
      status = "Markdown 3";
    } else if (daysDiff <= 60) {
      status = "Markdown 2";
    } else if (daysDiff <= 90) {
      status = "Markdown 1";
    } else {
      status = "Normal";
    }

    // Update the inventory item with calculated status
    const result = await db.run(
      "UPDATE inventory_items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      status,
      itemId,
    );

    if (result.changes > 0) {
      return status;
    }

    return null;
  }
}
