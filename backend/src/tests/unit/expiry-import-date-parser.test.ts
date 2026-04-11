import { parseExpiryImportDate } from '../../services/expiry-import-date-parser';

describe('parseExpiryImportDate', () => {
  it('trims surrounding whitespace before parsing', () => {
    const result = parseExpiryImportDate(' 12/12/2026 ');

    expect(result).toEqual({
      ok: true,
      isoDate: '2026-12-12',
    });
  });

  it('parses dd/mm/yy', () => {
    const result = parseExpiryImportDate('12/12/26');

    expect(result).toEqual({
      ok: true,
      isoDate: '2026-12-12',
    });
  });

  it('parses dd/mm/yyyy', () => {
    const result = parseExpiryImportDate('12/12/2026');

    expect(result).toEqual({
      ok: true,
      isoDate: '2026-12-12',
    });
  });

  it('normalizes mm/yy to end of month', () => {
    const result = parseExpiryImportDate('12/26');

    expect(result).toEqual({
      ok: true,
      isoDate: '2026-12-31',
    });
  });

  it('normalizes mm/yyyy to end of month', () => {
    const result = parseExpiryImportDate('12/2026');

    expect(result).toEqual({
      ok: true,
      isoDate: '2026-12-31',
    });
  });

  it('normalizes mm-yy to end of month', () => {
    const result = parseExpiryImportDate('12-26');

    expect(result).toEqual({
      ok: true,
      isoDate: '2026-12-31',
    });
  });

  it('normalizes mm-yyyy to end of month', () => {
    const result = parseExpiryImportDate('12-2026');

    expect(result).toEqual({
      ok: true,
      isoDate: '2026-12-31',
    });
  });

  it('rejects ambiguous month/day without year', () => {
    const result = parseExpiryImportDate('12/12');

    expect(result).toEqual({
      ok: false,
      errorCode: 'year-missing-or-ambiguous',
      errorMessage: 'Date must include a year for day/month format',
    });
  });

  it('rejects month name formats', () => {
    const result = parseExpiryImportDate('Dec/2026');

    expect(result).toEqual({
      ok: false,
      errorCode: 'unsupported-date-format',
      errorMessage: 'Only numeric date formats are supported',
    });
  });

  it('rejects invalid calendar dates', () => {
    const result = parseExpiryImportDate('31/02/2026');

    expect(result).toEqual({
      ok: false,
      errorCode: 'invalid-date',
      errorMessage: 'Date is not a valid calendar date',
    });
  });

  it('maps d/yy to month/year format when second token is greater than 12', () => {
    const result = parseExpiryImportDate('3/26');

    expect(result).toEqual({
      ok: true,
      isoDate: '2026-03-31',
    });
  });

  it('rejects d/yy when month token is invalid', () => {
    const result = parseExpiryImportDate('13/26');

    expect(result).toEqual({
      ok: false,
      errorCode: 'invalid-date',
      errorMessage: 'Date is not a valid calendar date',
    });
  });

  it('accepts leap day for leap years', () => {
    const result = parseExpiryImportDate('29/02/2024');

    expect(result).toEqual({
      ok: true,
      isoDate: '2024-02-29',
    });
  });

  it('rejects leap day for non-leap years', () => {
    const result = parseExpiryImportDate('29/02/2023');

    expect(result).toEqual({
      ok: false,
      errorCode: 'invalid-date',
      errorMessage: 'Date is not a valid calendar date',
    });
  });

  it('rejects month-year format when month is out of range', () => {
    const result = parseExpiryImportDate('13/2026');

    expect(result).toEqual({
      ok: false,
      errorCode: 'invalid-date',
      errorMessage: 'Date is not a valid calendar date',
    });
  });

  it('rejects unsupported numeric formats', () => {
    const result = parseExpiryImportDate('2026-12-31');

    expect(result).toEqual({
      ok: false,
      errorCode: 'unsupported-date-format',
      errorMessage: 'Only numeric date formats are supported',
    });
  });

  it('rejects blank strings after trimming', () => {
    const result = parseExpiryImportDate('   ');

    expect(result).toEqual({
      ok: false,
      errorCode: 'unsupported-date-format',
      errorMessage: 'Only numeric date formats are supported',
    });
  });
});
