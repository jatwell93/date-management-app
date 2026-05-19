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
      jest.useFakeTimers();
      // Set "now" to 2023-01-01
      jest.setSystemTime(new Date('2023-01-01T00:00:00Z'));
    });

    afterAll(() => {
      jest.useRealTimers();
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

    it('should markdown by 20% if expiry <= 30 days', () => {
      expect(calculateMarkdownPrice(COST, 30)).toBe(80);
      expect(calculateMarkdownPrice(COST, 1)).toBe(80);
      expect(calculateMarkdownPrice(COST, 0)).toBe(80);
      expect(calculateMarkdownPrice(COST, -5)).toBe(80); // Already expired
    });

    it('should apply no markdown if expiry is between 31 and 60 days', () => {
      expect(calculateMarkdownPrice(COST, 31)).toBe(100);
      expect(calculateMarkdownPrice(COST, 60)).toBe(100);
    });

    it('should markup by 20% if expiry is between 61 and 90 days', () => {
      expect(calculateMarkdownPrice(COST, 61)).toBe(120);
      expect(calculateMarkdownPrice(COST, 90)).toBe(120);
    });

    it('should apply no markdown if expiry is > 90 days', () => {
      expect(calculateMarkdownPrice(COST, 91)).toBe(100);
      expect(calculateMarkdownPrice(COST, 100)).toBe(100);
    });
  });

  describe('calculateMarkdownPercentage', () => {
    it('should return -20 if expiry <= 30 days', () => {
      expect(calculateMarkdownPercentage(30)).toBe(-20);
      expect(calculateMarkdownPercentage(5)).toBe(-20);
    });

    it('should return 0 if expiry is between 31 and 60 days', () => {
      expect(calculateMarkdownPercentage(31)).toBe(0);
      expect(calculateMarkdownPercentage(60)).toBe(0);
    });

    it('should return 20 if expiry is between 61 and 90 days', () => {
      expect(calculateMarkdownPercentage(61)).toBe(20);
      expect(calculateMarkdownPercentage(90)).toBe(20);
    });

    it('should return 0 if expiry is > 90 days', () => {
      expect(calculateMarkdownPercentage(91)).toBe(0);
    });
  });
});
