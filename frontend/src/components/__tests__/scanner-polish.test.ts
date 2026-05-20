import fs from 'fs';
import path from 'path';

describe('Scanner polish boundaries', () => {
  it('uses shared form and button primitives instead of one-off scanner controls', () => {
    const scannerSource = fs.readFileSync(path.join(__dirname, '..', 'Scanner.tsx'), 'utf8');
    const cameraScannerSource = fs.readFileSync(
      path.join(__dirname, '..', 'CameraScanner.tsx'),
      'utf8',
    );
    const scanPageSource = fs.readFileSync(
      path.join(__dirname, '..', '..', 'pages', 'ScanPage.tsx'),
      'utf8',
    );

    expect(scannerSource).toContain("import { Button } from './ui/button'");
    expect(scannerSource).toContain("import { Input } from './ui/input'");
    expect(scannerSource).toContain("import { Label } from './ui/label'");
    expect(scannerSource).not.toContain('bg-primary hover:bg-primary/90');
    expect(scannerSource).not.toContain('bg-secondary hover:bg-secondary/80');

    expect(cameraScannerSource).toContain("import { Button } from './ui/button'");
    expect(cameraScannerSource).not.toContain('bg-primary hover:bg-primary/90');

    expect(scanPageSource).not.toContain('bg-primary hover:bg-primary/90');
  });
});
