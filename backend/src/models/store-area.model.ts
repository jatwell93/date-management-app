/**
 * Store Area data model
 * Represents a physical location in the store where inventory is tracked
 */

import { Database } from "sqlite";

export interface StoreArea {
  id: number;
  name: string;
  lastChecked?: string;
  createdAt: string;
  updatedAt: string;
}

export class StoreAreaModel {
  private db: Database; // In a real implementation, this would be a proper database connection

  constructor(dbConnection: Database) {
    this.db = dbConnection;
  }

  /**
   * Creates the store_areas table in the database
   */
  async createTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS store_areas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        last_checked TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `;

    await this.db.run(query);
  }

  /**
   * Creates a new store area
   */
  async create(
    storeAreaData: Omit<StoreArea, "id" | "createdAt" | "updatedAt">,
  ): Promise<StoreArea> {
    const { name, lastChecked } = storeAreaData;
    const query = `
      INSERT INTO store_areas (name, last_checked)
      VALUES (?, ?)
      RETURNING *
    `;

    const result = await this.db.get(query, [name, lastChecked || null]);
    return {
      id: result.id,
      name: result.name,
      lastChecked: result.last_checked,
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    };
  }

  /**
   * Finds a store area by its ID
   */
  async findById(id: number): Promise<StoreArea | null> {
    const query = "SELECT * FROM store_areas WHERE id = ?";
    const result = await this.db.get(query, [id]);

    if (!result) return null;

    return {
      id: result.id,
      name: result.name,
      lastChecked: result.last_checked,
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    };
  }

  /**
   * Finds a store area by its name
   */
  async findByName(name: string): Promise<StoreArea | null> {
    const query = "SELECT * FROM store_areas WHERE name = ?";
    const result = await this.db.get(query, [name]);

    if (!result) return null;

    return {
      id: result.id,
      name: result.name,
      lastChecked: result.last_checked,
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    };
  }

  /**
   * Gets all store areas
   */
  async findAll(): Promise<StoreArea[]> {
    const query = "SELECT * FROM store_areas ORDER BY name";
    const results = await this.db.all(query);

    return results.map((result) => ({
      id: result.id,
      name: result.name,
      lastChecked: result.last_checked,
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    }));
  }

  /**
   * Updates a store area
   */
  async update(
    id: number,
    updateData: Partial<Omit<StoreArea, "id" | "createdAt" | "updatedAt">>,
  ): Promise<StoreArea | null> {
    const fields = Object.keys(updateData);
    if (fields.length === 0) return null;

    const setClause = fields.map((field) => `${field} = ?`).join(", ");
    const values = [...Object.values(updateData), id];

    const query = `UPDATE store_areas SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *`;
    const result = await this.db.get(query, values);

    if (!result) return null;

    return {
      id: result.id,
      name: result.name,
      lastChecked: result.last_checked,
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    };
  }

  /**
   * Deletes a store area
   */
  async delete(id: number): Promise<boolean> {
    const query = "DELETE FROM store_areas WHERE id = ?";
    const result = await this.db.run(query, [id]);
    return result.changes > 0;
  }
}
