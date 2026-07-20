import { readFileSync } from 'node:fs';
import path from 'node:path';
import frontendPackageJson from '../../package.json';

const fromRoot = (rel: string) => path.resolve(__dirname, '../../', rel);

describe('frontend startup scripts', () => {
  it('starts and builds through Vite', () => {
    expect(frontendPackageJson.scripts.start).toBe('vite');
    expect(frontendPackageJson.scripts.build).toBe('vite build');
    // The old CRA prestart tailwind:build step is gone — Tailwind is now
    // processed by Vite via PostCSS at dev/build time.
    expect(frontendPackageJson.scripts).not.toHaveProperty('prestart');
  });

  it('processes Tailwind through PostCSS (replacing the prebuilt tailwind-output.css)', () => {
    const postcssConfig = readFileSync(fromRoot('postcss.config.js'), 'utf8');
    expect(postcssConfig).toMatch(/tailwindcss/);
    // index.tsx imports the Tailwind source entrypoint, not the generated file.
    const indexEntry = readFileSync(fromRoot('src/index.tsx'), 'utf8');
    expect(indexEntry).toMatch(/import '\.\/index\.css'/);
  });

  it('serves SPA routes via Vite (no react-scripts/craco)', () => {
    // Vite's dev server provides history API fallback out of the box for the
    // default 'spa' appType, so routes such as /markdown-calculator resolve to
    // index.html without bespoke devServer config.
    const viteConfig = readFileSync(fromRoot('vite.config.ts'), 'utf8');
    expect(viteConfig).toMatch(/@vitejs\/plugin-react/);
    const allDeps = {
      ...frontendPackageJson.dependencies,
      ...frontendPackageJson.devDependencies,
    } as Record<string, string>;
    expect(allDeps).not.toHaveProperty('react-scripts');
    expect(allDeps).not.toHaveProperty('@craco/craco');
  });
});
