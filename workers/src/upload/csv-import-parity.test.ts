import { describe, expect, it } from 'vitest';
import { parseCsvRecords } from './csv-parser';
import { validateCatalogueRecords } from './catalogue-parser';
import { validateExpiryRecords } from './expiry-parser';

// Task 3.2 batch 4b. Each case answers an Express CSV test that had no Worker
// counterpart (backend/src/tests/unit/csv-edge-cases.test.ts, csv-parser.service.test.ts).
// They run through `parseCsvRecords` plus the two validators, which is the whole of
// the Worker's parse path before the database is touched.
const catalogue = (text: string) => validateCatalogueRecords(parseCsvRecords(text));
const expiry = (text: string) => validateExpiryRecords(parseCsvRecords(text));
const HEADER = 'SKU,Name,Barcode,Cost\n';

describe('CSV structure', () => {
  it('reports a file with only headers as having no rows', () => {
    expect(catalogue(HEADER).fatalErrors).toEqual(['No product rows found']);
    expect(expiry('SKU,Used-By Date\n').fatalErrors).toEqual(['No expiry rows found']);
  });

  it.each([
    ['an empty file', ''],
    ['a file of only whitespace and newlines', '  \n\n   \n'],
  ])('reports %s as having no rows', (_name, text) => {
    expect(catalogue(text).fatalErrors).toEqual(['No product rows found']);
    expect(catalogue(text).rows).toEqual([]);
  });

  it('skips blank lines between rows without counting them', () => {
    const result = catalogue(HEADER + 'A1,One,B1,1.00\n\n   ,  ,  ,  \nA2,Two,B2,2.00\n');

    expect(result.totalRows).toBe(2);
    expect(result.rows.map((r) => r.sku)).toEqual(['A1', 'A2']);
  });

  it('reads a UTF-8 file, with or without a byte-order mark', () => {
    const body = HEADER + 'A1,Café au lait,B1,3.50\n';

    expect(catalogue(body).rows[0].name).toBe('Café au lait');
    expect(catalogue('﻿' + body).rows[0]).toMatchObject({ sku: 'A1', name: 'Café au lait' });
    expect(catalogue('﻿' + body).fatalErrors).toEqual([]);
    // Header matching strips punctuation, so only the raw cell shows the mark was removed.
    expect(parseCsvRecords('﻿SKU,Name\n')[0][0]).toBe('SKU');
  });

  it.each([
    ['CRLF', '\r\n'],
    ['LF', '\n'],
    ['CR', '\r'],
  ])('reads %s line endings', (_name, eol) => {
    const text = ['SKU,Name,Barcode,Cost', 'A1,One,B1,1.00', 'A2,Two,B2,2.00'].join(eol) + eol;

    expect(catalogue(text).rows.map((r) => r.sku)).toEqual(['A1', 'A2']);
  });

  it('reads a file that mixes line endings', () => {
    const text = 'SKU,Name,Barcode,Cost\r\nA1,One,B1,1.00\nA2,Two,B2,2.00\rA3,Three,B3,3.00\r\n';

    expect(catalogue(text).rows.map((r) => r.sku)).toEqual(['A1', 'A2', 'A3']);
  });

  it('keeps commas, newlines and escaped quotes inside quoted fields', () => {
    const text =
      HEADER +
      'A1,"Salt, fine","B1",1.00\nA2,"Line one\nline two",B2,2.00\nA3,"Say ""hi""",B3,3.00\n';
    const result = catalogue(text);

    expect(result.rowErrors).toEqual([]);
    expect(result.rows.map((r) => r.name)).toEqual([
      'Salt, fine',
      'Line one\nline two',
      'Say "hi"',
    ]);
  });

  it('keeps ordinary special characters in a name', () => {
    const result = catalogue(HEADER + "A1,Ben & Jerry's 100% <new> #1 @home,B1,5.00\n");

    expect(result.rows[0].name).toBe("Ben & Jerry's 100% <new> #1 @home");
  });

  it('reads a thousand rows', () => {
    const lines = Array.from({ length: 1200 }, (_, i) => `S${i},Item ${i},B${i},${i}.50`);
    const result = catalogue(HEADER + lines.join('\n') + '\n');

    expect(result.totalRows).toBe(1200);
    expect(result.rows).toHaveLength(1200);
    expect(result.rowErrors).toEqual([]);
  });

  it('reads a file larger than 100KB', () => {
    const padding = 'x'.repeat(200);
    const lines = Array.from({ length: 600 }, (_, i) => `S${i},${padding} ${i},B${i},1.00`);
    const text = HEADER + lines.join('\n') + '\n';

    expect(text.length).toBeGreaterThan(100 * 1024);
    expect(catalogue(text).rows).toHaveLength(600);
  });
});

