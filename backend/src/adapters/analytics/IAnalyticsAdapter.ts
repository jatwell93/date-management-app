/**
 * Analytics Adapter Interface
 *
 * Abstracts database operations for analytics tracking.
 * Allows different implementations (SQLite, Prisma) without changing service logic.
 *
 * P0-2: Analytics adapter architecture
 */

import {
  AnalyticsEvent,
  AnalyticsEventType,
  UserSession,
  AnalyticsMetrics,
} from '../../services/analytics.service';

export interface IAnalyticsAdapter {
  /**
   * Check if the adapter is available and can be used
   */
  isAvailable(): boolean;

  /**
   * Initialize storage (create tables/models if needed)
   */
  initialize(): Promise<void> | void;

  /**
   * Store a batch of analytics events
   */
  storeEventsBatch(events: AnalyticsEvent[]): Promise<void> | void;

  /**
   * Start a new user session
   * @returns sessionId
   */
  startSession(
    session: Omit<UserSession, 'id' | 'startTime'>,
    sessionId: string,
  ): Promise<string> | string;

  /**
   * End a user session
   */
  endSession(sessionId: string): Promise<void> | void;

  /**
   * Update session metrics
   */
  updateSession(
    sessionId: string,
    updates: { pagesViewed?: number; actionsTaken?: number },
  ): Promise<void> | void;

  /**
   * Get analytics metrics for a date range
   */
  getMetrics(startDate: Date, endDate: Date): Promise<AnalyticsMetrics> | AnalyticsMetrics;

  /**
   * Get event count by type within a date range
   */
  getEventCountByType(
    eventType: AnalyticsEventType,
    startDate: Date,
    endDate: Date,
  ): Promise<number> | number;

  /**
   * Clean up old analytics data
   */
  cleanupOldData(retentionDays: number): Promise<number> | number;

  /**
   * Get active user count for a date range
   */
  getActiveUserCount(startDate: Date, endDate: Date): Promise<number> | number;
}
