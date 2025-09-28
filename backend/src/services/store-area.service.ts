import { getDb } from "../database";
import { StoreArea } from "../models/store-area.model";

export class StoreAreaService {
  async getAllStoreAreas(): Promise<StoreArea[]> {
    const db = await getDb();
    const results = await db.all("SELECT * FROM store_areas ORDER BY name");
    return results.map((result: any) => ({
      id: result.id,
      name: result.name,
      subDepartment: result.sub_department,
      lastChecked: result.last_checked,
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    }));
  }

  async getStoreAreaById(id: number): Promise<StoreArea | null> {
    const db = await getDb();
    const result: any = await db.get(
      "SELECT * FROM store_areas WHERE id = ?",
      id,
    );
    if (!result) return null;
    
    return {
      id: result.id,
      name: result.name,
      subDepartment: result.sub_department,
      lastChecked: result.last_checked,
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    };
  }

  async getStoreAreaByName(name: string): Promise<StoreArea[]> {
    const db = await getDb();
    const results: any[] = await db.all(
      "SELECT * FROM store_areas WHERE name = ?",
      name,
    );
    
    return results.map((result) => ({
      id: result.id,
      name: result.name,
      subDepartment: result.sub_department,
      lastChecked: result.last_checked,
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    }));
  }
  
  async getStoreAreaByNameAndSubDepartment(name: string, subDepartment: string | null): Promise<StoreArea | null> {
    const db = await getDb();
    // Properly handle NULL comparisons in SQLite
    const result: any = await db.get(
      "SELECT * FROM store_areas WHERE name = ? AND ((sub_department IS NULL AND ? IS NULL) OR (sub_department = ?))",
      name,
      subDepartment,
      subDepartment
    );
    if (!result) return null;
    
    return {
      id: result.id,
      name: result.name,
      subDepartment: result.sub_department,
      lastChecked: result.last_checked,
      createdAt: result.created_at,
      updatedAt: result.updated_at,
    };
  }

  async createStoreArea(
    area: Omit<StoreArea, "id" | "createdAt" | "updatedAt">,
  ): Promise<StoreArea> {
    // Check if a store area with the same name and subDepartment already exists
    const existingArea = await this.getStoreAreaByNameAndSubDepartment(area.name, area.subDepartment || null);
    if (existingArea) {
      throw new Error("A store area with this name and sub-department combination already exists");
    }

    const db = await getDb();
    const result = await db.run(
      "INSERT INTO store_areas (name, sub_department, last_checked) VALUES (?, ?, ?)",
      area.name,
      area.subDepartment || null,
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

    const setClause = fields.map((field) => {
      if (field === "subDepartment") return "sub_department = ?";
      return `${field} = ?`;
    }).join(", ");

    const values = Object.entries(area).map(([key, value]) => {
      if (key === "subDepartment") return value || null;
      return value;
    });

    const result = await db.run(
      `UPDATE store_areas SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      ...values,
      id,
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
    return (result.changes ?? 0) > 0;
  }
}
