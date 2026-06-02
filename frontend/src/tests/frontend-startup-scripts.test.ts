import frontendPackageJson from '../../package.json';
const cracoConfig = require('../../craco.config.js');

describe('frontend startup scripts', () => {
  it('rebuilds generated Tailwind CSS before starting the frontend dev server', () => {
    expect(frontendPackageJson.scripts.prestart).toBe('npm run tailwind:build');
    expect(frontendPackageJson.scripts.start).toBe('cross-env PORT=3002 craco start');
  });

  it('serves React routes such as /markdown-calculator through the frontend dev server fallback', () => {
    const devServerConfig = cracoConfig.devServer({ historyApiFallback: false });

    expect(devServerConfig.historyApiFallback).toEqual(
      expect.objectContaining({
        disableDotRule: true,
        index: '/index.html',
      }),
    );
  });
});
