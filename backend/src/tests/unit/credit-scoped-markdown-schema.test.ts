import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  calculateMarkdownPrice,
  type MarkdownMatrixConfig,
} from '../../../../shared/domain/markdown';
import { MigrationService, type Migration } from '../../migrations/migration.service';

const backendRoot = path.resolve(__dirname, '../../..');
const migrationRoot = path.resolve(backendRoot, '../database/migrations');

async function scopedMarkdownMigration(): Promise<Migration> {
  const service = new MigrationService() as unknown as {
    getMigrations(): Promise<Migration[]>;
  };
  const migration = (await service.getMigrations()).find((candidate) => candidate.id === 18);
  if (!migration) throw new Error('SQLite migration 018 is missing');
  return migration;
}

describe('credit-scoped markdown schema parity', () => {
  it.each(['prisma/schema.prisma', 'prisma/production/schema.prisma'])(
    '%s models plural scoped configs and supplier credit type',
    (relativePath) => {
      const schema = fs.readFileSync(path.join(backendRoot, relativePath), 'utf8');
      expect(schema).toContain('markdownConfigs');
      expect(schema).toMatch(
        /creditScope\s+String\s+@default\("NO_CREDIT"\)\s+@map\("credit_scope"\)/,
      );
      expect(schema).toContain('@@unique([organizationId, creditScope])');
      expect(schema).toMatch(/creditType\s+String\s+@default\("NONE"\)\s+@map\("credit_type"\)/);
    },
  );

  it('ships constrained forward migration and duplicate-safe rollback', () => {
    const forward = fs.readFileSync(
      path.join(migrationRoot, '0008_add_credit_scoped_markdown_matrix.up.sql'),
      'utf8',
    );
    const rollback = fs.readFileSync(
      path.join(migrationRoot, '0008_add_credit_scoped_markdown_matrix.down.sql'),
      'utf8',
    );
    expect(forward).toMatch(/credit_type[\s\S]+CHECK[\s\S]+NONE[\s\S]+FULL_CREDIT/i);
    expect(forward).toMatch(/credit_scope[\s\S]+CHECK[\s\S]+NO_CREDIT[\s\S]+FULL_CREDIT/i);
    expect(forward).toMatch(/UNIQUE\s*\(organization_id,\s*credit_scope\)/i);
    expect(
      rollback.indexOf(
        "DELETE FROM organization_markdown_config WHERE credit_scope = 'FULL_CREDIT'",
      ),
    ).toBeLessThan(rollback.indexOf('UNIQUE (organization_id)'));
  });

  it('preserves legacy data and prices while enforcing scoped uniqueness and enums', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE organizations (id TEXT PRIMARY KEY);
      INSERT INTO organizations (id) VALUES ('org-1');
      CREATE TABLE suppliers (
        id INTEGER PRIMARY KEY,
        organization_id TEXT NOT NULL,
        name TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO suppliers (id, organization_id, name, updated_at)
        VALUES (1, 'org-1', 'Supplier', '2026-07-01T00:00:00.000Z');
      CREATE TABLE organization_markdown_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL UNIQUE,
        band1_percentage REAL NOT NULL,
        band2_percentage REAL NOT NULL,
        band3_percentage REAL NOT NULL,
        band1_basis TEXT NOT NULL,
        band2_basis TEXT NOT NULL,
        band3_basis TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX idx_organization_markdown_config_org_id
        ON organization_markdown_config (organization_id);
      INSERT INTO organization_markdown_config VALUES
        (1, 'org-1', 40, 55, 70, 'cost', 'retail', 'cost',
         '2026-06-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z');
    `);

    const before: MarkdownMatrixConfig = {
      band1: { percentage: 40, basis: 'cost' },
      band2: { percentage: 55, basis: 'retail' },
      band3: { percentage: 70, basis: 'cost' },
    };
    const beforePrice = calculateMarkdownPrice({ costPrice: 10, retailPrice: 20 }, 45, before);

    const migration = await scopedMarkdownMigration();
    migration.up(db);
    expect(() => migration.up(db)).not.toThrow();

    expect(
      db.prepare('SELECT * FROM organization_markdown_config WHERE id = 1').get(),
    ).toMatchObject({
      organization_id: 'org-1',
      credit_scope: 'NO_CREDIT',
      band1_percentage: 40,
      band2_percentage: 55,
      band3_percentage: 70,
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-07-01T00:00:00.000Z',
    });
    expect(db.prepare('SELECT credit_type FROM suppliers WHERE id = 1').get()).toEqual({
      credit_type: 'NONE',
    });
    expect(calculateMarkdownPrice({ costPrice: 10, retailPrice: 20 }, 45, before)).toBe(
      beforePrice,
    );

    db.prepare(
      `
      INSERT INTO organization_markdown_config (
        organization_id, credit_scope, band1_percentage, band2_percentage, band3_percentage,
        band1_basis, band2_basis, band3_basis, created_at, updated_at
      ) VALUES ('org-1', 'FULL_CREDIT', 20, 20, 20, 'cost', 'cost', 'cost', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO organization_markdown_config (
        organization_id, credit_scope, band1_percentage, band2_percentage, band3_percentage,
        band1_basis, band2_basis, band3_basis, created_at, updated_at
      ) VALUES ('org-1', 'FULL_CREDIT', 20, 20, 20, 'cost', 'cost', 'cost', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        )
        .run(),
    ).toThrow();
    expect(() =>
      db.prepare("UPDATE suppliers SET credit_type = 'PARTIAL' WHERE id = 1").run(),
    ).toThrow();
    expect(() =>
      db
        .prepare("UPDATE organization_markdown_config SET credit_scope = 'UNKNOWN' WHERE id = 1")
        .run(),
    ).toThrow();
    db.close();
  });
});
