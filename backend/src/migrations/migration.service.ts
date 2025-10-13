import Database from 'better-sqlite3';
import { MigrationModel, MigrationRecord } from './migration.model';
import { envConfig } from '../config/environment';
import { Logger } from '../utils/logger';

// Define the Database type for better-sqlite3

export interface Migration {
  id: number;
  name: string;
  up: (db: Database) => void;
  down?: (db: Database) => void;
}

export class MigrationService {
  private migrationModel: MigrationModel;

  constructor() {
    this.migrationModel = new MigrationModel();
  }

  /**
   * Run all pending migrations
   */
  public async runMigrations(): Promise<void> {
    const dbPath = envConfig.DATABASE_PATH || './database.sqlite';
    const db = new Database(dbPath);

    try {
      // Ensure the migrations table exists
      this.migrationModel.ensureMigrationsTable(db);

      // Get all executed migrations
      const executedMigrations = this.migrationModel.getExecutedMigrations(db);
      const executedMigrationNames = new Set(executedMigrations.map(m => m.name));

      // Define our migration pipeline
      const migrations: Migration[] = await this.getMigrations();

      // Execute pending migrations
      for (const migration of migrations) {
        if (!executedMigrationNames.has(migration.name)) {
          Logger.info(`Running migration: ${migration.name} (ID: ${migration.id})`);
          
          try {
            // Run the migration in a transaction to ensure atomicity
            const transaction = (db as any).transaction(() => {
              migration.up(db);
            });
            
            transaction();
            
            // Mark the migration as executed
            this.migrationModel.markMigrationExecuted(db, migration.id, migration.name);
            Logger.info(`Migration ${migration.name} completed successfully`);
          } catch (error) {
            Logger.error(`Migration ${migration.name} failed:`, error);
            throw error;
          }
        } else {
          Logger.debug(`Migration ${migration.name} (ID: ${migration.id}) already executed, skipping`);
        }
      }

      Logger.info('All migrations completed');
    } catch (error) {
      Logger.error('Migration process failed:', error);
      throw error;
    } finally {
      db.close();
    }
  }

