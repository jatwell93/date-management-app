import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MigrationService, type Migration } from '../../migrations/migration.service';

const backendRoot = path.resolve(__dirname, '../../..');

async function brandMigration(): Promise<Migration> {
  const service = new MigrationService() as unknown as {
    getMigrations(): Promise<Migration[]>;
  };
  const migration = (await service.getMigrations()).find((candidate) => candidate.id === 16);
  if (!migration) throw new Error('SQLite migration 016 is missing');
  return migration;
}

describe('brand-supplier schema parity', () => {
  it.each(['prisma/schema.prisma', 'prisma/production/schema.prisma'])(
    '%s contains the shared brand, catalogue, correction, and disposal shape',
    (relativePath) => {
      const schema = fs.readFileSync(path.join(backendRoot, relativePath), 'utf8');
      expect(schema).toContain('model Brand {');
      expect(schema).toContain('suggestedSupplierName');
      expect(schema).toContain('model MasterCatalogueEntry {');
      expect(schema).toContain('model CatalogueCorrection {');
      expect(schema).toContain('brandId');
      expect(schema).toContain('creditDisposition');
    },
  );

  it('ships a forward and rollback Neon migration', () => {
    const forward = fs.readFileSync(
      path.join(backendRoot, 'prisma/neon-sql/0006_add_brand_supplier_mapping.sql'),
      'utf8',
    );
    const rollback = fs.readFileSync(
      path.join(backendRoot, 'prisma/neon-sql/0006_add_brand_supplier_mapping_rollback.sql'),
      'utf8',
    );
    expect(forward).toContain('CREATE TABLE IF NOT EXISTS brands');
    expect(forward).toContain('CREATE TABLE IF NOT EXISTS master_catalogue_entries');
    expect(forward).toContain('CREATE TABLE IF NOT EXISTS catalogue_corrections');
    expect(forward).toContain('credit_disposition');
    expect(rollback).toContain('DROP TABLE IF EXISTS catalogue_corrections');
    expect(rollback).toContain('DROP TABLE IF EXISTS master_catalogue_entries');
    expect(rollback).toContain('DROP TABLE IF EXISTS brands');
  });

  it('applies SQLite migration 016 repeatedly and enforces tenant FK behavior', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE organizations (id TEXT PRIMARY KEY);
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE suppliers (
        id INTEGER PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
      );
      CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
      );
      CREATE TABLE expired_item_transactions (
        id INTEGER PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
      );
    `);

    const migration = await brandMigration();
    migration.up(db);
    expect(() => migration.up(db)).not.toThrow();

    const productColumns = db.prepare('PRAGMA table_info(products)').all() as Array<{
      name: string;
    }>;
    const transactionColumns = db
      .prepare('PRAGMA table_info(expired_item_transactions)')
      .all() as Array<{ name: string }>;
    expect(productColumns.map((column) => column.name)).toContain('brand_id');
    expect(transactionColumns.map((column) => column.name)).toContain('credit_disposition');

    db.exec(`
      INSERT INTO organizations (id) VALUES ('org-a');
      INSERT INTO suppliers (id, organization_id) VALUES (1, 'org-a');
      INSERT INTO brands (id, organization_id, name, supplier_id, source)
        VALUES (1, 'org-a', 'Blackmores', 1, 'CONFIRMED');
      INSERT INTO products (id, organization_id, brand_id) VALUES (1, 'org-a', 1);
    `);
    db.prepare('DELETE FROM suppliers WHERE id = 1').run();
    expect(db.prepare('SELECT supplier_id FROM brands WHERE id = 1').get()).toEqual({
      supplier_id: null,
    });
    db.prepare("DELETE FROM organizations WHERE id = 'org-a'").run();
    expect(db.prepare('SELECT COUNT(*) AS count FROM brands').get()).toEqual({ count: 0 });
    db.close();
  });
});
