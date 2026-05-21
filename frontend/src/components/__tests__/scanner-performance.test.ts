import fs from 'fs';
import path from 'path';

describe('Scanner performance boundaries', () => {
  it('keeps camera scanning out of the initial text-mode scanner bundle', () => {
    const scannerSource = fs.readFileSync(path.join(__dirname, '..', 'Scanner.tsx'), 'utf8');

    expect(scannerSource).not.toMatch(
      /import\s+\{\s*CameraScanner\s*\}\s+from\s+['"]\.\/CameraScanner['"]/,
    );
    expect(scannerSource).toMatch(/lazy\(\(\)\s*=>\s*import\(['"]\.\/CameraScanner['"]\)/);
  });
});
