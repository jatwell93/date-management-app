import Database from 'better-sqlite3';
import { envConfig } from './config/environment';

export type DB = InstanceType<typeof Database>;

let db: DB;

export function getDb(): DB {
  if (!db) {
    db = new Database(envConfig.DATABASE_PATH || './database.sqlite');
  }
  return db;
}

export function releaseDb(_db: DB): void {
  // better-sqlite3 doesn't have connection pooling, so this is a no-op
}

export async function initDatabase() {
  // This function is now a no-op, as the database is initialized on first call to getDb()
}
