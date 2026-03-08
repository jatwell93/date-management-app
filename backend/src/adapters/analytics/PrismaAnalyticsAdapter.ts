/**
 * Prisma Analytics Adapter
 * 
 * Implements analytics storage using Prisma ORM.
 * Currently a stub that returns empty data - full implementation pending Prisma models.
 * 
 * P0-2: Prisma implementation of IAnalyticsAdapter (stub with graceful degradation)
 * 
 * TODO: Add Prisma schema models for:
 * - AnalyticsEvent
 * - UserSession
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
  constructor(private prisma: PrismaClient) {}

  isAvailable(): boolean {
    // Prisma adapter is available but returns empty data until models are added
    // This allows graceful degradation without crashes
    return true;
  }

  async initialize(): Promise<void> {
    // Prisma migrations handle table creation
    // When AnalyticsEvent and UserSession models are added to schema.prisma,
    // run: npx prisma migrate dev --name add-analytics-models
    Logger.info('Prisma analytics adapter initialized (models pending)');
  }

  async storeEventsBatch(events: AnalyticsEvent[]): Promise<void> {
    // TODO: Implement when Prisma models exist
    // await this.prisma.analyticsEvent.createMany({ data: events });
    Logger.debug('Analytics events not stored - Prisma models pending', {
      eventCount: events.length,
    });
  }

  async startSession(
    session: Omit<UserSession, 'id' | 'startTime'>,
    sessionId: string
  ): Promise<string> {
    // TODO: Implement when Prisma models exist
    // const created = await this.prisma.userSession.create({
    //   data: { ...session, sessionId, startTime: new Date() }
    // });
    Logger.debug('Session not started - Prisma models pending', {
      userId: session.userId,
      sessionId,
    });
    return sessionId;
  }

  async endSession(sessionId: string): Promise<void> {
    // TODO: Implement when Prisma models exist
    // await this.prisma.userSession.update({
    //   where: { sessionId },
    //   data: { endTime: new Date(), duration: calculateDuration() }
    // });
    Logger.debug('Session not ended - Prisma models pending', { sessionId });
  }

  async updateSession(
    sessionId: string,
    updates: { pagesViewed?: number; actionsTaken?: number }
  ): Promise<void> {
    // TODO: Implement when Prisma models exist
    // await this.prisma.userSession.update({
    //   where: { sessionId },
    //   data: updates
    // });
    Logger.debug('Session not updated - Prisma models pending', { sessionId, updates });
  }

  async getMetrics(startDate: Date, endDate: Date): Promise<AnalyticsMetrics> {
    // Return empty metrics until Prisma models exist
    // This provides graceful degradation without crashes
    return {
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
  }

  async getEventCountByType(
    eventType: AnalyticsEventType,
    startDate: Date,
    endDate: Date
  ): Promise<number> {
    // TODO: Implement when Prisma models exist
    // return await this.prisma.analyticsEvent.count({
    //   where: { eventType, timestamp: { gte: startDate, lte: endDate } }
    // });
    return 0;
  }

  async cleanupOldData(retentionDays: number): Promise<number> {
    // TODO: Implement when Prisma models exist
    // const cutoffDate = new Date();
    // cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    // const result = await this.prisma.analyticsEvent.deleteMany({
    //   where: { timestamp: { lt: cutoffDate } }
    // });
    // return result.count;
    return 0;
  }

  async getActiveUserCount(startDate: Date, endDate: Date): Promise<number> {
    // TODO: Implement when Prisma models exist
    // const users = await this.prisma.analyticsEvent.findMany({
    //   where: { timestamp: { gte: startDate, lte: endDate } },
    //   distinct: ['userId']
    // });
    // return users.length;
    return 0;
  }
}
