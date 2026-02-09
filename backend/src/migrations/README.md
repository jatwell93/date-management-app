# Database Migrations

This directory contains the database migration system for the application. The system allows for version-controlled database schema changes.

## Overview

The migration system provides:

- Version-controlled database schema changes
- Tracking of which migrations have been applied
- Rollback capabilities for development
- Atomic migration execution (each migration runs in a transaction)

## Migration Structure

Each migration is defined with:

- An ID (integer)
- A name (unique string identifier)
- An `up` function to apply the migration
- An optional `down` function to rollback the migration

## Using Migrations

### Running Migrations

To run all pending migrations:

```bash
cd backend
npm run migrate
```

### Checking Migration Status

To see which migrations have been applied and which are pending:

```bash
cd backend
npm run migrate:status
```

### Rolling Back a Migration

To rollback the last applied migration:

```bash
cd backend
npm run migrate:rollback
```

## Adding New Migrations

To add a new migration, you have two options:

### Option 1: Add to the main migration service

Edit `src/migrations/migration.service.ts` and add a new migration to the array in the `getMigrations` method.

### Option 2: Create a separate migration file

Create a new file with the naming pattern `NNN-migration-name.migration.ts` in the migrations directory:

```typescript
import Database from 'better-sqlite3';
import { Migration } from './migration.service';

export const newMigration: Migration = {
  id: 5, // Next sequential ID
  name: '005-add-new-feature-table',
  up: (db: Database.Database) => {
    // Apply schema changes
    db.exec(`
      CREATE TABLE new_table (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );
    `);
  },
  down: (db: Database.Database) => {
    // Rollback schema changes
    db.exec(`DROP TABLE IF EXISTS new_table;`);
  },
};
```

Then import and add it to the array in `migration.service.ts`.

Here's another example that checks if a column exists before adding it:

```typescript
import Database from 'better-sqlite3';
import { Migration } from './migration.service';

export const addNotesToProductsMigration: Migration = {
  id: 6, // Next sequential ID
  name: '006-add-notes-field-to-products',
  up: (db: Database.Database) => {
    // Add a notes column to the products table
    const tableInfo = db.prepare('PRAGMA table_info(products)').all();
    const hasNotesColumn = tableInfo.some((column: any) => column.name === 'notes');

    if (!hasNotesColumn) {
      db.exec("ALTER TABLE products ADD COLUMN notes TEXT DEFAULT ''");
      console.log('Added notes column to products table');
    }
  },
  down: (db: Database.Database) => {
    // Note: SQLite doesn't support dropping columns directly
    // In a real scenario, you would need to recreate the table
    console.log(
      "Skipping rollback for adding notes column (SQLite doesn't support dropping columns)",
    );
  },
};
```

## Best Practices

1. Always write both `up` and `down` functions when possible
2. Use transactions for complex operations to ensure atomicity
3. Test migrations on a copy of production data when possible
4. Keep migrations small and focused on a single purpose
5. Update the `id` field sequentially - each migration should have a unique ID
6. Use descriptive names that indicate the purpose of the migration
7. Check for the existence of tables/columns before creating them to make migrations idempotent
