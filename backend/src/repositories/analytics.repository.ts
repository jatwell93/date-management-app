/**
 * Analytics Repository
 *
 * Data access layer for analytics events and user sessions.
 * Handles all database operations for analytics tracking.
 *
 * Task 8.2: Create analytics repository with dependency injection
 */

import Database from 'better-sqlite3';
import {
  AnalyticsEvent,
  AnalyticsEventType,
  UserSession,
  AnalyticsMetrics,
} from '../services/analytics.service';

export class AnalyticsRepository {
  constructor(private db: InstanceType<typeof Database>) {}

  /**
   * Initialize analytics tables if they don't exist
   */
  initializeTables(): void {
    try {
      // Create analytics_events table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS analytics_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER,
          session_id TEXT,
          event_type TEXT NOT NULL,
          event_category TEXT NOT NULL,
          event_action TEXT NOT NULL,
          event_label TEXT,
          event_value INTEGER,
          user_agent TEXT,
          ip_address TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          metadata TEXT
        )
      `);

      // Create user_sessions table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          session_id TEXT NOT NULL UNIQUE,
          start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
          end_time DATETIME,
          duration INTEGER,
          pages_viewed INTEGER DEFAULT 0,
          actions_taken INTEGER DEFAULT 0,
          is_pwa BOOLEAN DEFAULT FALSE
        )
      `);

