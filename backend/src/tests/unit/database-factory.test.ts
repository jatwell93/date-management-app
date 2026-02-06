/**
 * Unit Tests for Database Factory
 *
 * Tests environment-based Prisma client creation and configuration.
 */

import {
  createDatabaseClient,
  getDatabaseProvider,
  getDefaultDatabaseClient,
  resetDefaultDatabaseClient,
  withTransaction,
  withTransactionOptions,
} from '../../database/database-factory';
import { PrismaClient } from '@prisma/client';

// Store original env
const originalEnv = process.env;

describe('DatabaseFactory', () => {
  beforeEach(async () => {
    // Reset environment and default client for each test
    process.env = { ...originalEnv };
    await resetDefaultDatabaseClient();
  });

  afterAll(async () => {
    // Restore original environment
    process.env = originalEnv;
    await resetDefaultDatabaseClient();
  });

  describe('createDatabaseClient', () => {
    it('should create a PrismaClient instance', () => {
      const client = createDatabaseClient({
        connectionUrl: 'file:./test.db',
      });

      expect(client).toBeInstanceOf(PrismaClient);
    });

    it('should use DATABASE_URL from environment when no config URL provided', () => {
      process.env.DATABASE_URL = 'file:./env-test.db';

      const client = createDatabaseClient();

      expect(client).toBeInstanceOf(PrismaClient);
    });

    it('should prefer config URL over environment variable', () => {
      process.env.DATABASE_URL = 'file:./env-test.db';

      const client = createDatabaseClient({
        connectionUrl: 'file:./config-test.db',
      });

      expect(client).toBeInstanceOf(PrismaClient);
    });

    it('should use hyperdrive connection string when provided', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

      const client = createDatabaseClient({
        hyperdriveConnectionString: 'postgresql://hyperdrive.test/db',
      });

      expect(client).toBeInstanceOf(PrismaClient);
      expect(logSpy).toHaveBeenCalledWith(
        '[Database] Connecting via Cloudflare Hyperdrive (edge pooling)',
      );

      logSpy.mockRestore();
    });

    it('should throw when production has no database URL', () => {
      delete process.env.NEON_CONNECTION_STRING;
      delete process.env.DATABASE_URL;

      expect(() =>
        createDatabaseClient({
          environment: 'production',
        }),
      ).toThrow('Production environment requires NEON_CONNECTION_STRING or DATABASE_URL');
    });
  });

  describe('getDatabaseProvider', () => {
    it('should return sqlite for development environment', () => {
      process.env.NODE_ENV = 'development';

      const provider = getDatabaseProvider();

      expect(provider).toBe('sqlite');
    });

    it('should return sqlite for test environment', () => {
      process.env.NODE_ENV = 'test';

      const provider = getDatabaseProvider();

      expect(provider).toBe('sqlite');
    });

    it('should return postgresql for production environment', () => {
      process.env.NODE_ENV = 'production';

      const provider = getDatabaseProvider();

      expect(provider).toBe('postgresql');
    });

    it('should respect explicit environment config', () => {
      process.env.NODE_ENV = 'development';

      const provider = getDatabaseProvider({ environment: 'production' });

      expect(provider).toBe('postgresql');
    });

    it('should default to sqlite when NODE_ENV is undefined', () => {
      delete process.env.NODE_ENV;

      const provider = getDatabaseProvider();

      expect(provider).toBe('sqlite');
    });
  });

  describe('getDefaultDatabaseClient (singleton)', () => {
    it('should return the same instance on multiple calls', () => {
      process.env.DATABASE_URL = 'file:./singleton-test.db';

      const client1 = getDefaultDatabaseClient();
      const client2 = getDefaultDatabaseClient();

      expect(client1).toBe(client2);
    });

    it('should create new instance after reset', async () => {
      process.env.DATABASE_URL = 'file:./reset-test.db';

      const client1 = getDefaultDatabaseClient();
      await resetDefaultDatabaseClient();
      const client2 = getDefaultDatabaseClient();

      expect(client1).not.toBe(client2);
    });
  });

  describe('resetDefaultDatabaseClient', () => {
    it('should disconnect the client on reset', async () => {
      process.env.DATABASE_URL = 'file:./disconnect-test.db';

      const client = getDefaultDatabaseClient();
      const disconnectSpy = jest.spyOn(client, '$disconnect');

      await resetDefaultDatabaseClient();

      expect(disconnectSpy).toHaveBeenCalled();
    });

    it('should handle multiple resets gracefully', async () => {
      // First reset when no client exists
      await expect(resetDefaultDatabaseClient()).resolves.not.toThrow();

      // Create client and reset
      getDefaultDatabaseClient();
      await expect(resetDefaultDatabaseClient()).resolves.not.toThrow();

      // Second reset when client is already cleared
      await expect(resetDefaultDatabaseClient()).resolves.not.toThrow();
    });
  });

  describe('environment detection', () => {
    it('should detect development from NODE_ENV', () => {
      process.env.NODE_ENV = 'development';

      const provider = getDatabaseProvider();

      expect(provider).toBe('sqlite');
    });

    it('should detect production from NODE_ENV', () => {
      process.env.NODE_ENV = 'production';

      const provider = getDatabaseProvider();

      expect(provider).toBe('postgresql');
    });

    it('should be case-insensitive for NODE_ENV', () => {
      process.env.NODE_ENV = 'PRODUCTION';

      const provider = getDatabaseProvider();

      expect(provider).toBe('postgresql');
    });
  });

  describe('transaction helpers', () => {
    it('should delegate to client.$transaction', async () => {
      const txResult = { ok: true };
      const client = {
        $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
      } as unknown as PrismaClient;

      const result = await withTransaction(client, async () => txResult);

      expect(result).toBe(txResult);
      expect(client.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should pass options to client.$transaction', async () => {
      const client = {
        $transaction: jest.fn(async (_fn: (tx: unknown) => Promise<unknown>) => 'ok'),
      } as unknown as PrismaClient;

      await withTransactionOptions(client, async () => 'ok', { maxWait: 1000, timeout: 5000 });

      expect(client.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        maxWait: 1000,
        timeout: 5000,
      });
    });
  });
});
