import { getDb } from "../database";
import { StoreArea } from "../models/store-area.model";

export class StoreAreaService {
  async getAllStoreAreas(): Promise<StoreArea[]> {
    const db = await getDb();
    return db.all("SELECT * FROM store_areas ORDER BY name");
  }

  async getStoreAreaById(id: number): Promise<StoreArea | null> {
    const db = await getDb();
    const area: StoreArea | undefined = await db.get(
      "SELECT * FROM store_areas WHERE id = ?",
      id,
    );
    return area || null;
  }

  async getStoreAreaByName(name: string): Promise<StoreArea | null> {
    const db = await getDb();
    const area: StoreArea | undefined = await db.get(
      "SELECT * FROM store_areas WHERE name = ?",
      name,
    );
    return area || null;
  }

  async createStoreArea(
    area: Omit<StoreArea, "id" | "createdAt" | "updatedAt">,
  ): Promise<StoreArea> {
    const db = await getDb();
    const result = await db.run(
      "INSERT INTO store_areas (name, last_checked) VALUES (?, ?)",
      area.name,
      area.lastChecked || null,
    );
    const newArea: StoreArea = {
      id: result.lastID!,
      ...area,
      createdAt: new Date().toISOString(), // SQLite handles this with DEFAULT CURRENT_TIMESTAMP
      updatedAt: new Date().toISOString(), // SQLite handles this with DEFAULT CURRENT_TIMESTAMP
    };
    return newArea;
  }

  async updateStoreArea(
    id: number,
    area: Partial<Omit<StoreArea, "id" | "createdAt" | "updatedAt">>,
  ): Promise<StoreArea | null> {
    const db = await getDb();
    const fields = Object.keys(area);

    if (fields.length === 0) {
      return null;
    }

    const setClause = fields.map((field) => `${field} = ?`).join(", ");
    const values = [...Object.values(area), id];

    const result = await db.run(
      `UPDATE store_areas SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ...values,
    );

    if (result.changes === 0) {
      return null;
    }

    // Return the updated area
    const updatedArea = await this.getStoreAreaById(id);
    return updatedArea;
  }

  async deleteStoreArea(id: number): Promise<boolean> {
    const db = await getDb();
    const result = await db.run("DELETE FROM store_areas WHERE id = ?", id);
    return result.changes > 0;
  }
}
