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

  // Task 3.2 batch 6. Express's parser could emit an error event and the import then failed
  // ("rejects when CSV parser emits error"). This parser cannot throw: an unterminated quote
  // swallows the rest of the file into one field, and row validation then rejects the row.
  it('does not throw on an unterminated quote, and leaves the swallowed rows unreadable', () => {
    const records = parseCsvRecords('SKU,Name\nS1,"Milk\nS2,Bread\n');

    expect(records).toEqual([
      ['SKU', 'Name'],
      ['S1', 'Milk\nS2,Bread\n'],
    ]);
  });
});
