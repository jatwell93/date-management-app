import {
  calculateInventoryMarkdownPrice,
  calculateInventoryMarkdownStatus,
  INVENTORY_MARKDOWN_THRESHOLDS,
} from '../../services/inventory-markdown.helpers';

describe('inventory markdown helpers', () => {
  const now = new Date('2026-05-03T00:00:00.000Z');

  it.each([
    ['', 'Normal'],
    [null, 'Normal'],
    ['not-a-date', 'Normal'],
    ['2026-05-03T00:00:00.000Z', 'Expired'],
    ['2026-05-10T00:00:00.000Z', 'Markdown 3'],
    ['2026-05-17T00:00:00.000Z', 'Markdown 2'],
    ['2026-06-02T00:00:00.000Z', 'Markdown 1'],
    ['2026-06-03T00:00:00.000Z', 'Normal'],
  ])('calculates %s as %s', (expiryDate, expected) => {
    expect(calculateInventoryMarkdownStatus(expiryDate, now)).toBe(expected);
  });

  it('calculates markdown prices from the same threshold rules', () => {
    expect(calculateInventoryMarkdownPrice(10, '2026-05-10T00:00:00.000Z', now)).toBe(8);
    expect(calculateInventoryMarkdownPrice(10, '2026-05-17T00:00:00.000Z', now)).toBe(10);
    expect(calculateInventoryMarkdownPrice(10, '2026-06-02T00:00:00.000Z', now)).toBe(12);
    expect(calculateInventoryMarkdownPrice(10, '2026-06-03T00:00:00.000Z', now)).toBeNull();
  });

  it('accepts Date instances from Prisma inventory rows', () => {
    const expiryDate = new Date('2026-05-10T00:00:00.000Z');

    expect(calculateInventoryMarkdownStatus(expiryDate, now)).toBe('Markdown 3');
    expect(calculateInventoryMarkdownPrice(10, expiryDate, now)).toBe(8);
  });

  it('exports the inventory markdown thresholds for service compatibility', () => {
    expect(INVENTORY_MARKDOWN_THRESHOLDS).toEqual({
      markdown3: 7,
      markdown2: 14,
      markdown1: 30,
    });
  });
});
