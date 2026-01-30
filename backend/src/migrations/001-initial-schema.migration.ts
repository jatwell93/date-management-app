import { type Database as DatabaseType } from 'better-sqlite3';
import { Migration } from './migration.service';

/**
 * Initial schema migration
 * Creates all the base tables for the application
 */
export const initialSchemaMigration: Migration = {
  id: 1,
  name: '001-initial-schema',
  up: (db: DatabaseType) => {
    // Create tables if they don't exist
    db.exec(`
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
  },
  down: (db: DatabaseType) => {
    // Drop tables in reverse order to respect foreign key constraints
    db.exec(`
      DROP TABLE IF EXISTS audit_log;
      DROP TABLE IF EXISTS inventory_items;
      DROP TABLE IF EXISTS store_areas;
      DROP TABLE IF EXISTS users;
      DROP TABLE IF EXISTS products;
    `);
  },
};
