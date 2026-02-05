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
    delete process.env.JWT_SECRET;

    const envModule = loadEnvModule();

    expect(envModule.envConfig.NODE_ENV).toBe('development');
    expect(envModule.envConfig.PORT).toBe(3001);
    expect(envModule.envConfig.JWT_SECRET).toBe('dev-secret');
  });

  it('uses test defaults when NODE_ENV is test and JWT_SECRET missing', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.PORT;
    delete process.env.JWT_SECRET;

    const envModule = loadEnvModule();

    expect(envModule.envConfig.NODE_ENV).toBe('test');
    expect(envModule.envConfig.PORT).toBe(3001);
    expect(envModule.envConfig.JWT_SECRET).toBe('test-secret');
  });

  it('throws when production is missing JWT_SECRET', () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '3001';
    delete process.env.JWT_SECRET;

    expect(() => loadEnvModule()).toThrow('process.exit called');
    expect(mockConsoleError).toHaveBeenCalledWith('JWT_SECRET environment variable is empty');
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