describe('catalogue headers', () => {
  it('matches headers case-insensitively and ignores spacing and punctuation', () => {
    const result = catalogue('sku, ITEM DESCRIPTION ,Barcode Number,unit_cost\nA1,One,B1,1.00\n');

    expect(result.fatalErrors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ sku: 'A1', name: 'One', barcode: 'B1', costPrice: 1 });
  });

  it('accepts Item Cost as the cost header', () => {
    expect(catalogue('SKU,Name,Barcode,Item Cost\nA1,One,B1,2.00\n').rows[0].costPrice).toBe(2);
  });

  it('ignores columns it does not know', () => {
    const result = catalogue('SKU,Name,Barcode,Cost,Shelf,Notes\nA1,One,B1,1.00,Top,"a, b"\n');

    expect(result.rowErrors).toEqual([]);
    expect(result.rows).toHaveLength(1);
  });

  it('names every missing required header', () => {
    expect(catalogue('SKU,Name\nA1,One\n').fatalErrors).toEqual([
      'Missing required column header(s): barcode, cost',
    ]);
  });

  it('keeps Retail Price out of the cost column and imports it separately', () => {
    const noCost = catalogue('SKU,Name,Barcode,Retail Price\nA1,One,B1,9.99\n');
    expect(noCost.fatalErrors).toEqual(['Missing required column header(s): cost']);

    const both = catalogue('SKU,Name,Barcode,Cost,Retail Price\nA1,One,B1,4.00,9.99\n');
    expect(both.rows[0]).toMatchObject({ costPrice: 4, retailPrice: 9.99 });
  });

  it('uses the first of two columns with the same header', () => {
    const result = catalogue('SKU,Name,Barcode,Name,Cost\nA1,First,B1,Second,1.00\n');

    expect(result.fatalErrors).toEqual([]);
    expect(result.rows[0].name).toBe('First');
  });
});

describe('catalogue rows', () => {
  it('rejects a row with a blank required field and keeps the valid rows', () => {
    const result = catalogue(HEADER + 'A1,,B1,1.00\nA2,Two,B2,2.00\nA3,   ,B3,3.00\nA4,Four,B4,\n');

    expect(result.rows.map((r) => r.sku)).toEqual(['A2']);
    expect(result.rowErrors).toEqual([
      'Row 2: Missing or malformed required product fields',
      'Row 4: Missing or malformed required product fields',
      'Row 5: Missing or malformed required product fields',
    ]);
  });

  it('rejects a cost that is not a number and keeps going', () => {
    const result = catalogue(HEADER + 'A1,One,B1,free\nA2,Two,B2,2.00\n');

    expect(result.rowErrors).toEqual(['Row 2: Missing or malformed required product fields']);
    expect(result.rows.map((r) => r.sku)).toEqual(['A2']);
  });

  it('reports a duplicate SKU in the file and keeps the first occurrence', () => {
    const result = catalogue(
      HEADER +
        'SKU001,Product 1,111,12.99\nSKU001,Product 1 Duplicate,222,15.99\nSKU002,Product 2,333,18.99\n',
    );

    expect(result.rows.map((r) => [r.sku, r.name])).toEqual([
      ['SKU001', 'Product 1'],
      ['SKU002', 'Product 2'],
    ]);
    expect(result.rowErrors).toEqual(['Row 3: Duplicate SKU or barcode in upload']);
  });

  it('treats SKUs that differ only in case as duplicates', () => {
    const result = catalogue(
      HEADER + 'sku001,Product 1,111,12.99\nSKU001,Product 1 Upper,222,15.99\n',
    );

    expect(result.rows.map((r) => r.sku)).toEqual(['sku001']);
    expect(result.rowErrors).toEqual(['Row 3: Duplicate SKU or barcode in upload']);
  });
});

describe('expiry-list rows', () => {
  it('needs only SKU and Used-By Date, and treats Item Description as optional', () => {
    const result = expiry('SKU,Used-By Date\nA1,12/12/26\n');

    expect(result.fatalErrors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      sku: 'A1',
      itemDescription: '',
      usedByDate: '2026-12-12',
    });
  });

  it('names a missing required header', () => {
    expect(expiry('SKU,Item Description\nA1,One\n').fatalErrors).toEqual([
      'Missing required column header(s): usedByDate',
    ]);
    expect(expiry('Item Description,Used-By Date\nOne,12/12/26\n').fatalErrors).toEqual([
      'Missing required column header(s): sku',
    ]);
  });

  it('matches expiry headers case-insensitively', () => {
    expect(expiry('sku,USED-BY DATE\nA1,12/12/26\n').rows).toHaveLength(1);
  });

  it('rejects a row with no SKU or no date and keeps the rest', () => {
    const result = expiry('SKU,Used-By Date\n,12/12/26\nA2,\nA3,12/12/26\n');

    expect(result.rows.map((r) => r.sku)).toEqual(['A3']);
    expect(result.rowErrors).toEqual([
      'Row 2: SKU is required and cannot be empty',
      'Row 3: Used-By Date is required and cannot be empty',
    ]);
  });
});
