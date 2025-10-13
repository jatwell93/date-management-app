import Database from 'better-sqlite3';
import { envConfig } from './config/environment';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(envConfig.DATABASE_PATH || './database.sqlite');
  }
  return db;
}

export function releaseDb(db: Database.Database): void {
  // better-sqlite3 doesn't have connection pooling, so this is a no-op
}

export async function initDatabase() {
  // This function is now a no-op, as the database is initialized on first call to getDb()
}
