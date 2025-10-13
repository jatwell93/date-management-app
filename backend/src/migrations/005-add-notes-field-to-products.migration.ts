import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { Migration } from './migration.service';

/**
 * Example migration to add a notes field to products
 */
export const addNotesToProductsMigration: Migration = {
  id: 5,
  name: '005-add-notes-field-to-products',
  up: (db: DatabaseType) => {
    // Add a notes column to the products table
    const tableInfo = (db as any).pragma('table_info(products)') as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;
    const hasNotesColumn = tableInfo.some((column) => column.name === 'notes');
    
    if (!hasNotesColumn) {
      db.exec("ALTER TABLE products ADD COLUMN notes TEXT DEFAULT ''");
      console.log("Added notes column to products table");
    }
  },
  down: (db: DatabaseType) => {
    // Note: SQLite doesn't support dropping columns directly
    // In a real scenario, you would need to recreate the table
    console.log("Skipping rollback for adding notes column (SQLite doesn't support dropping columns)");
  }
};