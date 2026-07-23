import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  calculateMarkdownPrice,
  type MarkdownBasis,
  type MarkdownableItem,
} from '../../shared/domain/markdown';

// Price a sample item using a band3 (0-30 day) config. 15 days lands squarely in
// band3, so calculateMarkdownPrice resolves the band3 percentage/basis; the other
// bands are irrelevant here and mirror band3 only to satisfy the matrix shape.
const SAMPLE_ITEM: MarkdownableItem = { costPrice: 20, retailPrice: 30 };
function band3Price(percentage: number, basis: MarkdownBasis): number | null {
  const band = { percentage, basis };
  return calculateMarkdownPrice(SAMPLE_ITEM, 15, {
    band1: band,
    band2: band,
    band3: band,
  });
}

const forwardPath = fileURLToPath(
  new URL(
    '../../backend/prisma/neon-sql/0008_add_credit_scoped_markdown_matrix.sql',
    import.meta.url,
  ),
);
const rollbackPath = fileURLToPath(
  new URL(
    '../../backend/prisma/neon-sql/0008_add_credit_scoped_markdown_matrix_rollback.sql',
    import.meta.url,
  ),
);

describe('Neon credit-scoped markdown migration', () => {
  let pg: PGlite | undefined;

  afterEach(async () => pg?.close());

  it('preserves the legacy matrix, constrains scoped rows, and rolls back safely', async () => {
    pg = new PGlite();
    await pg.exec(`
      CREATE TABLE suppliers (
        id serial PRIMARY KEY,
        organization_id text NOT NULL,
        name text NOT NULL
      );
      CREATE TABLE organization_markdown_config (
        id serial PRIMARY KEY,
        organization_id text NOT NULL UNIQUE,
        band1_percentage double precision NOT NULL,
        band2_percentage double precision NOT NULL,
        band3_percentage double precision NOT NULL,
        band1_basis text NOT NULL,
        band2_basis text NOT NULL,
        band3_basis text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO suppliers (organization_id, name) VALUES ('org-1', 'Legacy Supplier');
      INSERT INTO organization_markdown_config (
        organization_id,
        band1_percentage, band2_percentage, band3_percentage,
        band1_basis, band2_basis, band3_basis
      ) VALUES ('org-1', 41, 62, 83, 'cost', 'retail', 'cost');
    `);

    const before = await pg.query<{
      band3_percentage: number;
      band3_basis: 'cost' | 'retail';
    }>(
      'SELECT band3_percentage, band3_basis FROM organization_markdown_config WHERE organization_id = $1',
      ['org-1'],
    );
    const priceBefore = band3Price(before.rows[0].band3_percentage, before.rows[0].band3_basis);

    await pg.exec(await readFile(forwardPath, 'utf8'));

    await expect(
      pg.query(`SELECT credit_type FROM suppliers WHERE organization_id = 'org-1'`),
    ).resolves.toMatchObject({ rows: [{ credit_type: 'NONE' }] });
    const migrated = await pg.query<{
      credit_scope: string;
      band1_percentage: number;
      band2_percentage: number;
      band3_percentage: number;
      band1_basis: string;
      band2_basis: string;
      band3_basis: 'cost' | 'retail';
    }>(`SELECT * FROM organization_markdown_config WHERE organization_id = 'org-1'`);
    expect(migrated.rows).toMatchObject([
      {
        credit_scope: 'NO_CREDIT',
        band1_percentage: 41,
        band2_percentage: 62,
        band3_percentage: 83,
        band1_basis: 'cost',
        band2_basis: 'retail',
        band3_basis: 'cost',
      },
    ]);
    expect(band3Price(migrated.rows[0].band3_percentage, migrated.rows[0].band3_basis)).toBe(
      priceBefore,
    );

    await pg.exec(`
      INSERT INTO organization_markdown_config (
        organization_id, credit_scope,
        band1_percentage, band2_percentage, band3_percentage,
        band1_basis, band2_basis, band3_basis
      ) VALUES ('org-1', 'FULL_CREDIT', 20, 20, 20, 'cost', 'cost', 'cost');
    `);
    await expect(
      pg.exec(`
        INSERT INTO organization_markdown_config (
          organization_id, credit_scope,
          band1_percentage, band2_percentage, band3_percentage,
          band1_basis, band2_basis, band3_basis
        ) VALUES ('org-1', 'FULL_CREDIT', 10, 10, 10, 'cost', 'cost', 'cost');
      `),
    ).rejects.toThrow();
    await expect(pg.exec(`UPDATE suppliers SET credit_type = 'UNKNOWN'`)).rejects.toThrow();

    await expect(
      pg.exec(`
          INSERT INTO organization_markdown_config (
            organization_id, credit_scope,
            band1_percentage, band2_percentage, band3_percentage,
            band1_basis, band2_basis, band3_basis
          ) VALUES
            ('org-atomic', 'NO_CREDIT', 50, 60, 75, 'cost', 'cost', 'cost'),
            ('org-atomic', 'INVALID', 20, 20, 20, 'cost', 'cost', 'cost')
          ON CONFLICT (organization_id, credit_scope) DO UPDATE SET
            band1_percentage = EXCLUDED.band1_percentage
        `),
    ).rejects.toThrow();
    await expect(
      pg.query(
        `SELECT credit_scope FROM organization_markdown_config WHERE organization_id = 'org-atomic'`,
      ),
    ).resolves.toMatchObject({ rows: [] });

    await pg.exec(await readFile(rollbackPath, 'utf8'));

    await expect(
      pg.query(`SELECT organization_id FROM organization_markdown_config`),
    ).resolves.toMatchObject({ rows: [{ organization_id: 'org-1' }] });
    const configColumns = await pg.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'organization_markdown_config'
    `);
    expect(configColumns.rows.map((row) => row.column_name)).not.toContain('credit_scope');
    const supplierColumns = await pg.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'suppliers'
    `);
    expect(supplierColumns.rows.map((row) => row.column_name)).not.toContain('credit_type');
  }, 30_000);
});
