import { Database as DB } from 'better-sqlite3';
import { envConfig } from '../config/environment';
import { Logger } from '../utils/logger';

/**
 * Model for tracking migration status in the database
 */
export interface MigrationRecord {
  id: number;
  name: string;
  executed_at: string;
}

/**
 * Migration model to handle database operations related to migrations
 */
export class MigrationModel {
  private dbPath: string;

  constructor() {
    this.dbPath = envConfig.DATABASE_PATH || './database.sqlite';
  }

  /**
   * Create the migrations table if it doesn't exist
   */
  public ensureMigrationsTable(db: DB): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        executed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    Logger.info('Migrations table ensured');
  }

  /**
   * Check if a migration with the given name has already been executed
   */
  public hasMigrationExecuted(db: DB, migrationName: string): boolean {
    const result = db.prepare('SELECT id FROM migrations WHERE name = ?').get(migrationName);
    return !!result;
  }

  /**
   * Get all executed migrations
   */
  public getExecutedMigrations(db: DB): MigrationRecord[] {
    return db.prepare('SELECT id, name, executed_at FROM migrations ORDER BY id').all() as MigrationRecord[];
  }

  /**
   * Mark a migration as executed
   */
  public markMigrationExecuted(db: DB, id: number, name: string): void {
    db.prepare('INSERT INTO migrations (id, name) VALUES (?, ?)').run(id, name);
    Logger.info(`Migration marked as executed: ${name} (ID: ${id})`);
  }

  /**
   * Remove a migration record (useful for rollback operations)
   */
  public removeMigrationRecord(db: DB, migrationName: string): void {
    db.prepare('DELETE FROM migrations WHERE name = ?').run(migrationName);
    Logger.info(`Migration record removed: ${migrationName}`);
  }
}
