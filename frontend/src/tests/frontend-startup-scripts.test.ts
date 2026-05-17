import frontendPackageJson from '../../package.json';

describe('frontend startup scripts', () => {
  it('rebuilds generated Tailwind CSS before starting the frontend dev server', () => {
    expect(frontendPackageJson.scripts.prestart).toBe('npm run tailwind:build');
    expect(frontendPackageJson.scripts.start).toBe('cross-env PORT=3002 craco start');
  });
});
