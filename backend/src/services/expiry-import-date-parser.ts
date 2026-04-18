export interface ParsedExpiryImportDate {
  ok: boolean;
  isoDate?: string;
  errorCode?: 'year-missing-or-ambiguous' | 'unsupported-date-format' | 'invalid-date';
  errorMessage?: string;
}

function toIsoDate(year: number, month: number, day: number): string {
  const monthPart = String(month).padStart(2, '0');
  const dayPart = String(day).padStart(2, '0');
  return `${year}-${monthPart}-${dayPart}`;
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }

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

export function parseExpiryImportDate(value: string): ParsedExpiryImportDate {
  const raw = value.trim();

  if (raw.length === 0) {
    return {
      ok: false,
      errorCode: 'unsupported-date-format',
      errorMessage: 'Only numeric date formats are supported',
    };
  }

  if (/[a-zA-Z]/.test(raw)) {
    return {
      ok: false,
      errorCode: 'unsupported-date-format',
      errorMessage: 'Only numeric date formats are supported',
    };
  }

  const ambiguousDayMonthMatch = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (ambiguousDayMonthMatch) {
    const secondToken = Number(ambiguousDayMonthMatch[2]);
    if (secondToken > 12) {
      const month = Number(ambiguousDayMonthMatch[1]);
      const year = 2000 + secondToken;

      if (!isValidDateParts(year, month, 1)) {
        return {
          ok: false,
          errorCode: 'invalid-date',
          errorMessage: 'Date is not a valid calendar date',
        };
      }

      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      return {
        ok: true,
        isoDate: toIsoDate(year, month, lastDay),
      };
    }

    return {
      ok: false,
      errorCode: 'year-missing-or-ambiguous',
      errorMessage: 'Date must include a year for day/month format',
    };
  }

  const fullDateMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (fullDateMatch) {
    const day = Number(fullDateMatch[1]);
    const month = Number(fullDateMatch[2]);
    const year = normalizeYear(fullDateMatch[3]);

    if (!isValidDateParts(year, month, day)) {
      return {
        ok: false,
        errorCode: 'invalid-date',
        errorMessage: 'Date is not a valid calendar date',
      };
    }

    return {
      ok: true,
      isoDate: toIsoDate(year, month, day),
    };
  }

  const monthYearMatch = raw.match(/^(\d{1,2})([\/-])(\d{2}|\d{4})$/);
  if (monthYearMatch) {
    const month = Number(monthYearMatch[1]);
    const year = normalizeYear(monthYearMatch[3]);

    if (!isValidDateParts(year, month, 1)) {
      return {
        ok: false,
        errorCode: 'invalid-date',
        errorMessage: 'Date is not a valid calendar date',
      };
    }

    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

    return {
      ok: true,
      isoDate: toIsoDate(year, month, lastDay),
    };
  }

  return {
    ok: false,
    errorCode: 'unsupported-date-format',
    errorMessage: 'Only numeric date formats are supported',
  };
}
