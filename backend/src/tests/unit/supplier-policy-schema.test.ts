import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MigrationService, type Migration } from '../../migrations/migration.service';

const backendRoot = path.resolve(__dirname, '../../..');
const migrationRoot = path.resolve(backendRoot, '../database/migrations');

async function supplierPolicyMigration(): Promise<Migration> {
  const service = new MigrationService() as unknown as {
    getMigrations(): Promise<Migration[]>;
  };
  const migration = (await service.getMigrations()).find((candidate) => candidate.id === 17);
  if (!migration) throw new Error('SQLite migration 017 is missing');
  return migration;
}

describe('supplier policy schema parity', () => {
  it.each(['prisma/schema.prisma', 'prisma/production/schema.prisma'])(
    '%s contains every supplier policy field',
    (relativePath) => {
      const schema = fs.readFileSync(path.join(backendRoot, relativePath), 'utf8');
      expect(schema).toContain('representativeName');
      expect(schema).toContain('representativeEmail');
      expect(schema).toContain('contactPhone');
      expect(schema).toContain('policyUpdatedAt');
    },
  );

  it('ships forward and rollback Neon migrations with a conditional backfill', () => {
    const forward = fs.readFileSync(
      path.join(migrationRoot, '0007_add_supplier_policy_fields.up.sql'),
      'utf8',
    );
    const rollback = fs.readFileSync(
      path.join(migrationRoot, '0007_add_supplier_policy_fields.down.sql'),
      'utf8',
    );

    expect(forward).toContain('representative_name');
    expect(forward).toContain('representative_email');
    expect(forward).toContain('contact_phone');
    expect(forward).toContain('policy_updated_at');
    expect(forward).toMatch(/trim\(credit_policy_note\)\s*<>\s*''/i);
    expect(forward).toMatch(/policy_updated_at\s*=\s*updated_at/i);
    expect(rollback).toContain('DROP COLUMN IF EXISTS policy_updated_at');
    expect(rollback).toContain('DROP COLUMN IF EXISTS contact_phone');
  });

  it('applies SQLite migration 017 repeatedly and backfills only real policies', async () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE suppliers (
        id INTEGER PRIMARY KEY,
        credit_policy_note TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
      INSERT INTO suppliers (id, credit_policy_note, updated_at) VALUES
        (1, 'Return monthly', '2026-07-01T00:00:00.000Z'),
        (2, '   ', '2026-07-02T00:00:00.000Z'),
        (3, '', '2026-07-03T00:00:00.000Z');
    `);

    const migration = await supplierPolicyMigration();
    migration.up(db);
    expect(() => migration.up(db)).not.toThrow();

    const columns = db.prepare('PRAGMA table_info(suppliers)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'representative_name',
        'representative_email',
        'contact_phone',
        'policy_updated_at',
      ]),
    );
    expect(db.prepare('SELECT id, policy_updated_at FROM suppliers ORDER BY id').all()).toEqual([
      { id: 1, policy_updated_at: '2026-07-01T00:00:00.000Z' },
      { id: 2, policy_updated_at: null },
      { id: 3, policy_updated_at: null },
    ]);
    db.close();
  });
});
