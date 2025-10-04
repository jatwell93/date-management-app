"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = require("../../database");
describe("Database Initialization", () => {
    it("should initialize database successfully", async () => {
        // This test just ensures the database can be initialized without errors
        await expect((0, database_1.initDatabase)()).resolves.not.toThrow();
    });
    it("should create all required tables", async () => {
        // Initialize the database
        await (0, database_1.initDatabase)();
        // Get a database connection
        const db = await (0, database_1.getDb)();
        // Check if the products table exists
        const productsTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='products'");
        expect(productsTable).toHaveLength(1);
        // Check if the inventory_items table exists
        const inventoryItemsTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_items'");
        expect(inventoryItemsTable).toHaveLength(1);
        // Check if the store_areas table exists
        const storeAreasTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='store_areas'");
        expect(storeAreasTable).toHaveLength(1);
        // Check if the users table exists
        const usersTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
        expect(usersTable).toHaveLength(1);
        // Check if the audit_log table exists
        const auditLogTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'");
        expect(auditLogTable).toHaveLength(1);
        // Check if sub_department column exists in store_areas
        const tableInfo = await db.all("PRAGMA table_info(store_areas)");
        const hasSubDepartment = tableInfo.some((column) => column.name === 'sub_department');
        expect(hasSubDepartment).toBe(true);
        await db.close();
    });
    it("should seed initial data correctly", async () => {
        // Initialize the database
        await (0, database_1.initDatabase)();
        // Get a database connection
        const db = await (0, database_1.getDb)();
        // Check if the initial product exists
        const product = await db.get("SELECT * FROM products WHERE sku = 'SKU123'");
        expect(product).toBeDefined();
        // Check if the initial user exists with proper hash
        const user = await db.get("SELECT * FROM users WHERE role = 'Manager'");
        expect(user).toBeDefined();
        expect(user.pin).toMatch(/^\$2[ayb]\$.{56}$/); // bcrypt hash format
        await db.close();
    });
});
