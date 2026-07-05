import { describe, expect, it } from 'vitest';
import { parseCsvRecords } from './csv-parser';
import { validateExpiryRecords } from './expiry-parser';

function parse(csv: string) {
  return validateExpiryRecords(parseCsvRecords(csv));
}

describe('validateExpiryRecords (worker)', () => {
  it('accepts the canonical expiry template headers', () => {
    const result = parse(
      'SKU,Item Description,Used-By Date,Department\n1001,Vitamin C,12/12/26,Vitamins\n',
    );

    expect(result.fatalErrors).toEqual([]);
    expect(result.rowErrors).toEqual([]);
    expect(result.totalRows).toBe(1);
    expect(result.rows).toEqual([
      {
        sku: '1001',
        itemDescription: 'Vitamin C',
        usedByDate: '2026-12-12',
        department: 'Vitamins',
        rowNumber: 2,
      },
    ]);
  });

  it('matches alias headers (Item Code / Expiry) and treats department as optional', () => {
    const result = parse('Item Code,Expiry\n1001,12/2026\n');

    expect(result.fatalErrors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      sku: '1001',
      usedByDate: '2026-12-31',
      department: undefined,
    });
  });

  // Regression for #251: an expiry file with only SKU + Used-By Date must NOT be
  // rejected for missing barcode/cost (those belong to product-catalog imports).
  it('does not require barcode or cost columns', () => {
    const result = parse('SKU,Used-By Date\n1001,12/12/26\n');

    expect(result.fatalErrors).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });

  it('reports missing required headers as a fatal error', () => {
    const result = parse('Name,Cost\nWidget,1.99\n');

    expect(result.fatalErrors).toEqual(['Missing required column header(s): sku, usedByDate']);
    expect(result.rows).toEqual([]);
  });

  it('collects per-row errors for unparseable dates without failing the whole file', () => {
    const result = parse('SKU,Used-By Date\n1001,12/12/26\n1002,not-a-date\n');

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].sku).toBe('1001');
    expect(result.rowErrors).toHaveLength(1);
    expect(result.rowErrors[0]).toContain('Row 3');
  });

  it('rejects rows missing a SKU value', () => {
    const result = parse('SKU,Used-By Date\n,12/12/26\n');

    expect(result.rows).toEqual([]);
    expect(result.rowErrors[0]).toContain('SKU is required');
  });
});
