import { Logger } from '../utils/logger';
import { getDb, releaseDb } from '../database';

// Define analytics event types
export enum AnalyticsEventType {
  USER_LOGIN = 'USER_LOGIN',
  SCAN_BARCODE = 'SCAN_BARCODE',
  ADD_INVENTORY_ITEM = 'ADD_INVENTORY_ITEM',
  GENERATE_REPORT = 'GENERATE_REPORT',
  VIEW_DASHBOARD = 'VIEW_DASHBOARD',
  MODIFY_INVENTORY = 'MODIFY_INVENTORY',
  USER_LOGOUT = 'USER_LOGOUT',
  OFFLINE_SYNC = 'OFFLINE_SYNC',
  PWA_INSTALL = 'PWA_INSTALL',
  PWA_USAGE = 'PWA_USAGE'
}

// Interface for analytics events
export interface AnalyticsEvent {
  id?: number;
  userId?: number;
  sessionId?: string;
  eventType: AnalyticsEventType;
  eventCategory: string;
  eventAction: string;
  eventLabel?: string;
  eventValue?: number;
  userAgent?: string;
  ipAddress?: string;
  timestamp: Date;
  metadata?: any;
}

// Interface for user session tracking
export interface UserSession {
  id?: number;
  userId: number;
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  pagesViewed?: number;
  actionsTaken?: number;
  isPWA?: boolean;
}

// Analytics metrics interface
export interface AnalyticsMetrics {
  dailyActiveUsers: number;
  weeklyActiveUsers: number;
  monthlyActiveUsers: number;
  totalSessions: number;
  averageSessionDuration: number;
  topEvents: Array<{ eventType: AnalyticsEventType; count: number }>;
  userRetention: number; // percentage
  pwaInstallationRate: number; // percentage
  offlineUsageRate: number; // percentage
}

// Configuration for analytics
export interface AnalyticsConfig {
  enableTracking: boolean;
  enableSessionTracking: boolean;
  retentionPeriod: number; // in days
  batchSize: number; // number of events to process at once
  enablePWAAnalytics: boolean;
}

/**
 * Analytics Service
 * Provides tracking and analytics for application usage and user adoption
 */
export class AnalyticsService {
  private static instance: AnalyticsService;
  private config: AnalyticsConfig;
  private eventQueue: AnalyticsEvent[] = [];
  private batchProcessing: boolean = false;
  
  private constructor() {
    // Set default configuration
    this.config = {
      enableTracking: true,
      enableSessionTracking: true,
      retentionPeriod: 90, // 90 days
      batchSize: 100, // process 100 events at once
      enablePWAAnalytics: true
    };
  }

  public static getInstance(): AnalyticsService {
    if (!AnalyticsService.instance) {
      AnalyticsService.instance = new AnalyticsService();
    }
    return AnalyticsService.instance;
  }

  /**
   * Initialize the analytics service with configuration
   */
  public initialize(config?: Partial<AnalyticsConfig>): void {
    if (config) {
      this.config = {
        ...this.config,
        ...config
      };
    }
    
    // Create necessary tables if they don't exist
    this.createAnalyticsTables();
    
    // Start periodic batch processing of events
    if (this.config.enableTracking) {
      this.startBatchProcessing();
    }
  }

  /**
   * Create necessary tables for analytics data
   */
  private createAnalyticsTables(): void {
    const db = getDb();
    
    try {
      // Create analytics_events table
      db.exec(`
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
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          session_id TEXT NOT NULL UNIQUE,
          start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
          end_time DATETIME,
          duration INTEGER, -- in seconds
          pages_viewed INTEGER DEFAULT 0,
          actions_taken INTEGER DEFAULT 0,
          is_pwa BOOLEAN DEFAULT FALSE
        )
      `);
      
      // Create indexes for performance
      db.exec('CREATE INDEX IF NOT EXISTS idx_analytics_events_timestamp ON analytics_events(timestamp)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id ON analytics_events(user_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_analytics_events_event_type ON analytics_events(event_type)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_user_sessions_session_id ON user_sessions(session_id)');
    } finally {
      releaseDb(db);
    }
  }

