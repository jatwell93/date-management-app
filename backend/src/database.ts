import Database from 'better-sqlite3';
import { envConfig } from './config/environment';
import { Logger } from './utils/logger';

export type DB = InstanceType<typeof Database>;

let db: DB | undefined;
const DEFAULT_ORGANIZATION_ID = 'default-org';

interface TableInfoRow {
  name: string;
}

function hasDatabaseSchemaApi(database: unknown): database is DB {
  if (!database || typeof database !== 'object') {
    return false;
  }

  const candidate = database as Record<string, unknown>;
  return typeof candidate.exec === 'function' && typeof candidate.prepare === 'function';
}

/**
 * Verify TLS/SSL configuration for database connections
 * Task 5.2: Add TLS verification check and logging
 */
function verifyDatabaseSecurity(): void {
  const { DATABASE_PROVIDER, DATABASE_URL, NODE_ENV } = envConfig;

  // For PostgreSQL in production, verify SSL/TLS is enforced
  if (DATABASE_PROVIDER === 'postgresql') {
    if (!DATABASE_URL) {
      Logger.warn('DATABASE_URL not configured for PostgreSQL');
      return;
    }

    const hasSSLMode =
      DATABASE_URL.includes('sslmode=require') || DATABASE_URL.includes('sslmode=verify-full');

    if (NODE_ENV === 'production' && !hasSSLMode) {
      Logger.error('⚠️  SECURITY WARNING: DATABASE_URL missing sslmode=require in production!');
      Logger.error('   Add ?sslmode=require to DATABASE_URL for encrypted connections');
    } else if (hasSSLMode) {
      Logger.info('✅ Database TLS/SSL: Enabled (sslmode detected in connection string)');
    } else {
      Logger.info(`ℹ️  Database TLS/SSL: Not enforced (${NODE_ENV} environment)`);
    }
  } else if (DATABASE_PROVIDER === 'sqlite') {
    Logger.info('ℹ️  Database: SQLite (local file, TLS/SSL not applicable)');
  } else {
    Logger.info(`ℹ️  Database Provider: ${DATABASE_PROVIDER}`);
  }
}

export function getDb(): DB {
  if (!db) {
    db = new Database(envConfig.DATABASE_PATH || './database.sqlite');
    ensureSqliteSchema(db);

    // Verify security configuration on first connection
    verifyDatabaseSecurity();
  }
  return db;
}

function hasColumn(database: DB, tableName: string, columnName: string): boolean {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all() as TableInfoRow[];
  return columns.some((column) => column.name === columnName);
}

function addOrganizationColumnIfMissing(database: DB, tableName: string): void {
  if (!hasColumn(database, tableName, 'organization_id')) {
    database
      .prepare(
        `ALTER TABLE ${tableName} ADD COLUMN organization_id TEXT NOT NULL DEFAULT '${DEFAULT_ORGANIZATION_ID}'`,
      )
      .run();
  }
}

function ensureSqliteSchema(database: DB): void {
  if (!hasDatabaseSchemaApi(database)) {
    return;
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL DEFAULT '${DEFAULT_ORGANIZATION_ID}',
      barcode TEXT UNIQUE NOT NULL,
      sku TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      cost_price REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL DEFAULT '${DEFAULT_ORGANIZATION_ID}',
      product_id INTEGER NOT NULL,
      expiry_date TEXT NOT NULL,
      location_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'Normal',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products (id),
      FOREIGN KEY (location_id) REFERENCES store_areas (id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL DEFAULT '${DEFAULT_ORGANIZATION_ID}',
      user_id INTEGER NOT NULL,
      inventory_item_id INTEGER NOT NULL,
      change_description TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id),
      FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id)
    );
  `);

  addOrganizationColumnIfMissing(database, 'products');
  addOrganizationColumnIfMissing(database, 'inventory_items');
  addOrganizationColumnIfMissing(database, 'audit_log');
}

export function releaseDb(_db: DB): void {
  // better-sqlite3 doesn't have connection pooling, so this is a no-op
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}

export async function initDatabase() {
  getDb();
}
