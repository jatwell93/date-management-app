import { describe, expect, it } from 'vitest';
import { calculateInventoryStatus } from './expiry-import';
import { MARKDOWN_WINDOWS } from '../../../shared/domain/markdown';

// Task 3.2 batch 4. The import used 7/14/30-day thresholds, ported from an Express
// CSV parser that had missed the move to the shared 30/60/90-day windows, so an
// imported item was labelled differently from how the daily markdown-recalculation
// job would label it the same night.
describe('calculateInventoryStatus', () => {
  const now = new Date('2026-05-03T00:00:00.000Z');
  const expiryInDays = (days: number) =>
    new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  it.each([
    [-3, 'Expired'],
    [0, 'Expired'],
    [1, 'Markdown 3'],
    [7, 'Markdown 3'],
    [8, 'Markdown 3'],
    [30, 'Markdown 3'],
    [31, 'Markdown 2'],
    [60, 'Markdown 2'],
    [61, 'Markdown 1'],
    [90, 'Markdown 1'],
    [91, 'Normal'],
    [400, 'Normal'],
  ])('labels an item expiring in %i days as %s', (days, expected) => {
    expect(calculateInventoryStatus(expiryInDays(days), now)).toBe(expected);
  });

  it('keeps its boundaries on the shared markdown windows', () => {
    expect(calculateInventoryStatus(expiryInDays(MARKDOWN_WINDOWS.markdown3.maxDays), now)).toBe(
      'Markdown 3',
    );
    expect(calculateInventoryStatus(expiryInDays(MARKDOWN_WINDOWS.markdown2.maxDays), now)).toBe(
      'Markdown 2',
    );
    expect(calculateInventoryStatus(expiryInDays(MARKDOWN_WINDOWS.markdown1.maxDays), now)).toBe(
      'Markdown 1',
    );
    expect(
      calculateInventoryStatus(expiryInDays(MARKDOWN_WINDOWS.markdown1.maxDays + 1), now),
    ).toBe('Normal');
  });
});