  /**
   * Track an analytics event
   */
  public trackEvent(event: Omit<AnalyticsEvent, 'id' | 'timestamp'>): void {
    if (!this.config.enableTracking) {
      return;
    }
    
    const analyticsEvent: AnalyticsEvent = {
      ...event,
      timestamp: new Date()
    };
    
    // Add to queue for batch processing
    this.eventQueue.push(analyticsEvent);
    
    // For high-priority events, process immediately
    if (event.eventType === AnalyticsEventType.USER_LOGIN || 
        event.eventType === AnalyticsEventType.PWA_INSTALL) {
      void this.processEventQueue();
    }
  }

  /**
   * Start a user session
   */
  public startSession(session: Omit<UserSession, 'id' | 'startTime'>): string {
    if (!this.config.enableSessionTracking) {
      return '';
    }
    
    const db = getDb();
    
    try {
      const sessionId = session.sessionId || this.generateSessionId();
      
      const stmt = db.prepare(`
        INSERT INTO user_sessions (
          user_id, 
          session_id, 
          start_time, 
          is_pwa
        ) VALUES (?, ?, ?, ?)
      `);
      
      stmt.run(
        session.userId,
        sessionId,
        new Date().toISOString(),
        session.isPWA || false
      );
      
      return sessionId;
    } catch (error) {
      Logger.error('Failed to start user session', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: session.userId
      });
      return '';
    } finally {
      releaseDb(db);
    }
  }

  /**
   * End a user session
   */
  public endSession(sessionId: string): void {
    if (!this.config.enableSessionTracking) {
      return;
    }
    
    const db = getDb();
    
    try {
      // Get the session to calculate duration
      const sessionStmt = db.prepare(`
        SELECT start_time FROM user_sessions 
        WHERE session_id = ?
      `);
      const session = sessionStmt.get(sessionId) as UserSession | undefined;
      
      if (session) {
        const startTime = new Date(session.startTime);
        const duration = Math.floor((Date.now() - startTime.getTime()) / 1000); // in seconds
        
        const stmt = db.prepare(`
          UPDATE user_sessions 
          SET end_time = ?, duration = ?
          WHERE session_id = ?
        `);
        
        stmt.run(new Date().toISOString(), duration, sessionId);
      }
    } catch (error) {
      Logger.error('Failed to end user session', {
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId
      });
    } finally {
      releaseDb(db);
    }
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return 'sess_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Process the event queue in batches
   */
  private async processEventQueue(): Promise<void> {
    if (this.batchProcessing || this.eventQueue.length === 0) {
      return;
    }
    
    this.batchProcessing = true;
    
    try {
      // Get events to process
      const eventsToProcess = this.eventQueue.splice(0, this.config.batchSize);
      
      if (eventsToProcess.length > 0) {
        await this.storeEventsBatch(eventsToProcess);
      }
    } catch (error) {
      Logger.error('Failed to process analytics event queue', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      this.batchProcessing = false;
    }
  }

  /**
   * Store a batch of events to the database
   */
  private async storeEventsBatch(events: AnalyticsEvent[]): Promise<void> {
    const db = getDb();
    
    try {
      // Use a transaction for better performance
      const transaction = (db as any).transaction((events: AnalyticsEvent[]) => {
        const stmt = db.prepare(`
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
            event.metadata ? JSON.stringify(event.metadata) : null
          );
        }
      });
      
      transaction(events);
    } finally {
      releaseDb(db);
    }
  }

  /**
   * Start the batch processing interval
   */
  private startBatchProcessing(): void {
    // Process the queue every 30 seconds
    setInterval(() => {
      void this.processEventQueue();
    }, 30000);
  }

  /**
   * Get analytics metrics
   */
  public async getMetrics(): Promise<AnalyticsMetrics> {
    const db = getDb();
    
    try {
      // Calculate daily active users (DAU)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const dauResult = db.prepare(`
        SELECT COUNT(DISTINCT user_id) as dau
        FROM analytics_events
        WHERE timestamp >= ?
      `).get(yesterday.toISOString()) as { dau: number } | undefined;
      
      // Calculate weekly active users (WAU)
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const wauResult = db.prepare(`
        SELECT COUNT(DISTINCT user_id) as wau
        FROM analytics_events
        WHERE timestamp >= ?
      `).get(weekAgo.toISOString()) as { wau: number } | undefined;
      
      // Calculate monthly active users (MAU)
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      const mauResult = db.prepare(`
        SELECT COUNT(DISTINCT user_id) as mau
        FROM analytics_events
        WHERE timestamp >= ?
      `).get(monthAgo.toISOString()) as { mau: number } | undefined;
      
      // Get total sessions
      const totalSessionsResult = db.prepare(`
        SELECT COUNT(*) as total
        FROM user_sessions
      `).get() as { total: number } | undefined;
      
      // Calculate average session duration
      const avgDurationResult = db.prepare(`
        SELECT AVG(duration) as avg_duration
        FROM user_sessions
        WHERE duration IS NOT NULL
      `).get() as { avg_duration: number } | undefined;
      
      // Get top events
      const topEventsResult = db.prepare(`
        SELECT event_type, COUNT(*) as count
        FROM analytics_events
        GROUP BY event_type
        ORDER BY count DESC
        LIMIT 5
      `).all() as Array<{ event_type: AnalyticsEventType; count: number }>;
      
      // Calculate user retention (simplified)
      const retentionResult = db.prepare(`
        SELECT 
          (COUNT(CASE WHEN days_since_first > 1 THEN 1 END) * 100.0 / COUNT(*)) as retention_rate
        FROM (
          SELECT 
            user_id,
            julianday(MAX(timestamp)) - julianday(MIN(timestamp)) as days_since_first
          FROM analytics_events
          GROUP BY user_id
        )
      `).get() as { retention_rate: number } | undefined;
      
      // Calculate PWA installation rate
      const totalUsers = db.prepare(`
        SELECT COUNT(DISTINCT user_id) as total
        FROM analytics_events
      `).get() as { total: number } | undefined;
      
      const pwaUsers = db.prepare(`
        SELECT COUNT(DISTINCT user_id) as pwa_count
        FROM user_sessions
        WHERE is_pwa = TRUE
      `).get() as { pwa_count: number } | undefined;
      
      // Calculate offline usage rate
      const offlineEvents = db.prepare(`
        SELECT COUNT(*) as offline_count
        FROM analytics_events
        WHERE event_type = 'OFFLINE_SYNC'
      `).get() as { offline_count: number } | undefined;
      
      // Construct metrics object
      const metrics: AnalyticsMetrics = {
        dailyActiveUsers: dauResult?.dau || 0,
        weeklyActiveUsers: wauResult?.wau || 0,
        monthlyActiveUsers: mauResult?.mau || 0,
        totalSessions: totalSessionsResult?.total || 0,
        averageSessionDuration: avgDurationResult?.avg_duration || 0,
        topEvents: topEventsResult.map(item => ({
          eventType: item.event_type,
          count: item.count
        })),
        userRetention: retentionResult?.retention_rate || 0,
        pwaInstallationRate: totalUsers?.total ? 
          ((pwaUsers?.pwa_count || 0) * 100) / totalUsers.total : 0,
        offlineUsageRate: totalUsers?.total ? 
          ((offlineEvents?.offline_count || 0) * 100) / totalUsers.total : 0
      };
      
      return metrics;
    } finally {
      releaseDb(db);
    }
  }

  /**
   * Clean old analytics data based on retention period
   */
  public async cleanOldData(): Promise<void> {
    const db = getDb();
    
    try {
      const retentionDate = new Date();
      retentionDate.setDate(retentionDate.getDate() - this.config.retentionPeriod);
      
      const stmt = db.prepare(`
        DELETE FROM analytics_events
        WHERE timestamp < ?
      `);
      
      stmt.run(retentionDate.toISOString());
      
      Logger.info('Old analytics data cleaned', {
        retentionPeriod: this.config.retentionPeriod,
        cleanupDate: retentionDate.toISOString()
      });
    } catch (error) {
      Logger.error('Failed to clean old analytics data', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      releaseDb(db);
    }
  }

  /**
   * Export analytics data for further analysis
   */
  public async exportData(startDate: Date, endDate: Date): Promise<AnalyticsEvent[]> {
    const db = getDb();
    
    try {
      const stmt = db.prepare(`
        SELECT * FROM analytics_events
        WHERE timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp DESC
      `);
      
      const results = stmt.all(startDate.toISOString(), endDate.toISOString()) as AnalyticsEvent[];
      
      Logger.info('Analytics data exported', {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        recordCount: results.length
      });
      
      return results;
    } finally {
      releaseDb(db);
    }
  }
}
