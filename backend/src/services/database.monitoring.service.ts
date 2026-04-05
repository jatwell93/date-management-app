import { getDb } from '../database';
import { Logger } from '../utils/logger';
import { EventEmitter } from 'events';

// Define database alert types
export enum DatabaseAlertType {
  CONNECTION_POOL_EXHAUSTED = 'CONNECTION_POOL_EXHAUSTED',
  SLOW_QUERY = 'SLOW_QUERY',
  TABLE_SIZE_THRESHOLD = 'TABLE_SIZE_THRESHOLD',
  ROW_COUNT_THRESHOLD = 'ROW_COUNT_THRESHOLD',
  DATABASE_LOCKED = 'DATABASE_LOCKED',
  DISK_SPACE_LOW = 'DISK_SPACE_LOW',
  BACKUP_FAILED = 'BACKUP_FAILED',
  HEALTH_CHECK_FAILED = 'HEALTH_CHECK_FAILED',
}

// Interface for database alert events
export interface DatabaseAlertMetadata extends Record<string, unknown> {
  query?: string;
  duration?: number;
  tableName?: string;
  rowCount?: number;
  reason?: string;
}

export interface DatabaseAlertEvent {
  type: DatabaseAlertType;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  metadata?: DatabaseAlertMetadata;
}

// Metrics interface for database monitoring
export interface DatabaseMetrics {
  connectionPool: {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    maxConnections: number;
    utilization: number; // Percentage
  };
  performance: {
    totalQueries: number;
    slowQueries: number; // Queries taking more than 100ms
    avgQueryTime: number; // in ms
    lastQueryTime: number; // in ms
  };
  health: {
    uptime: number; // in seconds
    tableSizes: { [tableName: string]: number }; // size in bytes
    rowCount: { [tableName: string]: number };
  };
  diskSpace: {
    total: number; // in bytes
    used: number; // in bytes
    free: number; // in bytes
    available: number; // in bytes
    utilization: number; // percentage
  };
  timestamp: Date;
}

// Configuration for database monitoring
export interface DatabaseMonitoringConfig {
  slowQueryThreshold: number; // in milliseconds
  alertThresholds: {
    connectionPoolUtilization: number; // percentage
    tableSizeThreshold: number; // in MB
    rowCountThreshold: number; // count
    diskSpaceUtilization: number; // percentage
  };
  checkInterval: number; // in milliseconds
  enableLogging: boolean;
  enableAlerting: boolean;
}

/**
 * Database Monitoring Service
 * Provides monitoring, metrics collection, and alerting for database operations
 */
export class DatabaseMonitoringService extends EventEmitter {
  private static instance: DatabaseMonitoringService;
  private config: DatabaseMonitoringConfig;
  private isMonitoring: boolean = false;
  private monitoringInterval?: NodeJS.Timeout;

  // Metrics store
  private metrics: DatabaseMetrics = {
    connectionPool: {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      maxConnections: 10,
      utilization: 0,
    },
    performance: {
      totalQueries: 0,
      slowQueries: 0,
      avgQueryTime: 0,
      lastQueryTime: 0,
    },
    health: {
      uptime: 0,
      tableSizes: {},
      rowCount: {},
    },
    diskSpace: {
      total: 0,
      used: 0,
      free: 0,
      available: 0,
      utilization: 0,
    },
    timestamp: new Date(),
  };

  private constructor() {
    super();
    // Set default configuration
    this.config = {
      slowQueryThreshold: 100, // 100ms
      alertThresholds: {
        connectionPoolUtilization: 90, // 90%
        tableSizeThreshold: 100, // 100MB
        rowCountThreshold: 100000, // 100k rows
        diskSpaceUtilization: 85, // 85%
      },
      checkInterval: 30000, // 30 seconds
      enableLogging: true,
      enableAlerting: true,
    };
  }

  public static getInstance(): DatabaseMonitoringService {
    if (!DatabaseMonitoringService.instance) {
      DatabaseMonitoringService.instance = new DatabaseMonitoringService();
    }
    return DatabaseMonitoringService.instance;
  }

  /**
   * Initialize the monitoring service with configuration
   */
  public initialize(config?: Partial<DatabaseMonitoringConfig>): void {
    if (config) {
      this.config = {
        ...this.config,
        ...config,
        alertThresholds: {
          ...this.config.alertThresholds,
          ...(config.alertThresholds || {}),
        },
      };
    }

    // Start monitoring
    this.startMonitoring();
  }

  /**
   * Start the monitoring process
   */
  public startMonitoring(): void {
    if (this.isMonitoring) {
      Logger.warn('Database monitoring is already running');
      return;
    }

    this.isMonitoring = true;
    Logger.info('Database monitoring started');

    // Perform initial metrics collection
    void this.collectMetrics();

    // Set up periodic monitoring
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.collectMetrics();
      } catch (error) {
        Logger.error('Error during database monitoring', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }, this.config.checkInterval);

