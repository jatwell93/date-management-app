import { describe, expect, it } from 'vitest';
import { parseCsvRecords } from './csv-parser';

describe('Worker upload CSV parser', () => {
  it('preserves quoted commas and escaped quotes', () => {
    const records = parseCsvRecords('SKU,Name\nS1,"Milk, ""full cream"""\n');

    expect(records).toEqual([
      ['SKU', 'Name'],
      ['S1', 'Milk, "full cream"'],
    ]);
  });

  it('ignores blank records and strips a UTF-8 BOM', () => {
    const records = parseCsvRecords('\uFEFFSKU,Name\r\n\r\nS1,Milk\r\n');

    expect(records).toEqual([
      ['SKU', 'Name'],
      ['S1', 'Milk'],
    ]);
  });
});
