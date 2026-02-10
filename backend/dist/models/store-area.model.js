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
        // First, check if the table exists
        const tableExists = await this.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='store_areas'");
        if (tableExists) {
            // If table exists, check if it has the old structure with name being UNIQUE
            // We'll need to handle the table structure migration
            try {
                // Check if there's a unique constraint on the name column
                const indexes = await this.db.all("SELECT * FROM pragma_index_list('store_areas')");
                let hasUniqueNameConstraint = false;
                for (const index of indexes) {
                    if (index.unique === 1) {
                        // If it's a unique index
                        const indexInfo = await this.db.all(`SELECT * FROM pragma_index_info('${index.name}')`);
                        if (indexInfo.some((col) => col.name === 'name')) {
                            hasUniqueNameConstraint = true;
                            break;
                        }
                    }
                }
                if (hasUniqueNameConstraint) {
                    // Get all data from the existing table
                    const allData = await this.db.all('SELECT * FROM store_areas');
                    // Drop the table and recreate it without the unique constraint on name
                    await this.db.run('DROP TABLE store_areas');
                    const createTableQuery = `
            CREATE TABLE store_areas (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              sub_department TEXT,
              last_checked TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(name, sub_department) -- Ensure combination of name and sub_department is unique
            )
          `;
                    await this.db.run(createTableQuery);
                    // Insert the data back
                    for (const row of allData) {
                        await this.db.run('INSERT INTO store_areas (id, name, sub_department, last_checked, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', row.id, row.name, row.sub_department, row.last_checked, row.created_at, row.updated_at);
                    }
                }
            }
            catch (error) {
                console.error('Error during table migration:', error);
                // Re-throw the error so it's more visible
                throw error;
            }
        }
        else {
            // Create the table for the first time with unique constraint on the combination
            const query = `
        CREATE TABLE store_areas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          sub_department TEXT,
          last_checked TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(name, sub_department) -- Ensure combination of name and sub_department is unique
        )
      `;
            await this.db.run(query);
        }
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
            organizationId: result.organization_id,
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
        const query = 'SELECT * FROM store_areas WHERE id = ?';
        const result = await this.db.get(query, [id]);
        if (!result)
            return null;
        return {
            id: result.id,
            organizationId: result.organization_id,
            name: result.name,
            subDepartment: result.sub_department,
            lastChecked: result.last_checked,
            createdAt: result.created_at,
            updatedAt: result.updated_at,
        };
    }
    /**
     * Finds store areas by their name (can return multiple if different subdepartments)
     */
    async findByName(name) {
        const query = 'SELECT * FROM store_areas WHERE name = ?';
        const results = await this.db.all(query, [name]);
        if (!results || results.length === 0)
            return [];
        return results.map((result) => ({
            id: result.id,
            organizationId: result.organization_id,
            name: result.name,
            subDepartment: result.sub_department,
            lastChecked: result.last_checked,
            createdAt: result.created_at,
            updatedAt: result.updated_at,
        }));
    }
    /**
     * Finds a store area by its name and subdepartment (ensures uniqueness)
     */
    async findByNameAndSubDepartment(name, subDepartment) {
        const query = 'SELECT * FROM store_areas WHERE name = ? AND ((sub_department IS NULL AND ? IS NULL) OR (sub_department = ?))';
        const result = await this.db.get(query, [name, subDepartment, subDepartment]);
        if (!result)
            return null;
        return {
            id: result.id,
            organizationId: result.organization_id,
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
        const query = 'SELECT * FROM store_areas ORDER BY name';
        const results = await this.db.all(query);
        return results.map((result) => ({
            id: result.id,
            organizationId: result.organization_id,
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
        const setClause = fields
            .map((field) => {
            if (field === 'subDepartment')
                return 'sub_department = ?';
            return `${field} = ?`;
        })
            .join(', ');
        const values = Object.entries(updateData).map(([key, value]) => {
            if (key === 'subDepartment')
                return value || null;
            return value;
        });
        const query = `UPDATE store_areas SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ? RETURNING *`;
        const result = await this.db.get(query, [...values, id]);
        if (!result)
            return null;
        return {
            id: result.id,
            organizationId: result.organization_id,
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
        const query = 'DELETE FROM store_areas WHERE id = ?';
        const result = await this.db.run(query, [id]);
        return result.changes !== null && result.changes !== undefined && result.changes > 0;
    }
}
exports.StoreAreaModel = StoreAreaModel;
