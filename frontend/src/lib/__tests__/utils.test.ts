import {
  isWithinMarkdownPeriod,
  calculateMarkdownPrice,
  calculateMarkdownPercentage,
  cn,
} from '../utils';

describe('utils', () => {
  describe('cn', () => {
    it('should merge class names correctly', () => {
      const result = cn('text-semantic-critical', 'bg-semantic-secondary', {
        'p-4': true,
        'm-2': false,
      });
      expect(result).toContain('text-semantic-critical');
      expect(result).toContain('bg-semantic-secondary');
      expect(result).toContain('p-4');
      expect(result).not.toContain('m-2');
    });

    it('should handle tailwind conflicts', () => {
      // "p-4" (padding 1rem) conflicts with "p-2" (padding 0.5rem). The last one wins.
      const result = cn('p-4', 'p-2');
      expect(result).toBe('p-2');
    });
  });

  describe('isWithinMarkdownPeriod', () => {
    beforeAll(() => {
      vi.useFakeTimers();
      // Set "now" to 2023-01-01
      vi.setSystemTime(new Date('2023-01-01T00:00:00Z'));
    });

    afterAll(() => {
      vi.useRealTimers();
    });

    it('should return false if expiryDate is null', () => {
      expect(isWithinMarkdownPeriod(null, 10)).toBe(false);
    });

    it('should return true if expiry is within N days', () => {
      // Expires in 5 days (Jan 6)
      expect(isWithinMarkdownPeriod('2023-01-06T00:00:00Z', 10)).toBe(true);
      // Expires in 10 days (Jan 11)
      expect(isWithinMarkdownPeriod('2023-01-11T00:00:00Z', 10)).toBe(true);
    });

    it('should return false if expiry is outside N days', () => {
      // Expires in 11 days (Jan 12)
      expect(isWithinMarkdownPeriod('2023-01-12T00:00:00Z', 10)).toBe(false);
    });

    it('should handle past dates', () => {
      // Expired yesterday (Dec 31)
      // Days to expiry is negative. Negative <= 10 is true.
      expect(isWithinMarkdownPeriod('2022-12-31T00:00:00Z', 10)).toBe(true);
    });
  });

  describe('calculateMarkdownPrice', () => {
    const COST = 100;

    it('delegates markdown pricing to the shared domain helper', async () => {
      const calculateMarkdownPriceFromCost = vi.fn().mockReturnValue(12.34);
      const getMarkdownDiscountPercentageForDays = vi.fn().mockReturnValue(37);

      vi.resetModules();
      vi.doMock('@shared/markdown', () => ({
        calculateMarkdownPriceFromCost,
        getMarkdownDiscountPercentageForDays,
      }));

      try {
        const {
          calculateMarkdownPrice: isolatedCalculateMarkdownPrice,
          calculateMarkdownPercentage: isolatedCalculateMarkdownPercentage,
        } = await import('../utils');

        expect(isolatedCalculateMarkdownPrice(47.25, 12)).toBe(12.34);
        expect(calculateMarkdownPriceFromCost).toHaveBeenCalledWith(47.25, 12);

        expect(isolatedCalculateMarkdownPercentage(12)).toBe(37);
        expect(getMarkdownDiscountPercentageForDays).toHaveBeenCalledWith(12);
      } finally {
        vi.doUnmock('@shared/markdown');
        vi.resetModules();
      }
    });

    it('should markdown by 75% if expiry is between 1 and 30 days', () => {
      expect(calculateMarkdownPrice(COST, 30)).toBe(25);
      expect(calculateMarkdownPrice(COST, 1)).toBe(25);
    });

    it('should apply no markdown to day-zero or expired stock', () => {
      expect(calculateMarkdownPrice(COST, 0)).toBe(100);
      expect(calculateMarkdownPrice(COST, -5)).toBe(100);
    });

    it('should markdown by 60% if expiry is between 31 and 60 days', () => {
      expect(calculateMarkdownPrice(COST, 31)).toBe(40);
      expect(calculateMarkdownPrice(COST, 60)).toBe(40);
    });

    it('should markdown by 50% if expiry is between 61 and 90 days', () => {
      expect(calculateMarkdownPrice(COST, 61)).toBe(50);
      expect(calculateMarkdownPrice(COST, 90)).toBe(50);
    });

    it('should apply no markdown if expiry is > 90 days', () => {
      expect(calculateMarkdownPrice(COST, 91)).toBe(100);
      expect(calculateMarkdownPrice(COST, 100)).toBe(100);
    });

    it('should not round fractional markdown prices', () => {
      expect(calculateMarkdownPrice(47.25, 12)).toBe(11.8125);
    });
  });

  describe('calculateMarkdownPercentage', () => {
    it('should return 75 if expiry is between 1 and 30 days', () => {
      expect(calculateMarkdownPercentage(30)).toBe(75);
      expect(calculateMarkdownPercentage(5)).toBe(75);
    });

    it('should return 0 for day-zero or expired stock', () => {
      expect(calculateMarkdownPercentage(0)).toBe(0);
      expect(calculateMarkdownPercentage(-5)).toBe(0);
    });

    it('should return 60 if expiry is between 31 and 60 days', () => {
      expect(calculateMarkdownPercentage(31)).toBe(60);
      expect(calculateMarkdownPercentage(60)).toBe(60);
    });

    it('should return 50 if expiry is between 61 and 90 days', () => {
      expect(calculateMarkdownPercentage(61)).toBe(50);
      expect(calculateMarkdownPercentage(90)).toBe(50);
    });

    it('should return 0 if expiry is > 90 days', () => {
      expect(calculateMarkdownPercentage(91)).toBe(0);
    });
  });
});
