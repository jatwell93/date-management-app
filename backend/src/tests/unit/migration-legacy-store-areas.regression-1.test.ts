import Database from 'better-sqlite3';
import { MigrationService, type Migration } from '../../migrations/migration.service';

async function storeAreaHierarchyMigration(): Promise<Migration> {
  const service = new MigrationService() as unknown as {
    getMigrations(): Promise<Migration[]>;
  };
  const migration = (await service.getMigrations()).find((candidate) => candidate.id === 12);
  if (!migration) throw new Error('SQLite migration 012 is missing');
  return migration;
}

describe('legacy store-area migration compatibility', () => {
  // Regression: ISSUE-QA-001 — migration 012 crashed on pre-tenant store_areas tables
  // Found by /qa on 2026-07-17
  // Report: Browser QA for enhance-supplier-policy-capture
  it('upgrades a legacy store_areas table without inventing tenant ownership', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE store_areas (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        sub_department TEXT,
        last_checked TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO store_areas (id, name, sub_department)
        VALUES (1, 'Legacy bay', 'Legacy department');
    `);

    const migration = await storeAreaHierarchyMigration();
    expect(() => migration.up(db)).not.toThrow();

    const columns = db.prepare('PRAGMA table_info(store_areas)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['organization_id', 'parent_id']),
    );
    expect(
      db.prepare('SELECT organization_id, parent_id FROM store_areas WHERE id = 1').get(),
    ).toEqual({ organization_id: null, parent_id: null });
    expect(db.prepare('SELECT COUNT(*) AS count FROM store_areas').get()).toEqual({ count: 1 });

    db.close();
  });
});
