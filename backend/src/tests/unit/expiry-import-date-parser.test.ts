import { parseExpiryImportDate } from '../../services/expiry-import-date-parser';

describe('parseExpiryImportDate', () => {
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
});
