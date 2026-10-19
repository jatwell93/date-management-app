/**
 * Postgres `timestamptz::text` renders as `2026-10-19 03:12:45.123+00`: a space
 * between date and time and an hour-only offset. V8 accepts that, but
 * Safari/JavaScriptCore returns Invalid Date, and `Intl.DateTimeFormat#format`
 * throws `RangeError` on an invalid Date. Normalise to ISO 8601 first.
 */
const PG_SPACE_SEPARATOR = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/;
// Only after a time component, so a date-only `2025-12-31` is left alone.
const SHORT_OFFSET = /(T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)([+-]\d{2})$/;
/**
 * A time with no offset at all. `TIMESTAMP` (without time zone) columns such as
 * `inventory_items.created_at` hold UTC, but `new Date()` reads an offset-less
 * ISO date-time as local time, so mark it UTC explicitly.
 */
const NO_OFFSET = /T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/** Rewrites a Postgres text timestamp into ISO 8601; other strings pass through trimmed. */
export function normalisePgTimestamp(value: string): string {
  const iso = value.trim().replace(PG_SPACE_SEPARATOR, '$1T$2').replace(SHORT_OFFSET, '$1$2:00');
  return NO_OFFSET.test(iso) ? `${iso}Z` : iso;
}

export function parsePgTimestamp(value: string | null | undefined): Date | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const date = new Date(normalisePgTimestamp(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Formats a timestamp string, returning the raw value instead of throwing when it cannot be parsed. */
export function formatTimestampSafe(
  formatter: Intl.DateTimeFormat,
  value: string | null | undefined,
): string {
  const date = parsePgTimestamp(value);
  return date ? formatter.format(date) : (value ?? '');
}
