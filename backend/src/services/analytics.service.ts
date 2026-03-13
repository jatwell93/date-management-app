import { Logger } from '../utils/logger';
import { IAnalyticsAdapter } from '../adapters/analytics/IAnalyticsAdapter';
import { randomBytes } from 'crypto';

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
  FEATURE_ACCESS_DENIED = 'FEATURE_ACCESS_DENIED',
  USAGE_LIMIT_EXCEEDED = 'USAGE_LIMIT_EXCEEDED',
  CROSS_TENANT_ACCESS_ATTEMPT = 'CROSS_TENANT_ACCESS_ATTEMPT',
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
 * Analytics Service with Adapter Pattern
 * Provides tracking and analytics for application usage and user adoption
 *
 * P0-2: Refactored to use IAnalyticsAdapter for database-agnostic operations
 */
export class AnalyticsService {
  private config: AnalyticsConfig;
  private eventQueue: AnalyticsEvent[] = [];
  private batchProcessing: boolean = false;
  private batchInterval?: NodeJS.Timeout;

  /**
   * Constructor with adapter injection
   * @param adapter Analytics adapter (SQLite, Prisma, etc.)
   */
  constructor(private adapter: IAnalyticsAdapter) {
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

    // Boot-time capability check: Is adapter available?
    if (!this.adapter.isAvailable()) {
      Logger.warn('Analytics disabled: adapter not available', {
        adapterType: this.adapter.constructor.name,
      });
      this.config.enableTracking = false;
      this.config.enableSessionTracking = false;
      return;
    }

    // Initialize storage via adapter
    this.adapter.initialize();

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

      // Use adapter to start session
      this.adapter.startSession(session, sessionId);

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
      this.adapter.endSession(sessionId);
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
    const randomPart = randomBytes(16).toString('hex');
    return 'sess_' + randomPart;
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
        // Use adapter to store events
        this.adapter.storeEventsBatch(eventsToProcess);
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
    if (this.batchInterval) {
      return;
    }

    // Process the queue every 30 seconds
    this.batchInterval = setInterval(() => {
      void this.processEventQueue();
    }, 30000);

    // Do not keep the process alive solely for this background timer
    if (typeof this.batchInterval.unref === 'function') {
      this.batchInterval.unref();
    }
  }

  private stopBatchProcessing(): void {
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
      this.batchInterval = undefined;
    }
  }

  /**
   * Get analytics metrics
   */
  public async getMetrics(startDate?: Date, endDate?: Date): Promise<AnalyticsMetrics> {
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: 30 days ago
    const end = endDate || new Date(); // Default: now
    return this.adapter.getMetrics(start, end);
  }

  /**
   * Clean old analytics data based on retention period
   */
  public async cleanOldData(): Promise<void> {
    try {
      await this.adapter.cleanupOldData(this.config.retentionPeriod);
    } catch (error) {
      Logger.error('Failed to clean old analytics data', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get event count by type
   */
  public async getEventCountByType(
    eventType: AnalyticsEventType,
    startDate?: Date,
    endDate?: Date,
  ): Promise<number> {
    const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate || new Date();
    return this.adapter.getEventCountByType(eventType, start, end);
  }

  /**
   * Export analytics data for further analysis
   * @deprecated Use getMetrics() instead for analytics data retrieval. This method returns empty data and will be removed in a future version.
   */
  public async exportData(startDate: Date, endDate: Date): Promise<AnalyticsEvent[]> {
    Logger.warn('exportData is deprecated - use getMetrics() instead');
    return [];
  }

  // ============================================================================
  // Static Singleton for Backward Compatibility
  // ============================================================================

  private static instance: AnalyticsService | null = null;

  /**
   * Get or create singleton instance (for middleware compatibility)
   * Uses SQLite adapter with database from ServiceProvider
   */
  public static getInstance(): AnalyticsService {
    if (!AnalyticsService.instance) {
      const db = require('../database/database-factory').getDefaultDatabaseClient();
      const { SQLiteAnalyticsAdapter } = require('../adapters/analytics/SQLiteAnalyticsAdapter');
      const adapter = new SQLiteAnalyticsAdapter(db);
      AnalyticsService.instance = new AnalyticsService(adapter);
      AnalyticsService.instance.initialize();
    }
    return AnalyticsService.instance;
  }

  /**
   * Reset singleton (for testing)
   */
  public static resetInstance(): void {
    AnalyticsService.instance?.stopBatchProcessing();
    AnalyticsService.instance = null;
  }
}
