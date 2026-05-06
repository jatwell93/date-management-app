import Database from 'better-sqlite3';
import { envConfig } from './config/environment';
import { Logger } from './utils/logger';

export type DB = InstanceType<typeof Database>;

let db: DB | undefined;

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

    // Verify security configuration on first connection
    verifyDatabaseSecurity();
  }
  return db;
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
  // This function is now a no-op, as the database is initialized on first call to getDb()
}
