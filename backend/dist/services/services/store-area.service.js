"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StoreAreaService = void 0;
const database_1 = require("../database");
class StoreAreaService {
    async getAllStoreAreas() {
        const db = await (0, database_1.getDb)();
        const results = await db.all("SELECT * FROM store_areas ORDER BY name");
        return results.map((result) => ({
            id: result.id,
            name: result.name,
            subDepartment: result.sub_department,
            lastChecked: result.last_checked,
            createdAt: result.created_at,
            updatedAt: result.updated_at,
        }));
    }
    async getStoreAreaById(id) {
        const db = await (0, database_1.getDb)();
        const result = await db.get("SELECT * FROM store_areas WHERE id = ?", id);
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
    async getStoreAreaByName(name) {
        const db = await (0, database_1.getDb)();
        const result = await db.get("SELECT * FROM store_areas WHERE name = ?", name);
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
    async createStoreArea(area) {
        const db = await (0, database_1.getDb)();
        const result = await db.run("INSERT INTO store_areas (name, sub_department, last_checked) VALUES (?, ?, ?)", area.name, area.subDepartment || null, area.lastChecked || null);
        const newArea = {
            id: result.lastID,
            ...area,
            createdAt: new Date().toISOString(), // SQLite handles this with DEFAULT CURRENT_TIMESTAMP
            updatedAt: new Date().toISOString(), // SQLite handles this with DEFAULT CURRENT_TIMESTAMP
        };
        return newArea;
    }
    async updateStoreArea(id, area) {
        const db = await (0, database_1.getDb)();
        const fields = Object.keys(area);
        if (fields.length === 0) {
            return null;
        }
        const setClause = fields.map((field) => {
            if (field === "subDepartment")
                return "sub_department = ?";
            return `${field} = ?`;
        }).join(", ");
        const values = Object.entries(area).map(([key, value]) => {
            if (key === "subDepartment")
                return value || null;
            return value;
        });
        const result = await db.run(`UPDATE store_areas SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, ...values, id);
        if (result.changes === 0) {
            return null;
        }
        // Return the updated area
        const updatedArea = await this.getStoreAreaById(id);
        return updatedArea;
    }
    async deleteStoreArea(id) {
        const db = await (0, database_1.getDb)();
        const result = await db.run("DELETE FROM store_areas WHERE id = ?", id);
        return (result.changes ?? 0) > 0;
    }
}
exports.StoreAreaService = StoreAreaService;
