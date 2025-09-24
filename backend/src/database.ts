// Database setup and initialization
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// Open a database connection
export async function getDb() {
  const db = await open({
    filename: './database.sqlite',
    driver: sqlite3.Database
  });
  return db;
}

// Initialize the database schema
export async function initDatabase() {
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
      name TEXT UNIQUE NOT NULL,
      last_checked TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  
  // Seed the database with some initial data
  await db.exec(`
    INSERT OR IGNORE INTO products (barcode, sku, name, cost_price) VALUES ('123456789', 'SKU123', 'Test Product', 10.00);
  `);
  
  console.log('Database initialized successfully');
}