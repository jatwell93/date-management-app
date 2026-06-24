import {
  calculateInventoryMarkdownPrice,
  calculateInventoryMarkdownStatus,
  INVENTORY_MARKDOWN_THRESHOLDS,
} from '../../services/inventory-markdown.helpers';
import { getMarkdownDiscountPercentageForDays } from '../../../../shared/domain/markdown';

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
