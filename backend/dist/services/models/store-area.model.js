"use strict";
/**
 * Store Area data model
 * Represents a physical location in the store where inventory is tracked
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.StoreAreaModel = void 0;
class StoreAreaModel {
    constructor(dbConnection) {
        this.db = dbConnection;
    }
    /**
     * Creates the store_areas table in the database
     */
    async createTable() {
        const query = `
      CREATE TABLE IF NOT EXISTS store_areas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        sub_department TEXT, -- New column
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
    async create(storeAreaData) {
        const { name, subDepartment, lastChecked } = storeAreaData;
        const query = `
      INSERT INTO store_areas (name, sub_department, last_checked)
      VALUES (?, ?, ?)
      RETURNING *
    `;
        const result = await this.db.get(query, [name, subDepartment || null, lastChecked || null]);
        return {
            id: result.id,
            name: result.name,
            subDepartment: result.sub_department,
            lastChecked: result.last_checked,
            createdAt: result.created_at,
            updatedAt: result.updated_at,
        };
    }
    /**
     * Finds a store area by its ID
     */
    async findById(id) {
        const query = "SELECT * FROM store_areas WHERE id = ?";
        const result = await this.db.get(query, [id]);
        if (!result)
            return null;
        return {
            id: result.id,
            name: result.name,
            subDepartment: result.sub_department,
            lastChecked: result.last_checked,
            createdAt: result.created_at,
            updatedAt: result.updated_at,
        };
    }
    /**
     * Finds a store area by its name
     */
    async findByName(name) {
        const query = "SELECT * FROM store_areas WHERE name = ?";
        const result = await this.db.get(query, [name]);
        if (!result)
            return null;
        return {
            id: result.id,
            name: result.name,
            subDepartment: result.sub_department,
            lastChecked: result.last_checked,
            createdAt: result.created_at,
            updatedAt: result.updated_at,
        };
    }
    /**
     * Gets all store areas
     */
    async findAll() {
        const query = "SELECT * FROM store_areas ORDER BY name";
        const results = await this.db.all(query);
        return results.map((result) => ({
            id: result.id,
            name: result.name,
            subDepartment: result.sub_department,
            lastChecked: result.last_checked,
            createdAt: result.created_at,
            updatedAt: result.updated_at,
        }));
    }
    /**
     * Updates a store area
     */
    async update(id, updateData) {
        const fields = Object.keys(updateData);
        if (fields.length === 0)
            return null;
        const setClause = fields.map((field) => {
            if (field === "subDepartment")
                return "sub_department = ?";
            return `${field} = ?`;
        }).join(", ");
        const values = Object.entries(updateData).map(([key, value]) => {
            if (key === "subDepartment")
                return value || null;
            return value;
        });
        const query = `UPDATE store_areas SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *`;
        const result = await this.db.get(query, [...values, id]);
        if (!result)
            return null;
        return {
            id: result.id,
            name: result.name,
            subDepartment: result.sub_department,
            lastChecked: result.last_checked,
            createdAt: result.created_at,
            updatedAt: result.updated_at,
        };
    }
    /**
     * Deletes a store area
     */
    async delete(id) {
        const query = "DELETE FROM store_areas WHERE id = ?";
        const result = await this.db.run(query, [id]);
        return result.changes != null && result.changes > 0;
    }
}
exports.StoreAreaModel = StoreAreaModel;
