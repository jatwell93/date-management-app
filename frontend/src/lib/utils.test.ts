import { calendarDaysUntil } from './utils';

describe('calendarDaysUntil', () => {
  // Local-time constructors, so the test is meaningful in any TZ the runner uses.
  it('is 0 for today even early in the local day (UTC+ offsets)', () => {
    expect(calendarDaysUntil('2026-10-16', new Date(2026, 9, 16, 0, 5))).toBe(0);
    expect(calendarDaysUntil('2026-10-16', new Date(2026, 9, 16, 8, 31))).toBe(0);
  });

  it('is 0 for today late in the local day', () => {
    expect(calendarDaysUntil('2026-10-16', new Date(2026, 9, 16, 23, 59))).toBe(0);
  });

  it('is negative for past dates and positive for future dates', () => {
    const now = new Date(2026, 9, 16, 12, 0);
    expect(calendarDaysUntil('2026-10-15', now)).toBe(-1);
    expect(calendarDaysUntil('2026-10-17', now)).toBe(1);
    expect(calendarDaysUntil('2026-11-15', now)).toBe(30);
  });
});
