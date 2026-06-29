/* eslint-env node */

const path = require('path');

const {
  getComplianceFailure,
  isExcluded,
  scanContent,
  summarizeViolations,
  buildBaseline,
  getBaselineDelta,
  parseBaselineContent,
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

    it('reports malformed baseline JSON with a clear error', () => {
      expect(() => parseBaselineContent('{bad json')).toThrow(
        'Token compliance baseline is malformed JSON',
      );
    });
  });

  describe('amber restraint scanning', () => {
    it('flags non-semantic Tailwind color utilities beyond amber and gray', () => {
      const violations = scanContent(`
        <button className="bg-blue-500 hover:bg-blue-600 text-white" />
        <p className="text-red-600 border-green-200" />
      `);

      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'hardcoded-tailwind-color-class',
            match: 'bg-blue-500',
          }),
          expect.objectContaining({
            ruleId: 'hardcoded-tailwind-color-class',
            match: 'hover:bg-blue-600',
          }),
          expect.objectContaining({
            ruleId: 'hardcoded-tailwind-color-class',
            match: 'text-white',
          }),
          expect.objectContaining({
            ruleId: 'hardcoded-tailwind-color-class',
            match: 'text-red-600',
          }),
          expect.objectContaining({
            ruleId: 'hardcoded-tailwind-color-class',
            match: 'border-green-200',
          }),
        ]),
      );
    });

    it('flags raw amber utility classes and deprecated inventory warning tokens', () => {
      const violations = scanContent(`
        <div className="bg-amber-50 border-amber-200 text-amber-800" />
        <div className="bg-inventory-warning-500" />
        <svg className="fill-amber-500 stroke-amber-700" />
      `);

      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: 'amber-restraint-usage',
            match: 'bg-amber-50',
          }),
          expect.objectContaining({
            ruleId: 'amber-restraint-usage',
            match: 'border-amber-200',
          }),
          expect.objectContaining({
            ruleId: 'amber-restraint-usage',
            match: 'text-amber-800',
          }),
          expect.objectContaining({
            ruleId: 'amber-restraint-usage',
            match: 'bg-inventory-warning-500',
          }),
          expect.objectContaining({
            ruleId: 'amber-restraint-usage',
            match: 'fill-amber-500',
          }),
          expect.objectContaining({
            ruleId: 'amber-restraint-usage',
            match: 'stroke-amber-700',
          }),
        ]),
      );
    });

    it('blocks amber restraint errors even when total violations do not exceed baseline', () => {
      const baseline = {
        totalViolations: 169,
        errors: 0,
      };
      const violations = [
        ...Array.from({ length: 168 }, () => ({
          severity: 'warning',
          ruleId: 'hardcoded-gray-class',
        })),
        ...scanContent('<div className="bg-amber-50" />'),
      ];

      expect(getComplianceFailure(baseline, violations)).toMatchObject({
        shouldFail: true,
        newErrors: 1,
        amberErrors: 1,
        delta: 0,
      });
    });

    it('does not flag approved semantic warning tokens', () => {
      expect(
        scanContent(`
          <div className="bg-semantic-warning-muted text-semantic-warning-muted-foreground" />
        `),
      ).toEqual([]);
    });
  });
});
