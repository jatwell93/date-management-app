/**
 * Expiry import date parser.
 *
 * Ported from backend/src/services/expiry-import-date-parser.ts so the Cloudflare
 * worker (the production upload path) can parse used-by dates identically to the
 * Express backend. Only numeric formats are supported; month-year formats
 * normalize to the last day of the month.
 */
export interface ParsedExpiryImportDate {
  ok: boolean;
  isoDate?: string;
  errorCode?: 'year-missing-or-ambiguous' | 'unsupported-date-format' | 'invalid-date';
  errorMessage?: string;
}

const unsupportedDateFormat: ParsedExpiryImportDate = {
  ok: false,
  errorCode: 'unsupported-date-format',
  errorMessage: 'Only numeric date formats are supported',
};

const invalidCalendarDate: ParsedExpiryImportDate = {
  ok: false,
  errorCode: 'invalid-date',
  errorMessage: 'Date is not a valid calendar date',
};

const ambiguousDayMonthDate: ParsedExpiryImportDate = {
  ok: false,
  errorCode: 'year-missing-or-ambiguous',
  errorMessage: 'Date must include a year for day/month format',
};

function toIsoDate(year: number, month: number, day: number): string {
  const monthPart = String(month).padStart(2, '0');
  const dayPart = String(day).padStart(2, '0');
  return `${year}-${monthPart}-${dayPart}`;
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  const hasValidMonth = month >= 1 && month <= 12;
  if (!hasValidMonth) return false;
  if (day < 1) return false;

  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

function normalizeYear(yearToken: string): number {
  if (yearToken.length === 2) {
    return 2000 + Number(yearToken);
  }
  return Number(yearToken);
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toMonthEndResult(year: number, month: number): ParsedExpiryImportDate {
  if (!isValidDateParts(year, month, 1)) {
    return invalidCalendarDate;
  }

  return {
    ok: true,
    isoDate: toIsoDate(year, month, lastDayOfMonth(year, month)),
  };
}

function parseAmbiguousDayMonth(raw: string): ParsedExpiryImportDate | null {
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;

  const secondToken = Number(match[2]);
  if (secondToken <= 12) {
    return ambiguousDayMonthDate;
  }

  return toMonthEndResult(2000 + secondToken, Number(match[1]));
}

function parseFullDate(raw: string): ParsedExpiryImportDate | null {
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = normalizeYear(match[3]);

  if (!isValidDateParts(year, month, day)) {
    return invalidCalendarDate;
  }

  return {
    ok: true,
    isoDate: toIsoDate(year, month, day),
  };
}

function parseMonthYear(raw: string): ParsedExpiryImportDate | null {
  const match = raw.match(/^(\d{1,2})([/-])(\d{2}|\d{4})$/);
  if (!match) return null;

  return toMonthEndResult(normalizeYear(match[3]), Number(match[1]));
}

export function parseExpiryImportDate(value: string): ParsedExpiryImportDate {
  const raw = value.trim();

  if (raw.length === 0 || /[a-zA-Z]/.test(raw)) return unsupportedDateFormat;

  return (
    parseAmbiguousDayMonth(raw) ??
    parseFullDate(raw) ??
    parseMonthYear(raw) ??
    unsupportedDateFormat
  );
}
