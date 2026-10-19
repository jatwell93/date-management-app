import { formatTimestampSafe, normalisePgTimestamp, parsePgTimestamp } from '../pg-timestamp';

describe('normalisePgTimestamp', () => {
  // V8 parses the raw Postgres form leniently, so assert the ISO rewrite itself:
  // Safari/JSC returns Invalid Date for the un-normalised strings.
  it.each([
    ['2026-10-19 03:12:45.123+00', '2026-10-19T03:12:45.123+00:00'],
    ['2026-10-19 03:12:45+10:30', '2026-10-19T03:12:45+10:30'],
    ['2026-10-19 03:12:45-05', '2026-10-19T03:12:45-05:00'],
    ['2026-10-19T03:12:45.123Z', '2026-10-19T03:12:45.123Z'],
    ['2025-12-31', '2025-12-31'],
    ['not a date', 'not a date'],
  ])('rewrites %s as %s', (input, expected) => {
    expect(normalisePgTimestamp(input)).toBe(expected);
  });
});

describe('parsePgTimestamp', () => {
  it.each([
    ['2026-10-19 03:12:45.123+00', '2026-10-19T03:12:45.123Z'],
    ['2026-10-19 03:12:45+10:30', '2026-10-18T16:42:45.000Z'],
    ['2026-10-19T03:12:45.123Z', '2026-10-19T03:12:45.123Z'],
  ])('parses %s', (input, expectedIso) => {
    expect(parsePgTimestamp(input)?.toISOString()).toBe(expectedIso);
  });

  it.each(['garbage', '', '   ', null, undefined])('returns null for %p', (input) => {
    expect(parsePgTimestamp(input)).toBeNull();
  });
});

describe('formatTimestampSafe', () => {
  const formatter = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  it('formats a Postgres text timestamp', () => {
    expect(formatTimestampSafe(formatter, '2026-10-19 03:12:45.123+00')).toBe(
      formatter.format(new Date('2026-10-19T03:12:45.123Z')),
    );
  });

  it('returns the raw value instead of throwing when unparseable', () => {
    expect(() => formatTimestampSafe(formatter, 'garbage')).not.toThrow();
    expect(formatTimestampSafe(formatter, 'garbage')).toBe('garbage');
    expect(formatTimestampSafe(formatter, null)).toBe('');
  });
});
