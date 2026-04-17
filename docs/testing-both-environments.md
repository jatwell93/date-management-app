# Testing Both Development and Production Environments

This document describes how to run tests in both SQLite (development) and PostgreSQL/Neon (production) environments.

## Overview

The test suite supports two modes:

- **Development Mode (SQLite)**: Uses local SQLite database for fast testing without cloud dependencies
- **Production Mode (PostgreSQL/Neon)**: Tests against Neon PostgreSQL to verify production compatibility

## Running Tests

### Development Mode (Default)

```bash
cd backend
npm run test:dev
```

This runs all tests against `test.db` (SQLite) in development mode.

**Expected Result**: 37 test suites, 297 tests passing

### Production Mode (Neon PostgreSQL)

```bash
cd backend
npm run test:prod
```

This runs all tests against Neon PostgreSQL (requires `NEON_CONNECTION_STRING` in `.env`).

**Prerequisites**:

- Valid `NEON_CONNECTION_STRING` in `.env` file
- Network access to Neon database
- Database already created and accessible

**Expected Result**: Same 37 test suites, 297 tests passing against PostgreSQL

### Running Both Modes

```bash
cd backend
npm run test:both
```

This runs the full test suite first in development mode, then in production mode.

## Configuration

### Environment Variables

**Development** (automatic via `setup-env.ts`):

```
DATABASE_URL=file:./test.db
DATABASE_PATH=./test.db
NODE_ENV=test
TEST_AUTH_BYPASS=true
```

**Production** (via `setup-neon-env.ts`):

```
DATABASE_URL=<NEON_CONNECTION_STRING>
NODE_ENV=production
DATABASE_DRIVER=postgresql
TEST_AUTH_BYPASS=true
```

### Jest Configuration

- **Development**: `jest.config.js` (uses `test-setup.js` and `setup-env.ts`)
- **Production**: `jest.config.neon.js` (uses `test-setup-neon.js` and `setup-neon-env.ts`)

## Test Database Migration

### Development

SQLite migrations are automatically applied to `test.db` via:

- `global.setup`: `test-setup.js` (runs `npx prisma db push`)
- Database path: `./test.db`

### Production

PostgreSQL migrations are applied to Neon via:

- `global.setup`: `test-setup-neon.js` (runs `npx prisma db push`)
- Connection: `NEON_CONNECTION_STRING`
- Graceful fallback if network unavailable

## Troubleshooting

### Production Tests Fail with Network Error

**Issue**: `Failed to migrate Neon test database`

**Solution**:

1. Verify `NEON_CONNECTION_STRING` is set in `.env`
2. Check network connectivity to Neon
3. Verify database exists and is accessible
4. Tests will gracefully fall back to development mode

### Connection Refused

**Issue**: Tests timeout or connection denied

**Solution**:

1. Verify Neon connection string is valid
2. Check if Neon database is running
3. Verify IP whitelisting if applicable
4. Use development mode if production unavailable

## CI/CD Integration

For GitHub Actions or other CI/CD systems:

```yaml
# Run development tests (fast, no external dependencies)
- run: npm run test:dev

# Optionally run production tests if credentials available
- if: secrets.NEON_CONNECTION_STRING
  run: |
    echo "NEON_CONNECTION_STRING=${{ secrets.NEON_CONNECTION_STRING }}" >> .env
    npm run test:prod
```

## Performance Notes

- **Development**: ~38 seconds for full suite (SQLite on local filesystem)
- **Production**: ~38 seconds for full suite (Neon PostgreSQL with 50ms round-trip latency)

Both environments perform similarly due to:

- Serialized test execution (`maxWorkers: 1`)
- 30 second timeout per test
- Database seed/cleanup between tests
