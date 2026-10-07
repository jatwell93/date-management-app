import { describe, expect, it } from 'vitest';
import { parseExpiryImportDate } from './expiry-date-parser';

describe('parseExpiryImportDate (worker)', () => {
  it('parses full dd/mm/yyyy and dd/mm/yy dates', () => {
    expect(parseExpiryImportDate('05/03/2026')).toEqual({ ok: true, isoDate: '2026-03-05' });
    expect(parseExpiryImportDate('05/03/26')).toEqual({ ok: true, isoDate: '2026-03-05' });
  });

  it('normalizes month/year formats to the last day of the month', () => {
    expect(parseExpiryImportDate('12/2026')).toEqual({ ok: true, isoDate: '2026-12-31' });
    expect(parseExpiryImportDate('2/2026')).toEqual({ ok: true, isoDate: '2026-02-28' });
    expect(parseExpiryImportDate('02-26')).toEqual({ ok: true, isoDate: '2026-02-28' });
  });

  it('treats a second token > 12 as an unambiguous month/year', () => {
    expect(parseExpiryImportDate('3/26')).toEqual({ ok: true, isoDate: '2026-03-31' });
  });

  it('rejects ambiguous day/month without a year', () => {
    const result = parseExpiryImportDate('12/12');
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('year-missing-or-ambiguous');
  });

  it('rejects month names and other non-numeric formats', () => {
    expect(parseExpiryImportDate('Dec/2026').ok).toBe(false);
    expect(parseExpiryImportDate('2026-12-31').ok).toBe(false);
  });

  // Task 3.2 batch 6: the remaining cases of the Express parser test, with the same expected
  // results (including the exact error code and message the import reports per row).
  it('trims surrounding whitespace before parsing', () => {
    expect(parseExpiryImportDate(' 12/12/2026 ')).toEqual({ ok: true, isoDate: '2026-12-12' });
  });

  it('accepts 29 February in a leap year and rejects it otherwise', () => {
    expect(parseExpiryImportDate('29/02/2024')).toEqual({ ok: true, isoDate: '2024-02-29' });
    expect(parseExpiryImportDate('29/02/2023')).toEqual({
      ok: false,
      errorCode: 'invalid-date',
      errorMessage: 'Date is not a valid calendar date',
    });
  });

  it.each(['13/26', '13/2026'])('rejects %s, whose month is out of range', (cell) => {
    expect(parseExpiryImportDate(cell)).toEqual({
      ok: false,
      errorCode: 'invalid-date',
      errorMessage: 'Date is not a valid calendar date',
    });
  });

  it.each(['2026-12-31', '   ', ''])('rejects %j as an unsupported format', (cell) => {
    expect(parseExpiryImportDate(cell)).toEqual({
      ok: false,
      errorCode: 'unsupported-date-format',
      errorMessage: 'Only numeric date formats are supported',
    });
  });

  it('rejects impossible calendar dates', () => {
    const result = parseExpiryImportDate('31/02/2026');
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('invalid-date');
  });
});
