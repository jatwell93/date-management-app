type EnvironmentOverrides = {
  DATABASE_PROVIDER: string;
  DATABASE_URL?: string;
  NODE_ENV: string;
  DATABASE_PATH: string;
};

const defaultEnv: EnvironmentOverrides = {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: 'file:./test.db',
  NODE_ENV: 'test',
  DATABASE_PATH: './test.db',
};

const loadDatabaseModule = async (overrides: Partial<EnvironmentOverrides> = {}) => {
  jest.resetModules();

  const databaseCtor = jest.fn().mockImplementation(() => ({ mockDb: true }));
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  jest.doMock('better-sqlite3', () => ({
    __esModule: true,
    default: databaseCtor,
  }));

  jest.doMock('../../config/environment', () => ({
    envConfig: {
      ...defaultEnv,
      ...overrides,
    },
  }));

  jest.doMock('../../utils/logger', () => ({
    Logger: logger,
  }));

  const databaseModule = await import('../../database');

  return {
    databaseCtor,
    logger,
    ...databaseModule,
  };
};

describe('database security verification', () => {
  afterEach(() => {
    jest.dontMock('better-sqlite3');
    jest.dontMock('../../config/environment');
    jest.dontMock('../../utils/logger');
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('logs sqlite informational message when provider is sqlite', async () => {
    const { getDb, logger } = await loadDatabaseModule({
      DATABASE_PROVIDER: 'sqlite',
      NODE_ENV: 'test',
    });

    getDb();

    expect(logger.info).toHaveBeenCalledWith(
      'ℹ️  Database: SQLite (local file, TLS/SSL not applicable)',
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('warns in production when postgres is missing sslmode=require', async () => {
    const { getDb, logger } = await loadDatabaseModule({
      DATABASE_PROVIDER: 'postgresql',
      DATABASE_URL: 'postgresql://user:pass@db.internal:5432/app',
      NODE_ENV: 'production',
    });

    getDb();

    expect(logger.error).toHaveBeenCalledWith(
      '⚠️  SECURITY WARNING: DATABASE_URL missing sslmode=require in production!',
    );
    expect(logger.error).toHaveBeenCalledWith(
      '   Add ?sslmode=require to DATABASE_URL for encrypted connections',
    );
  });

  it('logs tls enabled when postgres url includes sslmode=require', async () => {
    const { getDb, logger } = await loadDatabaseModule({
      DATABASE_PROVIDER: 'postgresql',
      DATABASE_URL: 'postgresql://user:pass@db.internal:5432/app?sslmode=require',
      NODE_ENV: 'production',
    });

    getDb();

    expect(logger.info).toHaveBeenCalledWith(
      '✅ Database TLS/SSL: Enabled (sslmode detected in connection string)',
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs non-production postgres mode when sslmode is not enforced', async () => {
    const { getDb, logger } = await loadDatabaseModule({
      DATABASE_PROVIDER: 'postgresql',
      DATABASE_URL: 'postgresql://user:pass@db.internal:5432/app',
      NODE_ENV: 'test',
    });

    getDb();

    expect(logger.info).toHaveBeenCalledWith(
      'ℹ️  Database TLS/SSL: Not enforced (test environment)',
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('warns when DATABASE_URL is missing for postgres provider', async () => {
    const { getDb, logger } = await loadDatabaseModule({
      DATABASE_PROVIDER: 'postgresql',
      DATABASE_URL: undefined,
      NODE_ENV: 'production',
    });

    getDb();

    expect(logger.warn).toHaveBeenCalledWith('DATABASE_URL not configured for PostgreSQL');
  });

  it('logs unknown provider names', async () => {
    const { getDb, logger } = await loadDatabaseModule({
      DATABASE_PROVIDER: 'mysql',
      NODE_ENV: 'test',
    });

    getDb();

    expect(logger.info).toHaveBeenCalledWith('ℹ️  Database Provider: mysql');
  });

  it('returns the same db instance and only opens one connection', async () => {
    const { getDb, databaseCtor } = await loadDatabaseModule({
      DATABASE_PROVIDER: 'sqlite',
      DATABASE_PATH: './singleton.db',
    });

    const first = getDb();
    const second = getDb();

    expect(first).toBe(second);
    expect(databaseCtor).toHaveBeenCalledTimes(1);
    expect(databaseCtor).toHaveBeenCalledWith('./singleton.db');
  });
});
