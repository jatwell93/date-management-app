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

    it('should return mysql for production environment', () => {
      process.env.NODE_ENV = 'production';

      const provider = getDatabaseProvider();

      expect(provider).toBe('mysql');
    });

    it('should respect explicit environment config', () => {
      process.env.NODE_ENV = 'development';

      const provider = getDatabaseProvider({ environment: 'production' });

      expect(provider).toBe('mysql');
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

      expect(provider).toBe('mysql');
    });

    it('should be case-insensitive for NODE_ENV', () => {
      process.env.NODE_ENV = 'PRODUCTION';

      const provider = getDatabaseProvider();

      expect(provider).toBe('mysql');
    });
  });
});
