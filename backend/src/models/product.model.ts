/**
 * Product data model
 * Represents a unique product in the inventory system
 */

import { Database } from "sqlite";

export interface Product {
  id: number;
  barcode: string;
  sku: string;
  name: string;
  costPrice: number;
  createdAt: string;
  updatedAt: string;
}

export class ProductModel {
  private db: Database; // In a real implementation, this would be a proper database connection

  constructor(dbConnection: Database) {
    this.db = dbConnection;
  }

  /**
   * Creates the products table in the database
   */
  async createTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        barcode TEXT UNIQUE NOT NULL,
        sku TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        cost_price REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await this.db.run(query);
  }

  /**
   * Creates a new product
   */
  async create(
    productData: Omit<Product, "id" | "createdAt" | "updatedAt">,
  ): Promise<Product> {
    const { barcode, sku, name, costPrice } = productData;
    const query = `
      INSERT INTO products (barcode, sku, name, cost_price)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `;

    const result = await this.db.get(query, [barcode, sku, name, costPrice]);
    return {
      id: result.id,
      barcode: result.barcode,
      sku: result.sku,
      name: result.name,
      costPrice: result.cost_price,
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    };
  }

  /**
   * Finds a product by its barcode
   */
  async findByBarcode(barcode: string): Promise<Product | null> {
    const query = "SELECT * FROM products WHERE barcode = ?";
    const result = await this.db.get(query, [barcode]);

    if (!result) return null;

    return {
      id: result.id,
      barcode: result.barcode,
      sku: result.sku,
      name: result.name,
      costPrice: result.cost_price,
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    };
  }

  /**
   * Finds a product by its ID
   */
  async findById(id: number): Promise<Product | null> {
    const query = "SELECT * FROM products WHERE id = ?";
    const result = await this.db.get(query, [id]);

    if (!result) return null;

    return {
      id: result.id,
      barcode: result.barcode,
      sku: result.sku,
      name: result.name,
      costPrice: result.cost_price,
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    };
  }

  /**
   * Updates a product
   */
  async update(
    id: number,
    updateData: Partial<Omit<Product, "id" | "createdAt" | "updatedAt">>,
  ): Promise<Product | null> {
    const fields = Object.keys(updateData);
    if (fields.length === 0) return null;

    const setClause = fields.map((field) => `${field} = ?`).join(", ");
    const values = [...Object.values(updateData), id];

    const query = `UPDATE products SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *`;
    const result = await this.db.get(query, values);

    if (!result) return null;

    return {
      id: result.id,
      barcode: result.barcode,
      sku: result.sku,
      name: result.name,
      costPrice: result.cost_price,
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    };
  }

  /**
   * Deletes a product
   */
  async delete(id: number): Promise<boolean> {
    const query = "DELETE FROM products WHERE id = ?";
    const result = await this.db.run(query, [id]);
    return result.changes > 0;
  }
}
