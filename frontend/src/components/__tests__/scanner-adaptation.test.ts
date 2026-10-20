import fs from 'fs';
import path from 'path';

const scannerAdaptationCss = fs.readFileSync(
  path.resolve(__dirname, '../../theme/scanner-adaptation.css'),
  'utf8',
);

describe('scanner adaptation stylesheet', () => {
  it('covers same-element scanner context selectors for handheld layout surfaces', () => {
    expect(scannerAdaptationCss).toContain('.scanner-context.handheld-scanner');
    expect(scannerAdaptationCss).toContain(".scanner-context[class*='handheld-scan-toolbar']");
  });

  it('applies the 48px glove target floor across the whole handheld layout', () => {
    expect(scannerAdaptationCss).toMatch(/\.handheld-layout button,[^{]*{\s*min-height: 48px;/s);
  });

  it('does not pin handheld camera height to brittle viewport math', () => {
    expect(scannerAdaptationCss).not.toContain('calc(100vh');
    expect(scannerAdaptationCss).not.toMatch(
      /\.scanner-context \.camera-scanner-fullscreen \.camera-scanner\s*{[^}]*!important/s,
    );
    expect(scannerAdaptationCss).toContain('min-height: 0');
  });
});
