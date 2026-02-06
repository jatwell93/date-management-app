/**
 * Integration Tests for Database Factory
 *
 * Verifies Prisma connectivity for SQLite (always) and Neon (opt-in).
 */

import { createDatabaseClient, getDatabaseProvider } from '../../database/database-factory';

describe('DatabaseFactory Integration', () => {
  it('connects to SQLite in test environment', async () => {
    process.env.NODE_ENV = 'test';

    const client = createDatabaseClient({
      environment: 'test',
      connectionUrl: 'file:./test.db',
    });

    await expect(client.$connect()).resolves.toBeUndefined();
    await client.$disconnect();
  });

  it('reports sqlite provider for test environment', () => {
    process.env.NODE_ENV = 'test';

    const provider = getDatabaseProvider({ environment: 'test' });

    expect(provider).toBe('sqlite');
  });

  const neonIntegrationEnabled = process.env.RUN_NEON_INTEGRATION_TESTS === 'true';
  const neonUrl = process.env.NEON_CONNECTION_STRING || process.env.DATABASE_URL;

  (neonIntegrationEnabled && neonUrl ? describe : describe.skip)('Neon PostgreSQL', () => {
    it('connects to Neon using production environment', async () => {
      process.env.NODE_ENV = 'production';

      const client = createDatabaseClient({
        environment: 'production',
        connectionUrl: neonUrl,
      });

      await expect(client.$connect()).resolves.toBeUndefined();
      await client.$disconnect();
    });

    it('reports postgresql provider for production environment', () => {
      const provider = getDatabaseProvider({ environment: 'production' });

      expect(provider).toBe('postgresql');
    });
  });
});