  /**
   * Get all available migrations in order
   */
  private async getMigrations(): Promise<Migration[]> {
    // Return migrations in the order they should be executed
    return [
      // Initial schema migration
      {
        id: 1,
        name: '001-initial-schema',
        up: (db: Database) => {
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
        down: (db: Database) => {
          // Drop tables in reverse order to respect foreign key constraints
          db.exec(`
            DROP TABLE IF EXISTS audit_log;
            DROP TABLE IF EXISTS inventory_items;
            DROP TABLE IF EXISTS store_areas;
            DROP TABLE IF EXISTS users;
            DROP TABLE IF EXISTS products;
          `);
        }
      },
      // Add sub_department column to store_areas
      {
        id: 2,
        name: '002-add-sub-department-column',
        up: (db: Database) => {
          // Check if the column already exists to avoid errors
          const tableInfo = db.prepare("PRAGMA table_info(store_areas)").all();
          const hasSubDepartmentColumn = tableInfo.some((column: any) => column.name === 'sub_department');
          
          if (!hasSubDepartmentColumn) {
            db.exec("ALTER TABLE store_areas ADD COLUMN sub_department TEXT");
            Logger.info("Added sub_department column to store_areas table");
          }
        },
        down: (db: Database) => {
          // Note: SQLite doesn't support dropping columns directly
          // We'd need to recreate the table which is complex
          // For now, we'll just log that this migration can't be reverted
          Logger.warn("Cannot revert 'Add sub_department to store_areas' migration in SQLite");
        }
      },
      // Add indexes for performance
      {
        id: 3,
        name: '003-add-performance-indexes',
        up: (db: Database) => {
          db.exec(`
            CREATE INDEX IF NOT EXISTS idx_inventory_expiry ON inventory_items(expiry_date);
            CREATE INDEX IF NOT EXISTS idx_inventory_location ON inventory_items(location_id);
            CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
            CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
          `);
        },
        down: (db: Database) => {
          db.exec(`
            DROP INDEX IF EXISTS idx_inventory_expiry;
            DROP INDEX IF EXISTS idx_inventory_location;
            DROP INDEX IF EXISTS idx_products_sku;
            DROP INDEX IF EXISTS idx_products_barcode;
          `);
        }
      },
      // Add additional performance indexes for scale
      {
        id: 5,
        name: '005-add-additional-performance-indexes',
        up: (db: Database) => {
          db.exec(`
            -- Indexes for inventory_items that will help with expiry date queries (used for markdown calculations)
            CREATE INDEX IF NOT EXISTS idx_inventory_product_expiry ON inventory_items(product_id, expiry_date);
            CREATE INDEX IF NOT EXISTS idx_inventory_status ON inventory_items(status);
            
            -- Index for audit_log for better performance when tracking changes
            CREATE INDEX IF NOT EXISTS idx_audit_inventory_item ON audit_log(inventory_item_id);
            CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
            CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(created_at);
            
            -- Composite index for products that might be commonly queried together
            CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
          `);
        },
        down: (db: Database) => {
          db.exec(`
            DROP INDEX IF EXISTS idx_inventory_product_expiry;
            DROP INDEX IF EXISTS idx_inventory_status;
            DROP INDEX IF EXISTS idx_audit_inventory_item;
            DROP INDEX IF EXISTS idx_audit_user;
            DROP INDEX IF EXISTS idx_audit_timestamp;
            DROP INDEX IF EXISTS idx_products_name;
          `);
        }
      },
      // Add default data migration
      {
        id: 4,
        name: '004-add-default-data',
        up: (db: Database) => {
          // Insert default store area if none exist
          const storeAreaCount = db.prepare("SELECT COUNT(*) as count FROM store_areas").get() as { count: number };
          if (storeAreaCount.count === 0) {
            db.exec("INSERT INTO store_areas (name, sub_department) VALUES ('Default Area', 'General')");
          }
          
          // Insert default product if none exist
          const productCount = db.prepare("SELECT COUNT(*) as count FROM products").get() as { count: number };
          if (productCount.count === 0) {
            db.exec("INSERT INTO products (barcode, sku, name, cost_price) VALUES ('123456789', 'DEFAULT001', 'Default Product', 0.0)");
          }
        },
        down: (db: Database) => {
          // We don't want to remove default data in down migrations
          Logger.info("Default data migration rollback skipped");
        }
      },
      // Update markdown statuses to follow correct calculation rules
      {
        id: 6,
        name: '006-update-markdown-statuses',
        up: (db: Database) => {
          // Create an instance of the inventory service to use the updated calculation functions
          const { InventoryService } = require('../services/inventory.service');
          const inventoryService = new InventoryService();
          
          // Get all inventory items
          const stmt = db.prepare('SELECT id, expiry_date FROM inventory_items');
          const items = stmt.all() as Array<{id: number, expiry_date: string}>;
          
          // Update each item's status based on the new calculation rules
          const updateStmt = db.prepare(
            'UPDATE inventory_items SET status = ? WHERE id = ?'
          );
          
          let updatedCount = 0;
          for (const item of items) {
            try {
              // Use the updated calculation function to get the new status
              // Note: Since calculateMarkdownStatus is async, we need to handle it differently
              // In this case, we'll implement the same logic synchronously inside the migration
              const expiry = new Date(item.expiry_date);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              expiry.setHours(0, 0, 0, 0);
              
              const timeDiff = expiry.getTime() - today.getTime();
              const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
              
              let newStatus: string;
              if (daysDiff < 0) {
                newStatus = 'Expired';
              } else if (daysDiff <= 30) {
                // Within 1 month from expiry: cost price - 20% (Markdown 3)
                newStatus = 'Markdown 3';
              } else if (daysDiff <= 60) {
                // Within 2 months from expiry: cost price (Markdown 2)
                newStatus = 'Markdown 2';
              } else if (daysDiff <= 90) {
                // Within 3 months from expiry: cost price + 20% (Markdown 1)
                newStatus = 'Markdown 1';
              } else {
                // More than 3 months from expiry: Normal (no markdown)
                newStatus = 'Normal';
              }
              
              // Update the status in the database
              updateStmt.run(newStatus, item.id);
              updatedCount++;
            } catch (error) {
              Logger.error(`Error updating item ${item.id}:`, error);
            }
          }
          
          Logger.info(`Updated markdown statuses for ${updatedCount} inventory items.`);
        },
        down: (db: Database) => {
          Logger.info("Rollback for update markdown statuses migration is not implemented.");
        }
      },
      // Add expired_item_transactions table
      {
        id: 7,
        name: '007-add-expired-item-transactions-table',
        up: (db: Database) => {
          // Create the expired_item_transactions table
          db.exec(`
            CREATE TABLE IF NOT EXISTS expired_item_transactions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              inventory_item_id INTEGER NOT NULL,
              user_id INTEGER NOT NULL,
              action TEXT NOT NULL, -- 'sold_through' or 'expired'
              units_discarded INTEGER, -- Only required when action is 'expired'
              financial_loss REAL, -- Calculated as units_discarded * cost_price
              transaction_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id),
              FOREIGN KEY (user_id) REFERENCES users (id)
            );
            
            -- Create indexes for performance
            CREATE INDEX IF NOT EXISTS idx_expired_item_transactions_inventory_item_id ON expired_item_transactions (inventory_item_id);
            CREATE INDEX IF NOT EXISTS idx_expired_item_transactions_user_id ON expired_item_transactions (user_id);
            CREATE INDEX IF NOT EXISTS idx_expired_item_transactions_action ON expired_item_transactions (action);
            CREATE INDEX IF NOT EXISTS idx_expired_item_transactions_transaction_date ON expired_item_transactions (transaction_date);
          `);
        },
        down: (db: Database) => {
          // Drop the expired_item_transactions table
          db.exec(`
            DROP TABLE IF EXISTS expired_item_transactions;
          `);
        }
      }
    ];
  }

  /**
   * Get the status of all migrations
   */
  public async getMigrationStatus(): Promise<{ pending: Migration[], executed: MigrationRecord[] }> {
    const dbPath = envConfig.DATABASE_PATH || './database.sqlite';
    const db = new Database(dbPath);

    try {
      this.migrationModel.ensureMigrationsTable(db);
      const executedMigrations = this.migrationModel.getExecutedMigrations(db);
      const allMigrations = await this.getMigrations();
      
      const executedNames = new Set(executedMigrations.map(m => m.name));
      const pendingMigrations = allMigrations.filter(m => !executedNames.has(m.name));
      
      return {
        pending: pendingMigrations,
        executed: executedMigrations
      };
    } finally {
      db.close();
    }
  }

  /**
   * Rollback the last migration
   */
  public async rollbackLastMigration(): Promise<void> {
    const dbPath = envConfig.DATABASE_PATH || './database.sqlite';
    const db = new Database(dbPath);

    try {
      this.migrationModel.ensureMigrationsTable(db);
      const executedMigrations = this.migrationModel.getExecutedMigrations(db);
      
      if (executedMigrations.length === 0) {
        Logger.info('No migrations to rollback');
        return;
      }

      // Get the last executed migration
      const lastMigration = executedMigrations[executedMigrations.length - 1];
      
      // Find the corresponding migration definition
      const allMigrations = await this.getMigrations();
      const migrationToRollback = allMigrations.find(m => m.name === lastMigration.name);

      if (!migrationToRollback || !migrationToRollback.down) {
        Logger.error(`Migration ${lastMigration.name} does not have a rollback function`);
        throw new Error(`Migration ${lastMigration.name} cannot be rolled back`);
      }

      Logger.info(`Rolling back migration: ${lastMigration.name}`);

      // Run the rollback in a transaction to ensure atomicity
      const transaction = (db as any).transaction(() => {
        migrationToRollback.down!(db);
      });

      transaction();

      // Remove the migration record
      this.migrationModel.removeMigrationRecord(db, lastMigration.name);
      
      Logger.info(`Migration ${lastMigration.name} rolled back successfully`);
    } catch (error) {
      Logger.error('Migration rollback failed:', error);
      throw error;
    } finally {
      db.close();
    }
  }
}
