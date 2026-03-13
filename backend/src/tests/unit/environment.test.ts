/**
 * Unit Tests for Environment Configuration
 */

const originalEnv = process.env;

const loadEnvModule = () => {
  jest.resetModules();
  // Mock dotenv to prevent file loading interference
  jest.doMock('dotenv', () => ({
    config: jest.fn(),
  }));
  return require('../../config/environment') as typeof import('../../config/environment');
};

describe('EnvironmentConfig', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  const mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called');
  }) as any);
  const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

  afterAll(() => {
    process.env = originalEnv;
    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  it('defaults to development when NODE_ENV is missing', () => {
    delete process.env.NODE_ENV;
    delete process.env.PORT;
    process.env.JWT_SECRET = 'dev-secret';

    const envModule = loadEnvModule();

    expect(envModule.envConfig.NODE_ENV).toBe('development');
    expect(envModule.envConfig.PORT).toBe(3001);
    expect(envModule.envConfig.JWT_SECRET).toBe('dev-secret');
  });

  it('uses provided JWT_SECRET when NODE_ENV is test', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.PORT;
    process.env.JWT_SECRET = 'test_secret';

    const envModule = loadEnvModule();

    expect(envModule.envConfig.NODE_ENV).toBe('test');
    expect(envModule.envConfig.PORT).toBe(3001);
    expect(envModule.envConfig.JWT_SECRET).toBe('test_secret');
  });

  it('throws when development is missing JWT_SECRET', () => {
    process.env.NODE_ENV = 'development';
    process.env.PORT = '3001';
    delete process.env.JWT_SECRET;

    expect(() => loadEnvModule()).toThrow('process.exit called');
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('JWT_SECRET environment variable is missing or empty'),
    );
  });

  it('throws when production is missing JWT_SECRET', () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '3001';
    delete process.env.JWT_SECRET;

    expect(() => loadEnvModule()).toThrow('process.exit called');
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('JWT_SECRET environment variable is missing or empty'),
    );
  });

  it('allows worker config injection', () => {
    const envModule = loadEnvModule();

    envModule.setWorkerConfig({
      NODE_ENV: 'production',
      PORT: '8080',
      JWT_SECRET: 'worker-secret',
    });

    expect(envModule.envConfig.NODE_ENV).toBe('production');
    expect(envModule.envConfig.PORT).toBe(8080);
    expect(envModule.envConfig.JWT_SECRET).toBe('worker-secret');
  });
});
