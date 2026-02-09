import Database from 'better-sqlite3';
import { Logger } from '../utils/logger';
import { AnalyticsRepository } from '../repositories/analytics.repository';

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
  PWA_USAGE = 'PWA_USAGE',
}

// Interface for analytics events
export interface AnalyticsMetadata extends Record<string, unknown> {
  path?: string;
  method?: string;
  role?: string;
  reportType?: string;
  dataSize?: number;
}

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
  metadata?: AnalyticsMetadata;
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
 * Analytics Service with Dependency Injection
 * Provides tracking and analytics for application usage and user adoption
 *
 * Task 8.1 & 8.3: Refactored from singleton to DI pattern with repository
 */
export class AnalyticsService {
  private config: AnalyticsConfig;
  private repository: AnalyticsRepository;
  private eventQueue: AnalyticsEvent[] = [];
  private batchProcessing: boolean = false;

  /**
   * Constructor with dependency injection
   * @param db Database instance (injected)
   */
  constructor(private db: DB) {
    // Create repository with injected database
    this.repository = new AnalyticsRepository(db);

    // Set default configuration
    this.config = {
      enableTracking: true,
      enableSessionTracking: true,
      retentionPeriod: 90, // 90 days
      batchSize: 100, // process 100 events at once
      enablePWAAnalytics: true,
    };
  }

  /**
   * Initialize the analytics service with configuration
   */
  public initialize(config?: Partial<AnalyticsConfig>): void {
    if (config) {
      this.config = {
        ...this.config,
        ...config,
      };
    }

    // Initialize tables via repository
    this.repository.initializeTables();

    // Start periodic batch processing of events
    if (this.config.enableTracking) {
      this.startBatchProcessing();
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
      timestamp: new Date(),
    };

    // Add to queue for batch processing
    this.eventQueue.push(analyticsEvent);

    // For high-priority events, process immediately
    if (
      event.eventType === AnalyticsEventType.USER_LOGIN ||
      event.eventType === AnalyticsEventType.PWA_INSTALL
    ) {
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

    try {
      const sessionId = session.sessionId || this.generateSessionId();

      // Use repository to start session
      this.repository.startSession(session, sessionId);

      return sessionId;
    } catch (error) {
      Logger.error('Failed to start user session', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId: session.userId,
      });
      return '';
    }
  }

  /**
   * End a user session
   */
  public endSession(sessionId: string): void {
    if (!this.config.enableSessionTracking) {
      return;
    }

    try {
      this.repository.endSession(sessionId);
    } catch (error) {
      Logger.error('Failed to end user session', {
        error: error instanceof Error ? error.message : 'Unknown error',
        sessionId,
      });
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
        // Use repository to store events
        this.repository.storeEventsBatch(eventsToProcess);
      }
    } catch (error) {
      Logger.error('Failed to process analytics event queue', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      this.batchProcessing = false;
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
    return this.repository.getMetrics();
  }

  /**
   * Clean old analytics data based on retention period
   */
  public async cleanOldData(): Promise<void> {
    try {
      this.repository.cleanOldData(this.config.retentionPeriod);
    } catch (error) {
      Logger.error('Failed to clean old analytics data', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Export analytics data for further analysis
   */
  public async exportData(startDate: Date, endDate: Date): Promise<AnalyticsEvent[]> {
    return this.repository.exportData(startDate, endDate);
  }

  // ============================================================================
  // Static Singleton for Backward Compatibility
  // ============================================================================

  private static instance: AnalyticsService | null = null;

  /**
   * Get or create singleton instance (for middleware compatibility)
   * Uses the database from ServiceProvider
   */
  public static getInstance(): AnalyticsService {
    if (!AnalyticsService.instance) {
      const db = require('../database/database-factory').getDefaultDatabaseClient();
      AnalyticsService.instance = new AnalyticsService(db);
      AnalyticsService.instance.initialize();
    }
    return AnalyticsService.instance;
  }

  /**
   * Reset singleton (for testing)
   */
  public static resetInstance(): void {
    AnalyticsService.instance = null;
  }
}
