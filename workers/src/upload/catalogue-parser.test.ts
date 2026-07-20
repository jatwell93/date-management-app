import { describe, expect, it } from 'vitest';
import { parseProductCatalogRow, validateCatalogueRecords } from './catalogue-parser';

describe('Worker catalogue parser', () => {
  it('accepts known product catalogue header aliases', () => {
    const result = validateCatalogueRecords([
      ['Item Code', 'Item Description', 'Cost Ex', 'Barcode'],
      ['619647', 'Nebuliser Tubing', '7.53', '9318766200185'],
    ]);

    expect(result.fatalErrors).toEqual([]);
    expect(result.rowErrors).toEqual([]);
    expect(result.totalRows).toBe(1);
    expect(result.rows[0]).toMatchObject({
      sku: '619647',
      name: 'Nebuliser Tubing',
      barcode: '9318766200185',
      costPrice: 7.53,
      rowNumber: 2,
    });
  });

  it('rejects rows with malformed required values', () => {
    const row = parseProductCatalogRow(['SKU-1', 'Milk', 'BAR-1', 'not-money'], {
      sku: 0,
      name: 1,
      barcode: 2,
      cost: 3,
    });

    expect(row).toBeNull();
  });
});
