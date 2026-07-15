import Database from 'better-sqlite3';
import { MigrationModel, MigrationRecord } from './migration.model';
import { envConfig } from '../config/environment';
import { Logger } from '../utils/logger';

// Define the Database type for better-sqlite3
type DB = InstanceType<typeof Database>;
type TransactionCapableDB = DB & { transaction<T>(callback: () => T): () => T };

interface PragmaTableInfoRow {
  name: string;
}

function addColumnIfMissing(db: DB, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as PragmaTableInfoRow[];
  if (columns.some((candidate) => candidate.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export interface Migration {
  id: number;
  name: string;
  up: (db: DB) => void;
  down?: (db: DB) => void;
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
    const db: DB = new Database(dbPath);

    try {
      // Ensure the migrations table exists
      this.migrationModel.ensureMigrationsTable(db);

      // Get all executed migrations
      const executedMigrations = this.migrationModel.getExecutedMigrations(db);
      const executedMigrationNames = new Set(executedMigrations.map((m) => m.name));

      // Define our migration pipeline
      const migrations: Migration[] = await this.getMigrations();

      // Execute pending migrations
      for (const migration of migrations) {
        if (!executedMigrationNames.has(migration.name)) {
          Logger.info(`Running migration: ${migration.name} (ID: ${migration.id})`);

          try {
            // Run the migration in a transaction to ensure atomicity
            const transaction = (db as TransactionCapableDB).transaction(() => {
              migration.up(db);
            });

            transaction();

            // Mark the migration as executed
            this.migrationModel.markMigrationExecuted(db, migration.id, migration.name);
            Logger.info(`Migration ${migration.name} completed successfully`);
          } catch (error: unknown) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            Logger.error(`Migration ${migration.name} failed:`, { error: errorMsg });
            throw error;
          }
        } else {
          Logger.debug(
            `Migration ${migration.name} (ID: ${migration.id}) already executed, skipping`,
          );
        }
      }

      Logger.info('All migrations completed');
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      Logger.error('Migration process failed:', { error: errorMsg });
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
        up: (db: DB) => {
          // Create tables if they don't exist
          db.exec(`
            CREATE TABLE IF NOT EXISTS products (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              organization_id TEXT NOT NULL DEFAULT 'default-org',
              barcode TEXT UNIQUE NOT NULL,
              sku TEXT UNIQUE NOT NULL,
              name TEXT NOT NULL,
              cost_price REAL NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS inventory_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              organization_id TEXT NOT NULL DEFAULT 'default-org',
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
              organization_id TEXT NOT NULL DEFAULT 'default-org',
              user_id INTEGER NOT NULL,
              inventory_item_id INTEGER NOT NULL,
              change_description TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (user_id) REFERENCES users (id),
              FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id)
            );
          `);
        },
        down: (db: DB) => {
          // Drop tables in reverse order to respect foreign key constraints
          db.exec(`
            DROP TABLE IF EXISTS audit_log;
            DROP TABLE IF EXISTS inventory_items;
            DROP TABLE IF EXISTS store_areas;
            DROP TABLE IF EXISTS users;
            DROP TABLE IF EXISTS products;
          `);
        },
      },
      // Add sub_department column to store_areas
      {
        id: 2,
        name: '002-add-sub-department-column',
        up: (db: DB) => {
          // Check if the column already exists to avoid errors
          const tableInfo = db
            .prepare('PRAGMA table_info(store_areas)')
            .all() as PragmaTableInfoRow[];
          const hasSubDepartmentColumn = tableInfo.some(
            (column) => column.name === 'sub_department',
          );

          if (!hasSubDepartmentColumn) {
            db.exec('ALTER TABLE store_areas ADD COLUMN sub_department TEXT');
            Logger.info('Added sub_department column to store_areas table');
          }
        },
        down: (_db: DB) => {
          // Note: SQLite doesn't support dropping columns directly
          // We'd need to recreate the table which is complex
          // For now, we'll just log that this migration can't be reverted
          Logger.warn("Cannot revert 'Add sub_department to store_areas' migration in SQLite");
        },
      },
      // Add indexes for performance
      {
        id: 3,
        name: '003-add-performance-indexes',
        up: (db: DB) => {
          db.exec(`
            CREATE INDEX IF NOT EXISTS idx_inventory_expiry ON inventory_items(expiry_date);
            CREATE INDEX IF NOT EXISTS idx_inventory_location ON inventory_items(location_id);
            CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
            CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
          `);
        },
        down: (db: DB) => {
          db.exec(`
            DROP INDEX IF EXISTS idx_inventory_expiry;
            DROP INDEX IF EXISTS idx_inventory_location;
            DROP INDEX IF EXISTS idx_products_sku;
            DROP INDEX IF EXISTS idx_products_barcode;
          `);
        },
      },
      // Add additional performance indexes for scale
      {
        id: 5,
        name: '005-add-additional-performance-indexes',
        up: (db: DB) => {
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
        down: (db: DB) => {
          db.exec(`
            DROP INDEX IF EXISTS idx_inventory_product_expiry;
            DROP INDEX IF EXISTS idx_inventory_status;
            DROP INDEX IF EXISTS idx_audit_inventory_item;
            DROP INDEX IF EXISTS idx_audit_user;
            DROP INDEX IF EXISTS idx_audit_timestamp;
            DROP INDEX IF EXISTS idx_products_name;
          `);
        },
      },
      // Add default data migration
      {
        id: 4,
        name: '004-add-default-data',
        up: (db: DB) => {
          // Insert default store area if none exist
          const storeAreaCount = db.prepare('SELECT COUNT(*) as count FROM store_areas').get() as {
            count: number;
          };
          if (storeAreaCount.count === 0) {
            db.exec(
              "INSERT INTO store_areas (name, sub_department) VALUES ('Default Area', 'General')",
            );
          }

          // Insert default product if none exist
          const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get() as {
            count: number;
          };
          if (productCount.count === 0) {
            db.exec(
              "INSERT INTO products (barcode, sku, name, cost_price) VALUES ('123456789', 'DEFAULT001', 'Default Product', 0.0)",
            );
          }
        },
        down: (_db: DB) => {
          // We don't want to remove default data in down migrations
          Logger.info('Default data migration rollback skipped');
        },
      },
      // Update markdown statuses to follow correct calculation rules
      {
        id: 6,
        name: '006-update-markdown-statuses',
        up: (db: DB) => {
          // Create an instance of the inventory service to use the updated calculation functions
          require('../services/inventory.service');

          // Get all inventory items
          const stmt = db.prepare('SELECT id, expiry_date FROM inventory_items');
          const items = stmt.all() as Array<{ id: number; expiry_date: string }>;

          // Update each item's status based on the new calculation rules
          const updateStmt = db.prepare('UPDATE inventory_items SET status = ? WHERE id = ?');

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
            } catch (error: unknown) {
              const errorMsg = error instanceof Error ? error.message : 'Unknown error';
              Logger.error(`Error updating item ${item.id}:`, { error: errorMsg });
            }
          }

          Logger.info(`Updated markdown statuses for ${updatedCount} inventory items.`);
        },
        down: (_db: DB) => {
          Logger.info('Rollback for update markdown statuses migration is not implemented.');
        },
      },
      // Add expired_item_transactions table
      {
        id: 7,
        name: '007-add-expired-item-transactions-table',
        up: (db: DB) => {
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
        down: (db: DB) => {
          // Drop the expired_item_transactions table
          db.exec(`
            DROP TABLE IF EXISTS expired_item_transactions;
          `);
        },
      },
      {
        id: 8,
        name: '008-add-organization-id-to-reporting-tables',
        up: (db: DB) => {
          const addColumnIfMissing = (tableName: string) => {
            const tableInfo = db
              .prepare(`PRAGMA table_info(${tableName})`)
              .all() as PragmaTableInfoRow[];
            const hasOrganizationIdColumn = tableInfo.some(
              (column) => column.name === 'organization_id',
            );

            if (!hasOrganizationIdColumn) {
              db.exec(
                `ALTER TABLE ${tableName} ADD COLUMN organization_id TEXT NOT NULL DEFAULT 'default-org'`,
              );
              Logger.info(`Added organization_id column to ${tableName} table`);
            }
          };

          addColumnIfMissing('products');
          addColumnIfMissing('inventory_items');
          addColumnIfMissing('audit_log');
          addColumnIfMissing('store_areas');
        },
        down: (_db: DB) => {
          Logger.warn(
            "Cannot revert 'Add organization_id to reporting tables' migration in SQLite",
          );
        },
      },
      // Snapshot the markdown level at the time of disposition so sell-through
      // reporting can break down stock by the reduction depth it sold at.
      {
        id: 9,
        name: '009-add-markdown-level-to-expired-item-transactions',
        up: (db: DB) => {
          const tableInfo = db
            .prepare('PRAGMA table_info(expired_item_transactions)')
            .all() as PragmaTableInfoRow[];
          const hasMarkdownLevel = tableInfo.some((column) => column.name === 'markdown_level');

          if (!hasMarkdownLevel) {
            db.exec('ALTER TABLE expired_item_transactions ADD COLUMN markdown_level INTEGER');
            Logger.info('Added markdown_level column to expired_item_transactions table');
          }
        },
        down: (_db: DB) => {
          Logger.warn('Cannot revert markdown_level column migration in SQLite');
        },
      },
      // Store retail price distinct from cost so a markdown band can discount off
      // retail (issue #338). Nullable: existing cost-only products stay valid.
      {
        id: 10,
        name: '010-add-retail-price-to-products',
        up: (db: DB) => {
          const tableInfo = db.prepare('PRAGMA table_info(products)').all() as PragmaTableInfoRow[];
          const hasRetailPrice = tableInfo.some((column) => column.name === 'retail_price');

          if (!hasRetailPrice) {
            db.exec('ALTER TABLE products ADD COLUMN retail_price REAL');
            Logger.info('Added retail_price column to products table');
          }
        },
        down: (_db: DB) => {
          Logger.warn('Cannot revert retail_price column migration in SQLite');
        },
      },
      // Per-organization markdown matrix: three bands, each a discount percentage
      // off cost or retail. Defaults reproduce the previous 50/60/75%-off-cost
      // ladder so untouched orgs are unchanged.
      {
        id: 11,
        name: '011-add-organization-markdown-config-table',
        up: (db: DB) => {
          db.exec(`
            CREATE TABLE IF NOT EXISTS organization_markdown_config (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              organization_id TEXT NOT NULL UNIQUE,
              band1_percentage REAL NOT NULL DEFAULT 50,
              band2_percentage REAL NOT NULL DEFAULT 60,
              band3_percentage REAL NOT NULL DEFAULT 75,
              band1_basis TEXT NOT NULL DEFAULT 'cost',
              band2_basis TEXT NOT NULL DEFAULT 'cost',
              band3_basis TEXT NOT NULL DEFAULT 'cost',
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
              CHECK (band1_basis IN ('cost', 'retail')),
              CHECK (band2_basis IN ('cost', 'retail')),
              CHECK (band3_basis IN ('cost', 'retail')),
              CHECK (band1_percentage BETWEEN 0 AND 100),
              CHECK (band2_percentage BETWEEN 0 AND 100),
              CHECK (band3_percentage BETWEEN 0 AND 100)
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_markdown_config_org_id
              ON organization_markdown_config (organization_id);
          `);
        },
        down: (db: DB) => {
          db.exec('DROP TABLE IF EXISTS organization_markdown_config;');
        },
      },
      {
        id: 12,
        name: '012-add-parent-id-to-store-areas',
        up: (db: DB) => {
          const tableInfo = db
            .prepare('PRAGMA table_info(store_areas)')
            .all() as PragmaTableInfoRow[];
          const hasParentId = tableInfo.some((column) => column.name === 'parent_id');

          if (!hasParentId) {
            db.exec('ALTER TABLE store_areas ADD COLUMN parent_id INTEGER');
            Logger.info('Added parent_id column to store_areas table');
          }

          db.exec(`
            CREATE INDEX IF NOT EXISTS idx_store_areas_parent_id ON store_areas(parent_id);

            CREATE TEMP TABLE IF NOT EXISTS store_area_backfill_bays AS
              SELECT
                id,
                organization_id,
                CASE
                  WHEN sub_department IS NULL OR TRIM(sub_department) = ''
                    THEN 'Unassigned'
                  ELSE sub_department
                END AS department_name
              FROM store_areas
              WHERE parent_id IS NULL;

            INSERT INTO store_areas (
              organization_id,
              name,
              sub_department,
              last_checked,
              created_at,
              updated_at
            )
            SELECT
              candidate.organization_id,
              candidate.department_name,
              NULL,
              NULL,
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP
            FROM (
              SELECT DISTINCT organization_id, department_name
              FROM store_area_backfill_bays
            ) AS candidate
            WHERE NOT EXISTS (
              SELECT 1
              FROM store_areas AS existing
              WHERE existing.organization_id = candidate.organization_id
                AND existing.parent_id IS NULL
                AND existing.name = candidate.department_name
                AND existing.sub_department IS NULL
            );

            UPDATE store_areas
            SET parent_id = (
              SELECT department.id
              FROM store_areas AS department
              JOIN store_area_backfill_bays AS bay
                ON bay.organization_id = department.organization_id
               AND bay.department_name = department.name
              WHERE bay.id = store_areas.id
                AND department.parent_id IS NULL
                AND department.sub_department IS NULL
              ORDER BY department.id
              LIMIT 1
            )
            WHERE id IN (SELECT id FROM store_area_backfill_bays)
              AND parent_id IS NULL;

            DROP TABLE IF EXISTS store_area_backfill_bays;
          `);
        },
        down: (_db: DB) => {
          Logger.warn('Cannot revert store_areas parent_id migration in SQLite');
        },
      },
      {
        id: 13,
        name: '013-add-check-cycles-table',
        up: (db: DB) => {
          db.exec(`
            CREATE TABLE IF NOT EXISTS check_cycles (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              organization_id TEXT NOT NULL,
              name TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'active',
              started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              completed_at TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
              CHECK (status IN ('active', 'completed')),
              CHECK (
                (status = 'completed' AND completed_at IS NOT NULL)
                OR (status = 'active' AND completed_at IS NULL)
              )
            );

            CREATE INDEX IF NOT EXISTS idx_check_cycles_organization_id
              ON check_cycles (organization_id);
            CREATE INDEX IF NOT EXISTS idx_check_cycles_started_at
              ON check_cycles (started_at);
            CREATE UNIQUE INDEX IF NOT EXISTS one_active_cycle_per_org
              ON check_cycles (organization_id)
              WHERE status = 'active';
          `);
        },
        down: (db: DB) => {
          db.exec('DROP TABLE IF EXISTS check_cycles;');
        },
      },
      {
        id: 14,
        name: '014-add-bay-checks-table',
        up: (db: DB) => {
          db.exec(`
            CREATE TABLE IF NOT EXISTS bay_checks (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              organization_id TEXT NOT NULL,
              cycle_id INTEGER NOT NULL,
              store_area_id INTEGER NOT NULL,
              user_id INTEGER,
              checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              items_added_count INTEGER NOT NULL DEFAULT 0,
              notes TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
              FOREIGN KEY (cycle_id) REFERENCES check_cycles (id) ON DELETE CASCADE,
              FOREIGN KEY (store_area_id) REFERENCES store_areas (id) ON DELETE CASCADE,
              FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
              CHECK (items_added_count >= 0)
            );

            CREATE INDEX IF NOT EXISTS idx_bay_checks_organization_id
              ON bay_checks (organization_id);
            CREATE INDEX IF NOT EXISTS idx_bay_checks_cycle_id
              ON bay_checks (cycle_id);
            CREATE INDEX IF NOT EXISTS idx_bay_checks_store_area_id
              ON bay_checks (store_area_id);
            CREATE INDEX IF NOT EXISTS idx_bay_checks_checked_at
              ON bay_checks (checked_at);
          `);
        },
        down: (db: DB) => {
          db.exec('DROP TABLE IF EXISTS bay_checks;');
        },
      },
      // Supplier credit-claim recovery: suppliers + claim lifecycle tables, and a
      // nullable products.supplier_id so a SKU can map to a supplier (self-building
      // through use). Mirrors Neon SQL 0005 and the Prisma models.
      {
        id: 15,
        name: '015-add-supplier-credit-claims',
        up: (db: DB) => {
          const productsInfo = db
            .prepare('PRAGMA table_info(products)')
            .all() as PragmaTableInfoRow[];
          const hasSupplierId = productsInfo.some((column) => column.name === 'supplier_id');
          if (!hasSupplierId) {
            db.exec('ALTER TABLE products ADD COLUMN supplier_id INTEGER');
            Logger.info('Added supplier_id column to products table');
          }

          db.exec(`
            CREATE TABLE IF NOT EXISTS suppliers (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              organization_id TEXT NOT NULL,
              name TEXT NOT NULL,
              contact_email TEXT,
              credit_policy_note TEXT NOT NULL DEFAULT '',
              policy_write_off_qty INTEGER,
              policy_credit_qty INTEGER,
              follow_up_days INTEGER NOT NULL DEFAULT 7,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
              UNIQUE (organization_id, name)
            );
            CREATE INDEX IF NOT EXISTS idx_suppliers_organization_id ON suppliers (organization_id);
            CREATE INDEX IF NOT EXISTS idx_products_supplier_id ON products (supplier_id);

            CREATE TABLE IF NOT EXISTS credit_claims (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              organization_id TEXT NOT NULL,
              supplier_id INTEGER NOT NULL,
              created_by_user_id INTEGER,
              status TEXT NOT NULL DEFAULT 'DRAFT',
              contact_email_snapshot TEXT,
              expected_credit_units INTEGER,
              expected_credit_value REAL,
              credited_value REAL,
              sent_at TEXT,
              next_follow_up_at TEXT,
              follow_up_count INTEGER NOT NULL DEFAULT 0,
              settled_at TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
              FOREIGN KEY (supplier_id) REFERENCES suppliers (id),
              FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_credit_claims_organization_id ON credit_claims (organization_id);
            CREATE INDEX IF NOT EXISTS idx_credit_claims_supplier_id ON credit_claims (supplier_id);
            CREATE INDEX IF NOT EXISTS idx_credit_claims_status ON credit_claims (status);
            CREATE INDEX IF NOT EXISTS idx_credit_claims_next_follow_up_at ON credit_claims (next_follow_up_at);

            CREATE TABLE IF NOT EXISTS credit_claim_lines (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              organization_id TEXT NOT NULL,
              claim_id INTEGER NOT NULL,
              expired_item_transaction_id INTEGER NOT NULL UNIQUE,
              batch_number TEXT,
              units_claimed INTEGER NOT NULL,
              expected_credit_units INTEGER,
              expected_credit_value REAL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
              FOREIGN KEY (claim_id) REFERENCES credit_claims (id) ON DELETE CASCADE,
              FOREIGN KEY (expired_item_transaction_id) REFERENCES expired_item_transactions (id)
            );
            CREATE INDEX IF NOT EXISTS idx_credit_claim_lines_organization_id ON credit_claim_lines (organization_id);
            CREATE INDEX IF NOT EXISTS idx_credit_claim_lines_claim_id ON credit_claim_lines (claim_id);

            CREATE TABLE IF NOT EXISTS credit_claim_photos (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              organization_id TEXT NOT NULL,
              claim_line_id INTEGER NOT NULL,
              storage_key TEXT NOT NULL,
              file_name TEXT NOT NULL,
              size_bytes INTEGER NOT NULL,
              delete_after TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
              FOREIGN KEY (claim_line_id) REFERENCES credit_claim_lines (id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_credit_claim_photos_organization_id ON credit_claim_photos (organization_id);
            CREATE INDEX IF NOT EXISTS idx_credit_claim_photos_claim_line_id ON credit_claim_photos (claim_line_id);
            CREATE INDEX IF NOT EXISTS idx_credit_claim_photos_delete_after ON credit_claim_photos (delete_after);

            CREATE TABLE IF NOT EXISTS credit_claim_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              organization_id TEXT NOT NULL,
              claim_id INTEGER NOT NULL,
              user_id INTEGER,
              type TEXT NOT NULL,
              note TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
              FOREIGN KEY (claim_id) REFERENCES credit_claims (id) ON DELETE CASCADE,
              FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_credit_claim_events_organization_id ON credit_claim_events (organization_id);
            CREATE INDEX IF NOT EXISTS idx_credit_claim_events_claim_id ON credit_claim_events (claim_id);
          `);
        },
        down: (db: DB) => {
          db.exec(`
            DROP TABLE IF EXISTS credit_claim_events;
            DROP TABLE IF EXISTS credit_claim_photos;
            DROP TABLE IF EXISTS credit_claim_lines;
            DROP TABLE IF EXISTS credit_claims;
            DROP TABLE IF EXISTS suppliers;
          `);
          Logger.warn('Cannot drop products.supplier_id column in SQLite; leaving it in place');
        },
      },
      {
        id: 16,
        name: '016-add-brand-supplier-mapping',
        up: (db: DB) => {
          addColumnIfMissing(db, 'products', 'brand_id', 'INTEGER');
          addColumnIfMissing(
            db,
            'expired_item_transactions',
            'credit_disposition',
            "TEXT NOT NULL DEFAULT 'PENDING' CHECK (credit_disposition IN ('PENDING', 'DISPOSED'))",
          );

          db.exec(`
            CREATE TABLE IF NOT EXISTS brands (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              organization_id TEXT NOT NULL,
              name TEXT NOT NULL,
              manufacturer_name TEXT,
              suggested_supplier_name TEXT,
              supplier_id INTEGER,
              source TEXT NOT NULL DEFAULT 'REFERENCE'
                CHECK (source IN ('REFERENCE', 'USER_ADDED', 'CONFIRMED')),
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
              FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL,
              UNIQUE (organization_id, name)
            );
            CREATE INDEX IF NOT EXISTS idx_brands_organization_id ON brands (organization_id);
            CREATE INDEX IF NOT EXISTS idx_brands_supplier_id ON brands (supplier_id);
            CREATE INDEX IF NOT EXISTS idx_products_brand_id ON products (brand_id);

            CREATE TRIGGER IF NOT EXISTS brands_set_null_products_after_delete
            AFTER DELETE ON brands
            BEGIN
              UPDATE products SET brand_id = NULL WHERE brand_id = OLD.id;
            END;

            CREATE TABLE IF NOT EXISTS master_catalogue_entries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              barcode TEXT NOT NULL UNIQUE,
              description TEXT NOT NULL,
              api_sku TEXT,
              sigma_sku TEXT,
              ch2_sku TEXT,
              brand_name TEXT NOT NULL,
              manufacturer_name TEXT,
              category TEXT,
              sub_category TEXT,
              rrp REAL,
              metro_price REAL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_master_catalogue_entries_api_sku
              ON master_catalogue_entries (api_sku);
            CREATE INDEX IF NOT EXISTS idx_master_catalogue_entries_sigma_sku
              ON master_catalogue_entries (sigma_sku);
            CREATE INDEX IF NOT EXISTS idx_master_catalogue_entries_ch2_sku
              ON master_catalogue_entries (ch2_sku);

            CREATE TABLE IF NOT EXISTS catalogue_corrections (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              organization_id TEXT NOT NULL,
              product_id INTEGER,
              brand_id INTEGER,
              barcode TEXT,
              entered_brand_name TEXT,
              chosen_supplier_id INTEGER,
              kind TEXT NOT NULL
                CHECK (kind IN ('UNMATCHED', 'BRAND_ADDED', 'SUPPLIER_OVERRIDE')),
              status TEXT NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
              created_by_user_id INTEGER,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
              FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE SET NULL,
              FOREIGN KEY (brand_id) REFERENCES brands (id) ON DELETE SET NULL,
              FOREIGN KEY (chosen_supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL,
              FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS idx_catalogue_corrections_organization_id
              ON catalogue_corrections (organization_id);
            CREATE INDEX IF NOT EXISTS idx_catalogue_corrections_status
              ON catalogue_corrections (status);
            CREATE INDEX IF NOT EXISTS idx_catalogue_corrections_product_id
              ON catalogue_corrections (product_id);
            CREATE INDEX IF NOT EXISTS idx_catalogue_corrections_brand_id
              ON catalogue_corrections (brand_id);
            CREATE INDEX IF NOT EXISTS idx_expired_transactions_credit_disposition
              ON expired_item_transactions (credit_disposition);
          `);
        },
        down: (db: DB) => {
          db.exec(`
            DROP TABLE IF EXISTS catalogue_corrections;
            DROP TABLE IF EXISTS master_catalogue_entries;
            DROP TRIGGER IF EXISTS brands_set_null_products_after_delete;
            DROP TABLE IF EXISTS brands;
          `);
          Logger.warn(
            'SQLite rollback leaves products.brand_id and expired_item_transactions.credit_disposition in place',
          );
        },
      },
      {
        id: 17,
        name: '017-add-supplier-policy-fields',
        up: (db: DB) => {
          addColumnIfMissing(db, 'suppliers', 'representative_name', 'TEXT');
          addColumnIfMissing(db, 'suppliers', 'representative_email', 'TEXT');
          addColumnIfMissing(db, 'suppliers', 'contact_phone', 'TEXT');
          addColumnIfMissing(db, 'suppliers', 'policy_updated_at', 'TEXT');
          db.exec(`
            UPDATE suppliers
            SET policy_updated_at = updated_at
            WHERE policy_updated_at IS NULL
              AND trim(credit_policy_note) <> '';
          `);
        },
        down: () => {
          Logger.warn(
            'SQLite rollback leaves supplier policy columns in place because dropping columns is not portable',
          );
        },
      },
    ];
  }

  /**
   * Get the status of all migrations
   */
  public async getMigrationStatus(): Promise<{
    pending: Migration[];
    executed: MigrationRecord[];
  }> {
    const dbPath = envConfig.DATABASE_PATH || './database.sqlite';
    const db: DB = new Database(dbPath);

    try {
      this.migrationModel.ensureMigrationsTable(db);
      const executedMigrations = this.migrationModel.getExecutedMigrations(db);
      const allMigrations = await this.getMigrations();

      const executedNames = new Set(executedMigrations.map((m) => m.name));
      const pendingMigrations = allMigrations.filter((m) => !executedNames.has(m.name));

      return {
        pending: pendingMigrations,
        executed: executedMigrations,
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
    const db: DB = new Database(dbPath);

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
      const migrationToRollback = allMigrations.find((m) => m.name === lastMigration.name);

      if (!migrationToRollback || !migrationToRollback.down) {
        Logger.error(`Migration ${lastMigration.name} does not have a rollback function`);
        throw new Error(`Migration ${lastMigration.name} cannot be rolled back`);
      }

      Logger.info(`Rolling back migration: ${lastMigration.name}`);

      // Run the rollback in a transaction to ensure atomicity
      const transaction = (db as TransactionCapableDB).transaction(() => {
        migrationToRollback.down!(db);
      });

      transaction();

      // Remove the migration record
      this.migrationModel.removeMigrationRecord(db, lastMigration.name);

      Logger.info(`Migration ${lastMigration.name} rolled back successfully`);
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      Logger.error('Migration rollback failed:', { error: errorMsg });
      throw error;
    } finally {
      db.close();
    }
  }
}
