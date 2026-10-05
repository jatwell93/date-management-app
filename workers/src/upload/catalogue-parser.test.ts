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

  // Task 3.2 batch 4. The Worker used to drop every character that was not a digit,
  // dot or minus, so "12,50" became 1250 and "(12.50)" became +12.5. Cost cells now
  // go through the same parser Express used (`shared/domain/product-import-cost.ts`).
  it.each([
    ['12,50', 12.5],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['$7.53', 7.53],
    ['(12.50)', -12.5],
    ['AUD 7.53', 7.53],
  ])('reads the cost cell %s as %d', (cell, expected) => {
    const result = validateCatalogueRecords([
      ['SKU', 'Name', 'Cost', 'Barcode'],
      ['SKU-1', 'Milk', cell, 'BAR-1'],
    ]);

    expect(result.rows[0]?.costPrice).toBe(expected);
  });

  it('reads an optional retail price with the same rules', () => {
    const result = validateCatalogueRecords([
      ['SKU', 'Name', 'Cost', 'Retail Price', 'Barcode'],
      ['SKU-1', 'Milk', '4,20', '€1.234,56', 'BAR-1'],
    ]);

    expect(result.rows[0]).toMatchObject({ costPrice: 4.2, retailPrice: 1234.56 });
  });
});
