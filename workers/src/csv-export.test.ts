/**
 * Unit coverage for `toCsvField` / `buildCsv` (`shared/domain/csv-injection.ts`),
 * added with task 3.1.n because `GET /api/products/export-excess` is the first
 * Worker route that hands a customer a spreadsheet file.
 *
 * `escapeSpreadsheetFormula` had no direct test in either backend -- it was
 * covered only through the two upload parsers, both of which will be the last
 * callers standing once Express is deleted. The composition it is now part of
 * is the thing most worth pinning: formula-escape and RFC 4180 quoting are both
 * correct alone and produce a live formula if applied in the wrong order.
 */
import { describe, expect, it } from 'vitest';
import { buildCsv, toCsvField } from '../../shared/domain/csv-injection';

describe('toCsvField', () => {
  it('passes ordinary values through untouched', () => {
    expect(toCsvField('Baked Beans 400g')).toBe('Baked Beans 400g');
    expect(toCsvField(12)).toBe('12');
    expect(toCsvField(0)).toBe('0');
  });

  it('renders null and undefined as an empty field, not the string "null"', () => {
    // `sku` and `barcode` are nullable on the export row.
    expect(toCsvField(null)).toBe('');
    expect(toCsvField(undefined)).toBe('');
  });

  it('neutralizes a leading formula character', () => {
    expect(toCsvField('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(toCsvField('+1234')).toBe("'+1234");
    expect(toCsvField('-1234')).toBe("'-1234");
    expect(toCsvField('@import')).toBe("'@import");
  });

  it('leaves a non-leading operator alone', () => {
    // `Total: 5+3` is a legitimate product name and must survive intact.
    expect(toCsvField('Total: 5+3')).toBe('Total: 5+3');
  });

  it('escapes the formula BEFORE quoting, so the apostrophe stays outermost', () => {
    // This is the whole reason the two steps are one function. Quoting first
    // would yield `"=cmd|'/c calc'!A1"`, whose first character is a quote, so
    // the formula check no longer fires and the cell evaluates on open. The
    // apostrophe must land inside the quotes but before the `=`.
    const payload = "=cmd|'/c calc'!A1,x";
    const field = toCsvField(payload);

    // Only `"` is doubled by RFC 4180 quoting; the apostrophes in the payload
    // pass through unchanged.
    expect(field).toBe("\"'=cmd|'/c calc'!A1,x\"");
    // Stated as a property rather than only as a literal: whatever the quoting
    // does, the first character inside the quotes is the neutralizing
    // apostrophe, never the formula opener.
    expect(field.startsWith('"\'')).toBe(true);
  });

  it('quotes a value containing a delimiter, quote, or newline', () => {
    expect(toCsvField('Beans, baked')).toBe('"Beans, baked"');
    expect(toCsvField('6" pot')).toBe('"6"" pot"');
    expect(toCsvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('does not double-escape an already neutralized value', () => {
    // Catalogue rows are escaped at ingestion, so an export re-escaping them
    // would accumulate apostrophes on every round trip.
    expect(toCsvField("'=SUM(A1)")).toBe("'=SUM(A1)");
  });
});

describe('buildCsv', () => {
  it('emits a header row followed by one CRLF-separated row per record', () => {
    const csv = buildCsv(['id', 'name'] as const, [
      { id: 1, name: 'Alpha' },
      { id: 2, name: 'Beta' },
    ]);

    expect(csv).toBe('id,name\r\n1,Alpha\r\n2,Beta');
  });

  it('emits the header row alone when there are no records', () => {
    // An organization within its cap still gets a well-formed file rather than
    // an empty download.
    expect(buildCsv(['id', 'name'] as const, [])).toBe('id,name');
  });

  it('escapes every field, including ones reached through the header list', () => {
    const csv = buildCsv(['name', 'notes'] as const, [
      { name: '=HYPERLINK("http://evil","click")', notes: 'plain' },
    ]);

    expect(csv.split('\r\n')[1]).toBe('"\'=HYPERLINK(""http://evil"",""click"")",plain');
  });
});
