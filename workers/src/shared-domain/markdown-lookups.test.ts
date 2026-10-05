import { describe, expect, it } from 'vitest';
import {
  calculateMarkdownPriceFromCost,
  getMarkdownDiscountPercentageForDays,
  getMarkdownLevelForDays,
} from '../../../shared/domain/markdown';

// Task 3.2 batch 4. Ported from backend/src/tests/unit/inventory-markdown.helpers.test.ts:
// only the assertions that exercise `shared/domain/markdown`. The rest of that file
// tested an Express service helper that the Worker does not have.
describe('shared markdown lookups', () => {
  it('gives expired stock no discount percentage', () => {
    expect(getMarkdownDiscountPercentageForDays(-5)).toBe(0);
  });

  it('treats stock expiring today or earlier as expired across the level and discount lookups', () => {
    // Day 0 (expires today) is a write-off, not the deepest markdown. The level and
    // discount lookups must agree with the Expired status the rest of the app reports.
    expect(getMarkdownLevelForDays(0)).toBeNull();
    expect(getMarkdownLevelForDays(-1)).toBeNull();
    expect(getMarkdownLevelForDays(1)).toBe(3);
    expect(getMarkdownDiscountPercentageForDays(0)).toBe(0);
    expect(getMarkdownDiscountPercentageForDays(1)).toBe(75);
  });

  it.each([
    [30, 3],
    [31, 2],
    [60, 2],
    [61, 1],
    [90, 1],
  ])('puts a %i-day item in markdown level %i', (days, level) => {
    expect(getMarkdownLevelForDays(days)).toBe(level);
  });

  it('has no level and no discount beyond 90 days', () => {
    expect(getMarkdownLevelForDays(91)).toBeNull();
    expect(getMarkdownDiscountPercentageForDays(91)).toBe(0);
    expect(getMarkdownLevelForDays(null)).toBeNull();
  });

  it.each([30, 60, 90])(
    'prices at the shared discount percentage at the %d-day boundary',
    (days) => {
      const costPrice = 10;
      const expectedPrice = costPrice * (1 - getMarkdownDiscountPercentageForDays(days) / 100);

      expect(calculateMarkdownPriceFromCost(costPrice, days)).toBe(expectedPrice);
    },
  );
});
