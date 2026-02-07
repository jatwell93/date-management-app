// Production/Neon environment setup for testing against PostgreSQL
// Load from environment or gracefully skip
process.env.DATABASE_DRIVER = 'postgresql';
process.env.NODE_ENV = 'production';
process.env.TEST_AUTH_BYPASS = 'true';

// Use NEON_CONNECTION_STRING from .env if available, fallback to DATABASE_URL
if (!process.env.DATABASE_URL && process.env.NEON_CONNECTION_STRING) {
  process.env.DATABASE_URL = process.env.NEON_CONNECTION_STRING;
}

// Don't use SQLite in production mode
delete process.env.DATABASE_PATH;
