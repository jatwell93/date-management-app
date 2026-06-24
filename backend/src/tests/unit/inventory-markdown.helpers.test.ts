import {
  calculateInventoryMarkdownPrice,
  calculateInventoryMarkdownStatus,
  INVENTORY_MARKDOWN_THRESHOLDS,
} from '../../services/inventory-markdown.helpers';
import {
  getMarkdownDiscountPercentageForDays,
  getMarkdownLevelForDays,
} from '../../../../shared/domain/markdown';

describe('inventory markdown helpers', () => {
  const now = new Date('2026-05-03T00:00:00.000Z');

  it.each([
    ['', 'Normal'],
    [null, 'Normal'],
    ['not-a-date', 'Normal'],
    ['2026-05-03T00:00:00.000Z', 'Expired'],
    ['2026-06-02T00:00:00.000Z', 'Markdown 3'], // 30 days
    ['2026-07-02T00:00:00.000Z', 'Markdown 2'], // 60 days
    ['2026-08-01T00:00:00.000Z', 'Markdown 1'], // 90 days
    ['2026-08-02T00:00:00.000Z', 'Normal'], // 91 days
  ])('calculates %s as %s', (expiryDate, expected) => {
    expect(calculateInventoryMarkdownStatus(expiryDate, now)).toBe(expected);
  });

  it('calculates markdown prices from the same threshold rules', () => {
    expect(calculateInventoryMarkdownPrice(10, '2026-06-02T00:00:00.000Z', now)).toBe(2.5); // 30 days
    expect(calculateInventoryMarkdownPrice(10, '2026-07-02T00:00:00.000Z', now)).toBe(4); // 60 days
    expect(calculateInventoryMarkdownPrice(10, '2026-08-01T00:00:00.000Z', now)).toBe(5); // 90 days
    expect(calculateInventoryMarkdownPrice(10, '2026-08-02T00:00:00.000Z', now)).toBeNull(); // 91 days
  });

  it('returns no markdown price for expired stock (write-off, not a discount)', () => {
    // Status and price must agree: an item the status function calls 'Expired'
    // must not come back with a discounted price.
    expect(calculateInventoryMarkdownStatus('2026-05-03T00:00:00.000Z', now)).toBe('Expired'); // today (0 days)
    expect(calculateInventoryMarkdownPrice(10, '2026-05-03T00:00:00.000Z', now)).toBeNull(); // today (0 days)
    expect(calculateInventoryMarkdownStatus('2026-05-01T00:00:00.000Z', now)).toBe('Expired'); // 2 days ago
    expect(calculateInventoryMarkdownPrice(10, '2026-05-01T00:00:00.000Z', now)).toBeNull(); // 2 days ago
  });

  it('gives expired stock no shared discount percentage', () => {
    expect(getMarkdownDiscountPercentageForDays(-5)).toBe(0);
  });

  it('treats stock expiring today or later as expired across shared lookups', () => {
    // Day 0 (expires today) is a write-off, not the deepest markdown — the level and
    // discount lookups must agree with the Expired status the rest of the app reports.
    expect(getMarkdownLevelForDays(0)).toBeNull();
    expect(getMarkdownLevelForDays(-1)).toBeNull();
    expect(getMarkdownLevelForDays(1)).toBe(3);
    expect(getMarkdownDiscountPercentageForDays(0)).toBe(0);
    expect(getMarkdownDiscountPercentageForDays(1)).toBe(75);
  });

  it.each([
    [30, '2026-06-02T00:00:00.000Z'],
    [60, '2026-07-02T00:00:00.000Z'],
    [90, '2026-08-01T00:00:00.000Z'],
  ])(
    'matches the shared discount percentage at the %d-day boundary',
    (daysToExpiry, expiryDate) => {
      const costPrice = 10;
      const expectedPrice =
        costPrice * (1 - getMarkdownDiscountPercentageForDays(daysToExpiry) / 100);

      expect(calculateInventoryMarkdownPrice(costPrice, expiryDate, now)).toBe(expectedPrice);
    },
  );

  it('accepts Date instances from Prisma inventory rows', () => {
    const expiryDate = new Date('2026-06-02T00:00:00.000Z'); // 30 days

    expect(calculateInventoryMarkdownStatus(expiryDate, now)).toBe('Markdown 3');
    expect(calculateInventoryMarkdownPrice(10, expiryDate, now)).toBe(2.5);
  });

  it('exports the inventory markdown thresholds for service compatibility', () => {
    expect(INVENTORY_MARKDOWN_THRESHOLDS).toEqual({
      markdown3: 30,
      markdown2: 60,
      markdown1: 90,
    });
  });
});