      // Create indexes for performance
      this.db.exec(
        'CREATE INDEX IF NOT EXISTS idx_analytics_events_timestamp ON analytics_events(timestamp)',
      );
      this.db.exec(
        'CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id ON analytics_events(user_id)',
      );
      this.db.exec(
        'CREATE INDEX IF NOT EXISTS idx_analytics_events_event_type ON analytics_events(event_type)',
      );
      this.db.exec(
        'CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)',
      );
      this.db.exec(
        'CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id ON user_sessions(session_id)',
      );
    } catch (error) {
      Logger.error('Failed to initialize analytics tables', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Store a batch of events to the database
   */
  storeEventsBatch(events: AnalyticsEvent[]): void {
    const transaction = this.db.transaction((events: AnalyticsEvent[]) => {
      const stmt = this.db.prepare(`
        INSERT INTO analytics_events (
          user_id,
          session_id,
          event_type,
          event_category,
          event_action,
          event_label,
          event_value,
          user_agent,
          ip_address,
          timestamp,
          metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const event of events) {
        stmt.run(
          event.userId || null,
          event.sessionId || null,
          event.eventType,
          event.eventCategory,
          event.eventAction,
          event.eventLabel || null,
          event.eventValue || null,
          event.userAgent || null,
          event.ipAddress || null,
          event.timestamp.toISOString(),
          event.metadata ? JSON.stringify(event.metadata) : null,
        );
      }
    });

    transaction(events);
  }

  /**
   * Start a new user session
   */
  startSession(session: Omit<UserSession, 'id' | 'startTime'>, sessionId: string): string {
    const stmt = this.db.prepare(`
      INSERT INTO user_sessions (
        user_id, 
        session_id, 
        start_time, 
        is_pwa
      ) VALUES (?, ?, ?, ?)
    `);

    stmt.run(session.userId, sessionId, new Date().toISOString(), session.isPWA || false);

    return sessionId;
  }

  /**
   * End a user session
   */
  endSession(sessionId: string): void {
    // Get the session to calculate duration
    const sessionStmt = this.db.prepare(`
      SELECT start_time FROM user_sessions 
      WHERE session_id = ?
    `);
    const session = sessionStmt.get(sessionId) as { start_time: string } | undefined;

    if (session) {
      const startTime = new Date(session.start_time);
      const duration = Math.floor((Date.now() - startTime.getTime()) / 1000); // in seconds

      const stmt = this.db.prepare(`
        UPDATE user_sessions 
        SET end_time = ?, duration = ?
        WHERE session_id = ?
      `);

      stmt.run(new Date().toISOString(), duration, sessionId);
    }
  }

  /**
   * Get analytics metrics
   */
  getMetrics(): AnalyticsMetrics {
    // Calculate daily active users (DAU)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dauResult = this.db
      .prepare(
        `
      SELECT COUNT(DISTINCT user_id) as dau
      FROM analytics_events
      WHERE timestamp >= ?
    `,
      )
      .get(yesterday.toISOString()) as { dau: number } | undefined;

    // Calculate weekly active users (WAU)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const wauResult = this.db
      .prepare(
        `
      SELECT COUNT(DISTINCT user_id) as wau
      FROM analytics_events
      WHERE timestamp >= ?
    `,
      )
      .get(weekAgo.toISOString()) as { wau: number } | undefined;

    // Calculate monthly active users (MAU)
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    const mauResult = this.db
      .prepare(
        `
      SELECT COUNT(DISTINCT user_id) as mau
      FROM analytics_events
      WHERE timestamp >= ?
    `,
      )
      .get(monthAgo.toISOString()) as { mau: number } | undefined;

    // Get total sessions
    const totalSessionsResult = this.db
      .prepare(
        `
      SELECT COUNT(*) as total
      FROM user_sessions
    `,
      )
      .get() as { total: number } | undefined;

    // Calculate average session duration
    const avgDurationResult = this.db
      .prepare(
        `
      SELECT AVG(duration) as avg_duration
      FROM user_sessions
      WHERE duration IS NOT NULL
    `,
      )
      .get() as { avg_duration: number } | undefined;

    // Get top events
    const topEventsResult = this.db
      .prepare(
        `
      SELECT event_type, COUNT(*) as count
      FROM analytics_events
      GROUP BY event_type
      ORDER BY count DESC
      LIMIT 5
    `,
      )
      .all() as Array<{ event_type: AnalyticsEventType; count: number }>;

    // Calculate user retention (simplified)
    const retentionResult = this.db
      .prepare(
        `
      SELECT 
        (COUNT(CASE WHEN days_since_first > 1 THEN 1 END) * 100.0 / COUNT(*)) as retention_rate
      FROM (
        SELECT 
          user_id,
          julianday(MAX(timestamp)) - julianday(MIN(timestamp)) as days_since_first
        FROM analytics_events
        GROUP BY user_id
      )
    `,
      )
      .get() as { retention_rate: number } | undefined;

    // Calculate PWA installation rate
    const totalUsers = this.db
      .prepare(
        `
      SELECT COUNT(DISTINCT user_id) as total
      FROM analytics_events
    `,
      )
      .get() as { total: number } | undefined;

    const pwaUsers = this.db
      .prepare(
        `
      SELECT COUNT(DISTINCT user_id) as pwa_count
      FROM user_sessions
      WHERE is_pwa = TRUE
    `,
      )
      .get() as { pwa_count: number } | undefined;

    // Calculate offline usage rate
    const offlineEvents = this.db
      .prepare(
        `
      SELECT COUNT(*) as offline_count
      FROM analytics_events
      WHERE event_type = 'OFFLINE_SYNC'
    `,
      )
      .get() as { offline_count: number } | undefined;

    // Construct metrics object
    const metrics: AnalyticsMetrics = {
      dailyActiveUsers: dauResult?.dau || 0,
      weeklyActiveUsers: wauResult?.wau || 0,
      monthlyActiveUsers: mauResult?.mau || 0,
      totalSessions: totalSessionsResult?.total || 0,
      averageSessionDuration: avgDurationResult?.avg_duration || 0,
      topEvents: topEventsResult.map((item) => ({
        eventType: item.event_type,
        count: item.count,
      })),
      userRetention: retentionResult?.retention_rate || 0,
      pwaInstallationRate: totalUsers?.total
        ? ((pwaUsers?.pwa_count || 0) * 100) / totalUsers.total
        : 0,
      offlineUsageRate: totalUsers?.total
        ? ((offlineEvents?.offline_count || 0) * 100) / totalUsers.total
        : 0,
    };

    return metrics;
  }

  /**
   * Clean old analytics data based on retention period
   */
  cleanOldData(retentionPeriod: number): void {
    const retentionDate = new Date();
    retentionDate.setDate(retentionDate.getDate() - retentionPeriod);

    const stmt = this.db.prepare(`
      DELETE FROM analytics_events
      WHERE timestamp < ?
    `);

    stmt.run(retentionDate.toISOString());

    Logger.info('Old analytics data cleaned', {
      retentionPeriod,
      cleanupDate: retentionDate.toISOString(),
    });
  }

  /**
   * Export analytics data for analysis
   */
  exportData(startDate: Date, endDate: Date): AnalyticsEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM analytics_events
      WHERE timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp DESC
    `);

    const results = stmt.all(startDate.toISOString(), endDate.toISOString()) as AnalyticsEvent[];

    Logger.info('Analytics data exported', {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      recordCount: results.length,
    });

    return results;
  }
}
