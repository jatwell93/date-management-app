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

async function catalogueProvenanceMigration(): Promise<Migration> {
  const service = new MigrationService() as unknown as {
    getMigrations(): Promise<Migration[]>;
  };
  const migration = (await service.getMigrations()).find((candidate) => candidate.id === 19);
  if (!migration) throw new Error('SQLite migration 019 is missing');
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

  it.each(['prisma/schema.prisma', 'prisma/production/schema.prisma'])(
    '%s contains catalogue retirement and seed provenance',
    (relativePath) => {
      const schema = fs.readFileSync(path.join(backendRoot, relativePath), 'utf8');
      expect(schema).toContain('retiredAt');
      expect(schema).toContain('model CatalogueSeedRun {');
      expect(schema).toContain('version        Int      @unique');
      expect(schema).not.toContain('version        Int      @default(autoincrement())');
    },
  );

  it('ships catalogue provenance Neon migration 0009 and rollback', () => {
    const forward = fs.readFileSync(
      path.join(backendRoot, 'prisma/neon-sql/0009_add_catalogue_provenance.sql'),
      'utf8',
    );
    const rollback = fs.readFileSync(
      path.join(backendRoot, 'prisma/neon-sql/0009_add_catalogue_provenance_rollback.sql'),
      'utf8',
    );
    expect(forward).toContain('ADD COLUMN IF NOT EXISTS retired_at');
    expect(forward).toContain('CREATE TABLE IF NOT EXISTS catalogue_seed_runs');
    expect(forward).toContain('UNIQUE');
    expect(rollback).toContain('DROP TABLE IF EXISTS catalogue_seed_runs');
    expect(rollback).toContain('DROP COLUMN IF EXISTS retired_at');
  });

  it('applies and reverses SQLite migration 019 without losing catalogue rows', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE master_catalogue_entries (
        id INTEGER PRIMARY KEY,
        barcode TEXT NOT NULL UNIQUE
      );
      INSERT INTO master_catalogue_entries (id, barcode) VALUES (1, '9300000000001');
    `);

    const migration = await catalogueProvenanceMigration();
    migration.up(db);
    expect(() => migration.up(db)).not.toThrow();
    expect(
      db.prepare('SELECT barcode, retired_at FROM master_catalogue_entries WHERE id = 1').get(),
    ).toEqual({ barcode: '9300000000001', retired_at: null });
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get('catalogue_seed_runs'),
    ).toEqual({ name: 'catalogue_seed_runs' });

    migration.down?.(db);
    expect(db.prepare('SELECT barcode FROM master_catalogue_entries WHERE id = 1').get()).toEqual({
      barcode: '9300000000001',
    });
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get('catalogue_seed_runs'),
    ).toBeUndefined();
    db.close();
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
