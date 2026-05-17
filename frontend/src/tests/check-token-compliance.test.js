const path = require('path');

const {
  isExcluded,
  summarizeViolations,
  buildBaseline,
  getBaselineDelta,
} = require('../../scripts/check-token-compliance');

describe('check-token-compliance helpers', () => {
  describe('isExcluded', () => {
    const fromSrc = (...segments) => path.join(process.cwd(), 'src', ...segments);

    it.each([
      ['theme token files', fromSrc('theme', 'tokens.ts')],
      ['component tests', fromSrc('components', '__tests__', 'Button.test.tsx')],
      ['typed declaration files', fromSrc('global.d.ts')],
      ['generated tailwind output', fromSrc('tailwind-output.css')],
    ])('excludes %s', (_label, filePath) => {
      expect(isExcluded(filePath)).toBe(true);
    });

    it('keeps ordinary source files in scope', () => {
      expect(isExcluded(fromSrc('components', 'Button.tsx'))).toBe(false);
    });
  });

  describe('violation summaries', () => {
    const violations = [
      { severity: 'error', ruleId: 'hardcoded-hex-style' },
      { severity: 'warning', ruleId: 'inventory-class-usage' },
      { severity: 'warning', ruleId: 'inventory-class-usage' },
    ];

    it('summarizes errors, warnings, and totals', () => {
      expect(summarizeViolations(violations)).toEqual({
        errors: [{ severity: 'error', ruleId: 'hardcoded-hex-style' }],
        warnings: [
          { severity: 'warning', ruleId: 'inventory-class-usage' },
          { severity: 'warning', ruleId: 'inventory-class-usage' },
        ],
        total: 3,
      });
    });

    it('builds a baseline grouped by rule', () => {
      expect(buildBaseline(violations)).toMatchObject({
        totalViolations: 3,
        errors: 1,
        warnings: 2,
        byRule: {
          'hardcoded-hex-style': 1,
          'inventory-class-usage': 2,
        },
      });
    });

    it('computes delta from a previous baseline', () => {
      expect(getBaselineDelta({ totalViolations: 5 }, violations)).toBe(-2);
    });
  });
});
