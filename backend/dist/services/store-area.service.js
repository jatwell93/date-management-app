"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StoreAreaService = void 0;
const database_1 = require("../database");
class StoreAreaService {
    getAllStoreAreas() {
        const db = (0, database_1.getDb)();
        try {
            const results = db.prepare("SELECT * FROM store_areas ORDER BY name").all();
            return results.map((result) => ({
                id: result.id,
                name: result.name,
                subDepartment: result.sub_department,
                lastChecked: result.last_checked,
                createdAt: result.created_at,
                updatedAt: result.updated_at,
            }));
        }
        finally {
            (0, database_1.releaseDb)(db);
        }
    }
    getStoreAreaById(id) {
        const db = (0, database_1.getDb)();
        try {
            const result = db.prepare("SELECT * FROM store_areas WHERE id = ?").get(id);
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
        finally {
            (0, database_1.releaseDb)(db);
        }
    }
    getStoreAreaByName(name) {
        const db = (0, database_1.getDb)();
        try {
            const results = db.prepare("SELECT * FROM store_areas WHERE name = ?").all(name);
            return results.map((result) => ({
                id: result.id,
                name: result.name,
                subDepartment: result.sub_department,
                lastChecked: result.last_checked,
                createdAt: result.created_at,
                updatedAt: result.updated_at,
            }));
        }
        finally {
            (0, database_1.releaseDb)(db);
        }
    }
    getStoreAreaByNameAndSubDepartment(name, subDepartment) {
        const db = (0, database_1.getDb)();
        try {
            // Properly handle NULL comparisons in SQLite
            const result = db.prepare("SELECT * FROM store_areas WHERE name = ? AND ((sub_department IS NULL AND ? IS NULL) OR (sub_department = ?))").get(name, subDepartment, subDepartment);
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
        finally {
            (0, database_1.releaseDb)(db);
        }
    }
    createStoreArea(area) {
        // Check if a store area with the same name and subDepartment already exists
        const existingArea = this.getStoreAreaByNameAndSubDepartment(area.name, area.subDepartment || null);
        if (existingArea) {
            throw new Error("A store area with this name and sub-department combination already exists");
        }
        const db = (0, database_1.getDb)();
        try {
            const result = db.prepare("INSERT INTO store_areas (name, sub_department, last_checked) VALUES (?, ?, ?)").run(area.name, area.subDepartment || null, area.lastChecked || null);
            const newArea = {
                id: result.lastInsertRowid,
                ...area,
                createdAt: new Date().toISOString(), // SQLite handles this with DEFAULT CURRENT_TIMESTAMP
                updatedAt: new Date().toISOString(), // SQLite handles this with DEFAULT CURRENT_TIMESTAMP
            };
            return newArea;
        }
        finally {
            (0, database_1.releaseDb)(db);
        }
    }
    updateStoreArea(id, area) {
        const db = (0, database_1.getDb)();
        try {
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
            const result = db.prepare(`UPDATE store_areas SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, id);
            if (result.changes === 0) {
                return null;
            }
            // Return the updated area
            const updatedArea = this.getStoreAreaById(id);
            return updatedArea;
        }
        finally {
            (0, database_1.releaseDb)(db);
        }
    }
    deleteStoreArea(id) {
        const db = (0, database_1.getDb)();
        try {
            const result = db.prepare("DELETE FROM store_areas WHERE id = ?").run(id);
            return (result.changes ?? 0) > 0;
        }
        finally {
            (0, database_1.releaseDb)(db);
        }
    }
}
exports.StoreAreaService = StoreAreaService;
