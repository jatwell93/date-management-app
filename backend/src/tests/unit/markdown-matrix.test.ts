import {
  calculateMarkdownPrice,
  DEFAULT_MARKDOWN_MATRIX,
  type MarkdownMatrixConfig,
} from '../../../../shared/domain/markdown';

describe('calculateMarkdownPrice (org-configurable matrix)', () => {
  // Day windows: band1 = 61-90, band2 = 31-60, band3 = 0-30.
  const days = { band1: 80, band2: 45, band3: 20 };

  describe('default matrix preserves the 50/60/75%-off-cost ladder', () => {
    it('bands price off cost regardless of retail', () => {
      const item = { costPrice: 10, retailPrice: 40 };
      expect(calculateMarkdownPrice(item, days.band1)).toBe(5); // 50% off cost
      expect(calculateMarkdownPrice(item, days.band2)).toBe(4); // 60% off cost
      expect(calculateMarkdownPrice(item, days.band3)).toBe(2.5); // 75% off cost
    });

    it('omitting the config argument is identical to passing the default', () => {
      const item = { costPrice: 10 };
      expect(calculateMarkdownPrice(item, days.band1)).toBe(
        calculateMarkdownPrice(item, days.band1, DEFAULT_MARKDOWN_MATRIX),
      );
    });
  });

  describe('retail-basis bands', () => {
    const retailMatrix: MarkdownMatrixConfig = {
      band1: { percentage: 50, basis: 'retail' },
      band2: { percentage: 75, basis: 'retail' },
      band3: { percentage: 90, basis: 'retail' },
    };

    it('discounts off retail (issue #338 example)', () => {
      const item = { costPrice: 4, retailPrice: 10 };
      expect(calculateMarkdownPrice(item, days.band1, retailMatrix)).toBe(5); // 50% off retail
      expect(calculateMarkdownPrice(item, days.band2, retailMatrix)).toBe(2.5); // 75% off retail
      expect(calculateMarkdownPrice(item, days.band3, retailMatrix)).toBeCloseTo(1, 10); // 90% off retail
    });

    it('falls back to cost when a product has no retail price', () => {
      const noRetail = { costPrice: 10, retailPrice: null };
      // 50% off, but off cost because retail is absent -> 5, not a retail-derived value.
      expect(calculateMarkdownPrice(noRetail, days.band1, retailMatrix)).toBe(5);
    });

    it('falls back to cost when retail is not finite', () => {
      const badRetail = { costPrice: 10, retailPrice: Number.NaN };
      expect(calculateMarkdownPrice(badRetail, days.band1, retailMatrix)).toBe(5);
    });
  });

  describe('per-band mixed basis', () => {
    it('resolves each band independently', () => {
      const mixed: MarkdownMatrixConfig = {
        band1: { percentage: 20, basis: 'cost' },
        band2: { percentage: 50, basis: 'retail' },
        band3: { percentage: 90, basis: 'cost' },
      };
      const item = { costPrice: 10, retailPrice: 30 };
      expect(calculateMarkdownPrice(item, days.band1, mixed)).toBe(8); // 20% off cost 10
      expect(calculateMarkdownPrice(item, days.band2, mixed)).toBe(15); // 50% off retail 30
      expect(calculateMarkdownPrice(item, days.band3, mixed)).toBeCloseTo(1, 10); // 90% off cost 10
    });
  });

  describe('no markdown outside the window', () => {
    const item = { costPrice: 10, retailPrice: 40 };
    it('returns null for stock more than 90 days out', () => {
      expect(calculateMarkdownPrice(item, 91)).toBeNull();
    });
    it('returns null for expired stock (0 or fewer days)', () => {
      expect(calculateMarkdownPrice(item, 0)).toBeNull();
      expect(calculateMarkdownPrice(item, -5)).toBeNull();
      expect(calculateMarkdownPrice(item, null)).toBeNull();
    });
  });
});
