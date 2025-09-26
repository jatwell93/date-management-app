/**
 * Inventory Item data model
 * Represents a specific instance of a product in the inventory with expiry date and location
 */

import { Database } from "sqlite";

export interface InventoryItem {
  id: number;
  productId: number;
  expiryDate: string;
  locationId: number;
  status: "Normal" | "Markdown 1" | "Markdown 2" | "Markdown 3" | "Expired";
  createdAt: string;
  updatedAt: string;
}

export class InventoryItemModel {
  private db: Database; // In a real implementation, this would be a proper database connection

  constructor(dbConnection: Database) {
    this.db = dbConnection;
  }

  /**
   * Creates the inventory_items table in the database
   */
  async createTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS inventory_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        expiry_date TEXT NOT NULL,
        location_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'Normal',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id),
        FOREIGN KEY (location_id) REFERENCES store_areas(id)
      )
    `;

    await this.db.run(query);
  }

  /**
   * Creates a new inventory item
   */
  async create(
    inventoryData: Omit<InventoryItem, "id" | "createdAt" | "updatedAt">,
  ): Promise<InventoryItem> {
    const { productId, expiryDate, locationId, status } = inventoryData;
    const query = `
      INSERT INTO inventory_items (product_id, expiry_date, location_id, status)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `;

    const result = await this.db.get(query, [
      productId,
      expiryDate,
      locationId,
      status,
    ]);
    return {
      id: result.id,
      productId: result.product_id,
      expiryDate: result.expiry_date,
      locationId: result.location_id,
      status: result.status as
        | "Normal"
        | "Markdown 1"
        | "Markdown 2"
        | "Markdown 3"
        | "Expired",
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    };
  }

  /**
   * Finds an inventory item by its ID
   */
  async findById(id: number): Promise<InventoryItem | null> {
    const query = "SELECT * FROM inventory_items WHERE id = ?";
    const result = await this.db.get(query, [id]);

    if (!result) return null;

    return {
      id: result.id,
      productId: result.product_id,
      expiryDate: result.expiry_date,
      locationId: result.location_id,
      status: result.status as
        | "Normal"
        | "Markdown 1"
        | "Markdown 2"
        | "Markdown 3"
        | "Expired",
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    };
  }

  /**
   * Finds inventory items by product ID
   */
  async findByProductId(productId: number): Promise<InventoryItem[]> {
    const query =
      "SELECT * FROM inventory_items WHERE product_id = ? ORDER BY expiry_date";
    const results = await this.db.all(query, [productId]);

    return results.map((result) => ({
      id: result.id,
      productId: result.product_id,
      expiryDate: result.expiry_date,
      locationId: result.location_id,
      status: result.status as
        | "Normal"
        | "Markdown 1"
        | "Markdown 2"
        | "Markdown 3"
        | "Expired",
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    }));
  }

  /**
   * Finds inventory items by location ID
   */
  async findByLocationId(locationId: number): Promise<InventoryItem[]> {
    const query =
      "SELECT * FROM inventory_items WHERE location_id = ? ORDER BY expiry_date";
    const results = await this.db.all(query, [locationId]);

    return results.map((result) => ({
      id: result.id,
      productId: result.product_id,
      expiryDate: result.expiry_date,
      locationId: result.location_id,
      status: result.status as
        | "Normal"
        | "Markdown 1"
        | "Markdown 2"
        | "Markdown 3"
        | "Expired",
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    }));
  }

  /**
   * Updates an inventory item
   */
  async update(
    id: number,
    updateData: Partial<Omit<InventoryItem, "id" | "createdAt" | "updatedAt">>,
  ): Promise<InventoryItem | null> {
    const fields = Object.keys(updateData);
    if (fields.length === 0) return null;

    const setClause = fields.map((field) => `${field} = ?`).join(", ");
    const values = [...Object.values(updateData), id];

    const query = `UPDATE inventory_items SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *`;
    const result = await this.db.get(query, values);

    if (!result) return null;

    return {
      id: result.id,
      productId: result.product_id,
      expiryDate: result.expiry_date,
      locationId: result.location_id,
      status: result.status as
        | "Normal"
        | "Markdown 1"
        | "Markdown 2"
        | "Markdown 3"
        | "Expired",
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    };
  }

  /**
   * Deletes an inventory item
   */
  async delete(id: number): Promise<boolean> {
    const query = "DELETE FROM inventory_items WHERE id = ?";
    const result = await this.db.run(query, [id]);
    return result.changes > 0;
  }
}
