import sqlite3 from "sqlite3";
import path from "path";

const dbPath = path.resolve(__dirname, "../database.sqlite");

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    // console.error("Error opening database", err.message);
  } else {
    // console.log("Connected to the SQLite database.");
  }
});

const createTablesQueries = `
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
`;

db.exec(createTablesQueries, (err) => {
  if (err) {
    // console.error("Error creating tables", err.message);
  } else {
    // console.log("Tables created or already exist.");

    // Attempt to add sub_department column if it doesn't exist for store_areas table
    // We'll try to add it, and if it fails because it already exists, that's fine
    try {
      db.exec("ALTER TABLE store_areas ADD COLUMN sub_department TEXT;");
    } catch (e) {
      // Column might already exist, which is fine
    }

    // Insert a default user if no users exist
    db.get("SELECT COUNT(*) as count FROM users", (err, row: { count: number }) => {
      if (err) {
        // console.error("Error checking for existing users", err.message);
      } else if (row.count === 0) {
        db.run(
          "INSERT INTO users (pin, role) VALUES (?, ?)",
          ["1234", "admin"],
          (insertErr) => {
            if (insertErr) {
              // console.error("Error inserting default user", insertErr.message);
            } else {
              // console.log("Default user '1234' (admin) inserted.");
            }
          },
        );
      }
    });
  }
});

db.close((err) => {
  if (err) {
    // console.error("Error closing database", err.message);
  } else {
    // console.log("Database connection closed.");
  }
});