    if (typeof this.monitoringInterval.unref === 'function') {
      this.monitoringInterval.unref();
    }
  }

  /**
   * Stop the monitoring process
   */
  public stopMonitoring(silentIfNotRunning: boolean = false): void {
    if (!this.isMonitoring) {
      if (!silentIfNotRunning) {
        Logger.warn('Database monitoring is not running');
      }
      return;
    }

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    this.isMonitoring = false;
    Logger.info('Database monitoring stopped');
  }

  /**
   * Collect metrics from the database
   */
  public async collectMetrics(): Promise<DatabaseMetrics> {
    const startTime = Date.now();

    try {
      // Get connection pool metrics from the database implementation
      // In our case, we'll simulate these since better-sqlite3 doesn't expose connection pool details
      // In a real-world scenario, these would come from your connection pooling implementation
      const poolMetrics = await this.getConnectionPoolMetrics();
      this.metrics.connectionPool = poolMetrics;

      // Collect performance metrics
      this.metrics.performance = await this.getPerformanceMetrics();

      // Collect health metrics
      this.metrics.health = await this.getHealthMetrics();

      // Collect disk space metrics
      this.metrics.diskSpace = await this.getDiskSpaceMetrics();

      // Update timestamp
      this.metrics.timestamp = new Date();

      if (this.config.enableLogging) {
        Logger.debug('Database metrics collected', { metrics: this.metrics });
      }

      // Check for alerts
      await this.checkForAlerts();

      return this.metrics;
    } catch (error) {
      const duration = Date.now() - startTime;
      Logger.error('Failed to collect database metrics', {
        duration,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Emit alert for metrics collection failure
      this.emitAlert({
        type: DatabaseAlertType.HEALTH_CHECK_FAILED,
        message: `Failed to collect database metrics: ${error instanceof Error ? error.message : 'Unknown error'}`,
        severity: 'high',
        timestamp: new Date(),
        metadata: { duration },
      });

      throw error;
    }
  }

  /**
   * Get current database metrics
   */
  public getMetrics(): DatabaseMetrics {
    return { ...this.metrics };
  }

  /**
   * Record a query execution for performance monitoring
   */
  public recordQuery(duration: number): void {
    this.metrics.performance.totalQueries++;
    this.metrics.performance.lastQueryTime = duration;

    if (duration > this.config.slowQueryThreshold) {
      this.metrics.performance.slowQueries++;

      if (this.config.enableAlerting) {
        this.emitAlert({
          type: DatabaseAlertType.SLOW_QUERY,
          message: `Slow query detected: ${duration}ms > ${this.config.slowQueryThreshold}ms threshold`,
          severity: 'medium',
          timestamp: new Date(),
          metadata: { queryTime: duration, threshold: this.config.slowQueryThreshold },
        });
      }
    }

    // Recalculate average query time
    const totalTime =
      this.metrics.performance.avgQueryTime * (this.metrics.performance.totalQueries - 1) +
      duration;
    this.metrics.performance.avgQueryTime = totalTime / this.metrics.performance.totalQueries;
  }

  /**
   * Emit an alert event
   */
  private emitAlert(alert: DatabaseAlertEvent): void {
    if (this.config.enableAlerting) {
      this.emit('alert', alert);
      Logger.warn(`Database alert: ${alert.message}`, {
        type: alert.type,
        severity: alert.severity,
      });
    }
  }

  /**
   * Check for conditions that require alerts
   */
  private async checkForAlerts(): Promise<void> {
    // Check connection pool utilization
    if (
      this.metrics.connectionPool.utilization >
      this.config.alertThresholds.connectionPoolUtilization
    ) {
      this.emitAlert({
        type: DatabaseAlertType.CONNECTION_POOL_EXHAUSTED,
        message: `Connection pool utilization is ${this.metrics.connectionPool.utilization}% > ${this.config.alertThresholds.connectionPoolUtilization}% threshold`,
        severity: 'high',
        timestamp: new Date(),
        metadata: {
          utilization: this.metrics.connectionPool.utilization,
          threshold: this.config.alertThresholds.connectionPoolUtilization,
        },
      });
    }

    // Check table sizes
    for (const [tableName, size] of Object.entries(this.metrics.health.tableSizes)) {
      const sizeInMB = size / (1024 * 1024); // Convert to MB
      if (sizeInMB > this.config.alertThresholds.tableSizeThreshold) {
        this.emitAlert({
          type: DatabaseAlertType.TABLE_SIZE_THRESHOLD,
          message: `Table ${tableName} size is ${sizeInMB.toFixed(2)}MB > ${this.config.alertThresholds.tableSizeThreshold}MB threshold`,
          severity: 'medium',
          timestamp: new Date(),
          metadata: {
            tableName,
            size: sizeInMB,
            threshold: this.config.alertThresholds.tableSizeThreshold,
          },
        });
      }
    }

    // Check row counts
    for (const [tableName, count] of Object.entries(this.metrics.health.rowCount)) {
      if (count > this.config.alertThresholds.rowCountThreshold) {
        this.emitAlert({
          type: DatabaseAlertType.ROW_COUNT_THRESHOLD,
          message: `Table ${tableName} has ${count} rows > ${this.config.alertThresholds.rowCountThreshold} threshold`,
          severity: 'medium',
          timestamp: new Date(),
          metadata: {
            tableName,
            rowCount: count,
            threshold: this.config.alertThresholds.rowCountThreshold,
          },
        });
      }
    }

    // Check disk space utilization
    if (this.metrics.diskSpace.utilization > this.config.alertThresholds.diskSpaceUtilization) {
      this.emitAlert({
        type: DatabaseAlertType.DISK_SPACE_LOW,
        message: `Disk space utilization is ${this.metrics.diskSpace.utilization}% > ${this.config.alertThresholds.diskSpaceUtilization}% threshold`,
        severity: 'high',
        timestamp: new Date(),
        metadata: {
          utilization: this.metrics.diskSpace.utilization,
          threshold: this.config.alertThresholds.diskSpaceUtilization,
        },
      });
    }
  }

  /**
   * Get connection pool metrics
   */
  private async getConnectionPoolMetrics(): Promise<DatabaseMetrics['connectionPool']> {
    // Since better-sqlite3 is single-threaded and doesn't have a standard connection pool,
    // we'll return simulated metrics based on what we know about our implementation
    // In a real system, this would interface with a connection pool manager
    const totalConnections = 1; // We only have a single connection in our implementation
    const maxConnections = 10; // Our database.ts has a max of 10 connections

    // This is a simplified calculation since our implementation doesn't track active/idle connections
    const utilization = 0; // Placeholder - would need to track actual usage in the connection pool

    return {
      totalConnections,
      activeConnections: 0, // Placeholder
      idleConnections: 0, // Placeholder
      maxConnections,
      utilization,
    };
  }

  /**
   * Get performance metrics
   */
  private async getPerformanceMetrics(): Promise<DatabaseMetrics['performance']> {
    // For now, return the current metrics
    // In a more advanced implementation, we could query SQLite's performance metrics
    return this.metrics.performance;
  }

  /**
   * Get health metrics (table sizes, row counts)
   */
  private async getHealthMetrics(): Promise<DatabaseMetrics['health']> {
    const db = getDb();

    if (!db) {
      return {
        uptime: process.uptime(),
        tableSizes: {},
        rowCount: {},
      };
    }

    try {
      // Get table names
      const tablesResult = db
        .prepare(
          `
        SELECT name FROM sqlite_master 
        WHERE type='table' 
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE 'index%'
      `,
        )
        .all();

      const tableNames = (tablesResult as { name: string }[]).map((row) => row.name);
      const tableSizes: { [tableName: string]: number } = {};
      const rowCount: { [tableName: string]: number } = {};

      // Get size and row count for each table
      for (const tableName of tableNames) {
        // Get row count
        const countResult = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as {
          count: number;
        };
        rowCount[tableName] = countResult.count;

        // For SQLite, getting exact file size for each table is complex
        // We'll approximate by getting the total database file size
        // This would normally be done by querying SQLite's internal stats
        tableSizes[tableName] = 0; // Placeholder - getting individual table sizes in SQLite is complex
      }

      // Actually get the database file size
      const fs = await import('fs/promises');
      const dbPath = process.env.DATABASE_PATH || './database.sqlite';
      const stats = await fs.stat(dbPath);
      const dbFileSize = stats.size;

      // Distribute the database file size proportionally based on row count
      const totalRows = Object.values(rowCount).reduce((sum, count) => sum + count, 0);
      if (totalRows > 0) {
        for (const tableName of tableNames) {
          const proportion = rowCount[tableName] / totalRows;
          tableSizes[tableName] = Math.round(dbFileSize * proportion);
        }
      }

      return {
        uptime: process.uptime(),
        tableSizes,
        rowCount,
      };
    } finally {
      // releaseDb(db);
    }
  }

  /**
   * Get disk space metrics
   */
  private async getDiskSpaceMetrics(): Promise<DatabaseMetrics['diskSpace']> {
    // Note: Node.js doesn't have a direct way to get disk space
    // This is a simplified implementation that won't work on all platforms
    // For a production system, you might need to use a library like 'diskusage'
    try {
      // For now, return placeholder values
      // In a real implementation, this would get actual disk space information
      return {
        total: 0,
        used: 0,
        free: 0,
        available: 0,
        utilization: 0,
      };
    } catch (error) {
      Logger.error('Failed to get disk space metrics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        total: 0,
        used: 0,
        free: 0,
        available: 0,
        utilization: 0,
      };
    }
  }
}
