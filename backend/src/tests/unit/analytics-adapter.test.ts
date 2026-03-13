/**
 * Analytics Adapter Contract Tests
 *
 * Verifies that both SQLite and Prisma adapters implement IAnalyticsAdapter correctly.
 *
 * P0-2: Adapter contract tests
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { join } from 'path';
import { SQLiteAnalyticsAdapter } from '../../adapters/analytics/SQLiteAnalyticsAdapter';
import { PrismaAnalyticsAdapter } from '../../adapters/analytics/PrismaAnalyticsAdapter';
import { IAnalyticsAdapter } from '../../adapters/analytics/IAnalyticsAdapter';
import { AnalyticsEventType } from '../../services/analytics.service';
import { PrismaClient } from '@prisma/client';

describe('Analytics Adapter Contract', () => {
  let sqliteAdapter: IAnalyticsAdapter;
  let prismaAdapter: IAnalyticsAdapter;
  let testDb: InstanceType<typeof Database>;
  let testPrisma: PrismaClient;

  beforeEach(() => {
    // Create in-memory SQLite for testing
    testDb = new Database(':memory:');
    sqliteAdapter = new SQLiteAnalyticsAdapter(testDb);

    // Create Prisma adapter
    testPrisma = new PrismaClient();
    prismaAdapter = new PrismaAnalyticsAdapter(testPrisma);
  });

  afterEach(() => {
    testDb.close();
  });

  describe('SQLite Adapter', () => {
    it('should report available when database supports exec()', () => {
      expect(sqliteAdapter.isAvailable()).toBe(true);
    });

    it('should initialize storage without errors', () => {
      expect(() => sqliteAdapter.initialize()).not.toThrow();
    });

    it('should store event batches synchronously', () => {
      sqliteAdapter.initialize();

      const events = [
        {
          userId: 1,
          sessionId: 'test-session',
          eventType: AnalyticsEventType.USER_LOGIN,
          eventCategory: 'auth',
          eventAction: 'login',
          timestamp: new Date(),
        },
      ];

      expect(() => sqliteAdapter.storeEventsBatch(events)).not.toThrow();
    });

    it('should start sessions and return session ID', () => {
      sqliteAdapter.initialize();

      const sessionId = sqliteAdapter.startSession(
        {
          userId: 1,
          sessionId: 'test-session-123',
          isPWA: false,
        },
        'test-session-123',
      );

      expect(sessionId).toBe('test-session-123');
    });

    it('should end sessions without errors', () => {
      sqliteAdapter.initialize();

      sqliteAdapter.startSession(
        {
          userId: 1,
          sessionId: 'test-session-456',
          isPWA: false,
        },
        'test-session-456',
      );

      expect(() => sqliteAdapter.endSession('test-session-456')).not.toThrow();
    });

    it('should return metrics for date range', async () => {
      sqliteAdapter.initialize();

      const startDate = new Date('2026-01-01');
      const endDate = new Date('2026-03-08');

      const metrics = await sqliteAdapter.getMetrics(startDate, endDate);

      expect(metrics).toHaveProperty('dailyActiveUsers');
      expect(metrics).toHaveProperty('weeklyActiveUsers');
      expect(metrics).toHaveProperty('totalSessions');
      expect(metrics).toHaveProperty('topEvents');
      expect(Array.isArray(metrics.topEvents)).toBe(true);
    });

    it('should count events by type', () => {
      sqliteAdapter.initialize();

      const count = sqliteAdapter.getEventCountByType(
        AnalyticsEventType.USER_LOGIN,
        new Date('2026-01-01'),
        new Date('2026-03-08'),
      );

      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should cleanup old data and return deleted count', () => {
      sqliteAdapter.initialize();

      const deleted = sqliteAdapter.cleanupOldData(90);

      expect(typeof deleted).toBe('number');
      expect(deleted).toBeGreaterThanOrEqual(0);
    });

    it('should get active user count', () => {
      sqliteAdapter.initialize();

      const count = sqliteAdapter.getActiveUserCount(
        new Date('2026-01-01'),
        new Date('2026-03-08'),
      );

      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Prisma Adapter', () => {
    it('should report available (graceful degradation)', () => {
      expect(prismaAdapter.isAvailable()).toBe(true);
    });

    it('should initialize without errors', async () => {
      await expect(prismaAdapter.initialize()).resolves.not.toThrow();
    });

    it('should handle event storage gracefully (stub)', async () => {
      const events = [
        {
          userId: 1,
          sessionId: 'test-session',
          eventType: AnalyticsEventType.PWA_INSTALL,
          eventCategory: 'pwa',
          eventAction: 'install',
          timestamp: new Date(),
        },
      ];

      await expect(prismaAdapter.storeEventsBatch(events)).resolves.not.toThrow();
    });

    it('should handle session start gracefully (stub)', async () => {
      const sessionId = await prismaAdapter.startSession(
        {
          userId: 1,
          sessionId: 'prisma-session',
          isPWA: true,
        },
        'prisma-session',
      );

      expect(sessionId).toBe('prisma-session');
    });

    it('should return zero metrics (graceful degradation)', async () => {
      const metrics = await prismaAdapter.getMetrics(
        new Date('2026-01-01'),
        new Date('2026-03-08'),
      );

      expect(metrics.dailyActiveUsers).toBe(0);
      expect(metrics.weeklyActiveUsers).toBe(0);
      expect(metrics.totalSessions).toBe(0);
      expect(metrics.topEvents).toEqual([]);
    });

    it('should return zero event count (graceful degradation)', async () => {
      const count = await prismaAdapter.getEventCountByType(
        AnalyticsEventType.SCAN_BARCODE,
        new Date('2026-01-01'),
        new Date('2026-03-08'),
      );

      expect(count).toBe(0);
    });

    it('should handle cleanup gracefully (stub)', async () => {
      const deleted = await prismaAdapter.cleanupOldData(90);

      expect(deleted).toBe(0);
    });
  });

  describe('Adapter Interface Compliance', () => {
    it('should both implement IAnalyticsAdapter interface', () => {
      const sqliteMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(sqliteAdapter));
      const prismaMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(prismaAdapter));

      const requiredMethods = [
        'isAvailable',
        'initialize',
        'storeEventsBatch',
        'startSession',
        'endSession',
        'updateSession',
        'getMetrics',
        'getEventCountByType',
        'cleanupOldData',
        'getActiveUserCount',
      ];

      requiredMethods.forEach((method) => {
        expect(sqliteMethods).toContain(method);
        expect(prismaMethods).toContain(method);
      });
    });
  });
});
