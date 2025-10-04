"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.initDatabase = initDatabase;
// Database setup and initialization
const sqlite3_1 = __importDefault(require("sqlite3"));
const sqlite_1 = require("sqlite");
const bcrypt_1 = __importDefault(require("bcrypt"));
// Open a database connection
async function getDb() {
    const db = await (0, sqlite_1.open)({
        filename: "./database.sqlite",
        driver: sqlite3_1.default.Database,
    });
    return db;
}
// Initialize the database schema
async function initDatabase() {
    const db = await getDb();
    // Create tables if they don't exist
    await db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT UNIQUE NOT NULL,
      sku TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      cost_price REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      expiry_date TEXT NOT NULL,
      location_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Normal',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products (id),
      FOREIGN KEY (location_id) REFERENCES store_areas (id)
    );

    CREATE TABLE IF NOT EXISTS store_areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sub_department TEXT,
      last_checked TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name, sub_department)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pin TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      inventory_item_id INTEGER NOT NULL,
      change_description TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id),
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id)
    );
  `);
    // Add sub_department column to store_areas if it doesn't exist
    try {
        const tableInfo = await db.all("PRAGMA table_info(store_areas)");
        const hasSubDepartmentColumn = tableInfo.some(column => column.name === 'sub_department');
        if (!hasSubDepartmentColumn) {
            await db.exec("ALTER TABLE store_areas ADD COLUMN sub_department TEXT");
        }
    }
    catch (error) {
        console.error("Error checking or updating store_areas table:", error);
    }
    // Seed the database with some initial data
    await db.exec(`
    INSERT OR IGNORE INTO products (barcode, sku, name, cost_price) VALUES ('123456789', 'SKU123', 'Test Product', 10.00);
  `);
    // First check if a user with PIN 1234 already exists
    const existingUser = await db.get("SELECT * FROM users");
    console.log("Existing user check:", existingUser);
    // Clear existing users for a fresh start if we see there are issues
    if (existingUser) {
        // Clear all users
        await db.exec("DELETE FROM users");
        console.log("Cleared existing users");
    }
    // Now create a fresh user
    // Seed initial manager user with proper hash
    const saltRounds = 10;
    const hashedPin = await bcrypt_1.default.hash("1234", saltRounds);
    console.log("Hashed PIN for 1234:", hashedPin);
    await db.exec(`
    INSERT OR IGNORE INTO users (pin, role) VALUES ('${hashedPin}', 'Manager');
  `);
    // Check what we just inserted
    const insertedUser = await db.get("SELECT * FROM users WHERE role = 'Manager'");
    console.log("Inserted user:", insertedUser);
    // Also check all users
    const allUsers = await db.all("SELECT * FROM users");
    console.log("All users in DB:", allUsers);
}
