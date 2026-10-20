import fs from 'fs';
import path from 'path';

const readCss = (relative: string) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');

describe('reduced motion', () => {
  it('is honoured app-wide, not only inside the scanner context', () => {
    const globalsCss = readCss('../../globals.css');
    const rule = globalsCss.match(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/);

    expect(rule).not.toBeNull();
    expect(rule?.[1]).toMatch(/^\s*\*,\s*\*::before,\s*\*::after\s*{/);
    expect(rule?.[1]).toContain('animation-duration: 0.01ms !important');
    expect(rule?.[1]).toContain('transition-duration: 0.01ms !important');
  });

  it('keeps no infinite decorative animation in the storage quota modal', () => {
    const quotaCss = readCss('../StorageQuotaWarning.css');

    expect(quotaCss).not.toMatch(/infinite/);
    expect(quotaCss).not.toMatch(/translateY\(-1px\)/);
  });

  it('styles the storage quota modal from design tokens, not hard-coded hex', () => {
    const quotaCss = readCss('../StorageQuotaWarning.css');

    expect(quotaCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(quotaCss).toContain('var(--surface-1)');
  });
});
