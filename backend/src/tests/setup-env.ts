const testDatabasePath = process.env.TEST_DATABASE_PATH || process.env.DATABASE_PATH || './test.db';

process.env.TEST_DATABASE_PATH = testDatabasePath;
process.env.DATABASE_PATH = testDatabasePath;
process.env.DATABASE_URL = process.env.DATABASE_URL || `file:${testDatabasePath}`;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret';
process.env.TEST_AUTH_BYPASS = process.env.TEST_AUTH_BYPASS || 'true';
