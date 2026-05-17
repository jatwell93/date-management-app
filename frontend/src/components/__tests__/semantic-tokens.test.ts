import designTokens from '../../theme/design-tokens.json';
import { brandColors, surfaceColors } from '../../theme/tokens';
import {
  semanticPrimary,
  semanticSecondary,
  semanticWarning,
  semanticSuccess,
  semanticCritical,
  semanticSurface,
  semanticText,
  semanticDataViz,
  semanticColors,
} from '../../theme/semantic-tokens';

describe('Semantic Tokens', () => {
  describe('token exports match design-tokens.json', () => {
    it('brandColors match design-tokens.json brand values', () => {
      expect(brandColors.teal).toBe('#0F766E');
      expect(brandColors['sky-blue']).toBe('#0EA5E9');
      expect(brandColors.amber).toBe('#D97706');
      expect(brandColors.green).toBe('#10B981');
      expect(brandColors.red).toBe('#DC2626');
      expect(brandColors.navy).toBe('#0F172A');
      expect(brandColors['sky-light']).toBe('#F0F9FF');
    });

    it('surfaceColors match design-tokens.json surface values', () => {
      expect(surfaceColors.light['surface-1']).toBe('#FFFFFF');
      expect(surfaceColors.light['surface-2']).toBe('#F8FAFC');
      expect(surfaceColors.light['surface-3']).toBe('#F1F5F9');
      expect(surfaceColors.light['surface-4']).toBe('#E2E8F0');

      expect(surfaceColors.dark['surface-1']).toBe('#0F172A');
      expect(surfaceColors.dark['surface-2']).toBe('#1E293B');
      expect(surfaceColors.dark['surface-3']).toBe('#334155');
      expect(surfaceColors.dark['surface-4']).toBe('#475569');
    });
  });

  describe('semantic color mappings resolve to correct brand tokens', () => {
    it('primary maps to teal', () => {
      expect(semanticPrimary.DEFAULT).toBe(designTokens.colors.brand.teal);
      expect(semanticPrimary.foreground).toBe('#FFFFFF');
    });

    it('secondary maps to sky-blue', () => {
      expect(semanticSecondary.DEFAULT).toBe(designTokens.colors.brand['sky-blue']);
      expect(semanticSecondary.foreground).toBe('#FFFFFF');
      expect(semanticSecondary.muted).toBe(designTokens.colors.brand['sky-light']);
    });

    it('warning maps to amber', () => {
      expect(semanticWarning.DEFAULT).toBe(designTokens.colors.brand.amber);
      expect(semanticWarning.foreground).toBe('#FFFFFF');
    });

    it('success maps to green', () => {
      expect(semanticSuccess.DEFAULT).toBe(designTokens.colors.brand.green);
      expect(semanticSuccess.foreground).toBe('#FFFFFF');
    });

    it('critical maps to red', () => {
      expect(semanticCritical.DEFAULT).toBe(designTokens.colors.brand.red);
      expect(semanticCritical.foreground).toBe('#FFFFFF');
    });

    it('data-viz series use correct brand token ordering', () => {
      expect(semanticDataViz.series1).toBe(designTokens.colors.brand.teal);
      expect(semanticDataViz.series2).toBe(designTokens.colors.brand['sky-blue']);
      expect(semanticDataViz.series3).toBe(designTokens.colors.brand.amber);
      expect(semanticDataViz.series4).toBe(designTokens.colors.brand.green);
      expect(semanticDataViz.series5).toBe(designTokens.colors.brand.red);
      expect(semanticDataViz.series6).toBe(designTokens.colors.brand.navy);
    });
  });

  describe('dark mode variants apply correctly', () => {
    it('surface tokens have light and dark variants', () => {
      expect(semanticSurface.light.background).toBe(designTokens.colors.surface.light['surface-1']);
      expect(semanticSurface.dark.background).toBe(designTokens.colors.surface.dark['surface-1']);

      expect(semanticSurface.light['surface-1']).toBe('#FFFFFF');
      expect(semanticSurface.dark['surface-1']).toBe('#0F172A');
    });

    it('text tokens have light and dark variants', () => {
      expect(semanticText.light.primary).toBe(designTokens.colors.brand.navy);
      expect(semanticText.dark.primary).toBe('#F1F5F9');

      expect(semanticText.light.inverse).toBe('#FFFFFF');
      expect(semanticText.dark.inverse).toBe(designTokens.colors.brand.navy);
    });

    it('surface ladder provides 4 steps in each mode', () => {
      const lightKeys = Object.keys(semanticSurface.light);
      const darkKeys = Object.keys(semanticSurface.dark);

      expect(lightKeys).toContain('surface-1');
      expect(lightKeys).toContain('surface-2');
      expect(lightKeys).toContain('surface-3');
      expect(lightKeys).toContain('surface-4');

      expect(darkKeys).toContain('surface-1');
      expect(darkKeys).toContain('surface-2');
      expect(darkKeys).toContain('surface-3');
      expect(darkKeys).toContain('surface-4');
    });
  });

  describe('aggregated export contains all categories', () => {
    it('semanticColors has all 8 categories', () => {
      expect(semanticColors).toHaveProperty('primary');
      expect(semanticColors).toHaveProperty('secondary');
      expect(semanticColors).toHaveProperty('warning');
      expect(semanticColors).toHaveProperty('success');
      expect(semanticColors).toHaveProperty('critical');
      expect(semanticColors).toHaveProperty('surface');
      expect(semanticColors).toHaveProperty('text');
      expect(semanticColors).toHaveProperty('dataViz');
    });

    it('each intent token has required sub-keys', () => {
      const intentTokens = [
        semanticPrimary,
        semanticSecondary,
        semanticWarning,
        semanticSuccess,
        semanticCritical,
      ];

      for (const token of intentTokens) {
        expect(token).toHaveProperty('DEFAULT');
        expect(token).toHaveProperty('foreground');
        expect(token).toHaveProperty('hover');
        expect(token).toHaveProperty('active');
        expect(token).toHaveProperty('muted');
        expect(token).toHaveProperty('muted-foreground');
      }
    });
  });
});
