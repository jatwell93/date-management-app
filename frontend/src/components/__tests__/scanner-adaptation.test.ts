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
});
