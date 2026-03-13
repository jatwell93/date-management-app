/**
 * Prisma analytics adapter (graceful-degradation stub).
 *
 * Until analytics Prisma models are available, methods are intentionally no-op and
 * return safe default values so analytics callers never crash.
 */

import { PrismaClient } from '@prisma/client';
import { IAnalyticsAdapter } from './IAnalyticsAdapter';
import {
  AnalyticsEvent,
  AnalyticsEventType,
  UserSession,
  AnalyticsMetrics,
} from '../../services/analytics.service';
import { Logger } from '../../utils/logger';

export class PrismaAnalyticsAdapter implements IAnalyticsAdapter {
  private static readonly EMPTY_METRICS: AnalyticsMetrics = {
    dailyActiveUsers: 0,
    weeklyActiveUsers: 0,
    monthlyActiveUsers: 0,
    totalSessions: 0,
    averageSessionDuration: 0,
    topEvents: [],
    userRetention: 0,
    pwaInstallationRate: 0,
    offlineUsageRate: 0,
  };

  constructor(private readonly prisma: PrismaClient) {}

  private logPendingModels(message: string, data?: Record<string, unknown>): void {
    Logger.debug(message, data);
  }

  isAvailable(): boolean {
    return true;
  }

  async initialize(): Promise<void> {
    Logger.info('Prisma analytics adapter initialized (models pending)');
  }

  async storeEventsBatch(events: AnalyticsEvent[]): Promise<void> {
    this.logPendingModels('Analytics events not stored - Prisma models pending', {
      eventCount: events.length,
    });
  }

  async startSession(
    session: Omit<UserSession, 'id' | 'startTime'>,
    sessionId: string,
  ): Promise<string> {
    this.logPendingModels('Session not started - Prisma models pending', {
      userId: session.userId,
      sessionId,
    });
    return sessionId;
  }

  async endSession(sessionId: string): Promise<void> {
    this.logPendingModels('Session not ended - Prisma models pending', { sessionId });
  }

  async updateSession(
    sessionId: string,
    updates: { pagesViewed?: number; actionsTaken?: number },
  ): Promise<void> {
    this.logPendingModels('Session not updated - Prisma models pending', { sessionId, updates });
  }

  async getMetrics(_startDate: Date, _endDate: Date): Promise<AnalyticsMetrics> {
    return PrismaAnalyticsAdapter.EMPTY_METRICS;
  }

  async getEventCountByType(
    _eventType: AnalyticsEventType,
    _startDate: Date,
    _endDate: Date,
  ): Promise<number> {
    return 0;
  }

  async cleanupOldData(_retentionDays: number): Promise<number> {
    return 0;
  }

  async getActiveUserCount(_startDate: Date, _endDate: Date): Promise<number> {
    return 0;
  }
}
