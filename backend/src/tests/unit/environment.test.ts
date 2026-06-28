/**
 * Unit Tests for Environment Configuration
 */

const originalEnv = process.env;

// Vitest's module mocking is async (the runner is ESM-based), so these loaders
// use `await import` instead of jest's synchronous `require`.
const loadEnvModule = async () => {
  vi.resetModules();
  // Mock dotenv to prevent file loading interference
  vi.doMock('dotenv', () => ({
    config: vi.fn(),
  }));
  return (await import('../../config/environment')) as typeof import('../../config/environment');
};

const loadCorsModule = async () => {
  vi.resetModules();
  vi.doMock('dotenv', () => ({
    config: vi.fn(),
  }));
  return (await import('../../middleware/cors')) as typeof import('../../middleware/cors');
};

describe('EnvironmentConfig', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called');
  }) as any);
  const mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

  afterAll(() => {
    process.env = originalEnv;
    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('defaults to development when NODE_ENV is missing', async () => {
    delete process.env.NODE_ENV;
    delete process.env.PORT;
    process.env.JWT_SECRET = 'dev-secret';

    const envModule = await loadEnvModule();

    expect(envModule.envConfig.NODE_ENV).toBe('development');
    expect(envModule.envConfig.PORT).toBe(3001);
    expect(envModule.envConfig.JWT_SECRET).toBe('dev-secret');
  });

  it('uses provided JWT_SECRET when NODE_ENV is test', async () => {
    process.env.NODE_ENV = 'test';
    delete process.env.PORT;
    process.env.JWT_SECRET = 'test_secret';

    const envModule = await loadEnvModule();

    expect(envModule.envConfig.NODE_ENV).toBe('test');
    expect(envModule.envConfig.PORT).toBe(3001);
    expect(envModule.envConfig.JWT_SECRET).toBe('test_secret');
  });

  it('throws when development is missing JWT_SECRET', async () => {
    process.env.NODE_ENV = 'development';
    process.env.PORT = '3001';
    // Set to '' rather than delete: the SUT loads .env via a source-level
    // require('dotenv') that Vitest's vi.doMock cannot intercept, and dotenv
    // would repopulate a *deleted* JWT_SECRET from .env.development. dotenv never
    // overrides an already-present key, so '' stays empty and still fails validation.
    process.env.JWT_SECRET = '';

    await expect(loadEnvModule()).rejects.toThrow('process.exit called');
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('JWT_SECRET environment variable is missing or empty'),
    );
  });

  it('throws when production is missing JWT_SECRET', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '3001';
    // See note above: set '' instead of delete so dotenv cannot repopulate it.
    process.env.JWT_SECRET = '';

    await expect(loadEnvModule()).rejects.toThrow('process.exit called');
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('JWT_SECRET environment variable is missing or empty'),
    );
  });

  it('allows worker config injection', async () => {
    const envModule = await loadEnvModule();

    envModule.setWorkerConfig({
      NODE_ENV: 'production',
      PORT: '8080',
      JWT_SECRET: 'worker-secret',
    });

    expect(envModule.envConfig.NODE_ENV).toBe('production');
    expect(envModule.envConfig.PORT).toBe(8080);
    expect(envModule.envConfig.JWT_SECRET).toBe('worker-secret');
  });

  it('blocks requests without an Origin header in production by default', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '3001';
    process.env.JWT_SECRET = 'prod-secret';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    delete process.env.ALLOW_NO_ORIGIN_IN_PRODUCTION;

    const corsModule = await loadCorsModule();

    expect(corsModule.isOriginAllowed()).toBe(false);
    expect(corsModule.isOriginAllowed('https://app.example.com')).toBe(true);
  });

  it('allows requests without an Origin header in production when explicitly enabled', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '3001';
    process.env.JWT_SECRET = 'prod-secret';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    process.env.ALLOW_NO_ORIGIN_IN_PRODUCTION = 'true';

    const corsModule = await loadCorsModule();

    expect(corsModule.isOriginAllowed()).toBe(true);
  });
});
