import { describe, expect, it } from 'vitest';
import {
  EXPIRY_TOO_FAR_MESSAGE,
  isExpiryBeyondHorizon,
  MAX_EXPIRY_YEARS_AHEAD,
} from './inventory-status';

// Task 3.2 batch 6. Express refused an expiry date more than five years out
// (`data-integrity.middleware.test.ts`): the boundary day is allowed, the day after is not.
describe('isExpiryBeyondHorizon', () => {
  const now = new Date('2026-10-07T15:30:00.000Z');

  it('allows today, a date inside the horizon, and exactly five years out', () => {
    expect(isExpiryBeyondHorizon('2026-10-07', now)).toBe(false);
    expect(isExpiryBeyondHorizon('2029-01-01', now)).toBe(false);
    expect(isExpiryBeyondHorizon('2031-10-07', now)).toBe(false);
  });

  it('refuses the day after the horizon, and a mistyped far-future year', () => {
    expect(isExpiryBeyondHorizon('2031-10-08', now)).toBe(true);
    expect(isExpiryBeyondHorizon('2062-01-01', now)).toBe(true);
  });

  it('does not refuse a date in the past, which the status rule marks Expired', () => {
    expect(isExpiryBeyondHorizon('2020-01-01', now)).toBe(false);
  });

  it('states the horizon in its message', () => {
    expect(MAX_EXPIRY_YEARS_AHEAD).toBe(5);
    expect(EXPIRY_TOO_FAR_MESSAGE).toBe('Expiry date cannot be more than 5 years in the future');
  });
});
