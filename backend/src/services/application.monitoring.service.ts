import { Logger } from '../utils/logger';
import { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';

// Define application alert types
export enum ApplicationAlertType {
  SLOW_ENDPOINT = 'SLOW_ENDPOINT',
  HIGH_ERROR_RATE = 'HIGH_ERROR_RATE',
  HIGH_LATENCY = 'HIGH_LATENCY',
  LOW_UPTIME = 'LOW_UPTIME',
  RESOURCE_EXHAUSTION = 'RESOURCE_EXHAUSTION',
  ANOMALOUS_USER_BEHAVIOR = 'ANOMALOUS_USER_BEHAVIOR',
}

// Interface for application alert events
export interface ApplicationAlertMetadata extends Record<string, unknown> {
  endpoint?: string;
  method?: string;
  duration?: number;
  errorCount?: number;
  errorMessage?: string;
}

export interface ApplicationAlertEvent {
  type: ApplicationAlertType;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  metadata?: ApplicationAlertMetadata;
}

// Metrics interface for application monitoring
export interface ApplicationMetrics {
  performance: {
    totalRequests: number;
    slowRequests: number; // Requests taking more than 500ms
    avgResponseTime: number; // in ms
    lastResponseTime: number; // in ms
    requestPerMinute: number;
  };
  userJourneys: {
    scanBarcode: { count: number; avgTime: number; errorRate: number };
    addInventoryItem: { count: number; avgTime: number; errorRate: number };
    generateReport: { count: number; avgTime: number; errorRate: number };
    login: { count: number; avgTime: number; errorRate: number };
  };
  // Webhook-specific metrics (Stripe webhooks)
  webhook: {
    total: number;
    byEvent: Record<string, { count: number; failures: number; avgLatencyMs: number }>;
    idempotencySkips: number; // number of duplicate events skipped
  };
  errors: {
    totalErrors: number;
    errorRate: number; // percentage
    lastErrorCode: number | null;
  };
  health: {
    uptime: number; // in seconds
    healthyEndpoints: string[];
    unhealthyEndpoints: string[];
  };
  timestamp: Date;
}

// Configuration for application monitoring
export interface ApplicationMonitoringConfig {
  slowEndpointThreshold: number; // in milliseconds
  alertThresholds: {
    errorRate: number; // percentage
    responseTimeThreshold: number; // in ms
    requestPerMinuteThreshold: number; // count
    webhookFailureThreshold?: number; // number of webhook failures per check interval that triggers alert
    idempotencySkipRateThreshold?: number; // percentage threshold for idempotency skips
  };
  checkInterval: number; // in milliseconds
  enableLogging: boolean;
  enableAlerting: boolean;
  monitoredEndpoints: string[]; // Specific endpoints to monitor
}

/**
 * Application Monitoring Service
 * Provides monitoring, metrics collection, and alerting for application performance
 */
export class ApplicationMonitoringService extends EventEmitter {
  private static instance: ApplicationMonitoringService;
  private config: ApplicationMonitoringConfig;
  private isMonitoring: boolean = false;
  private monitoringInterval?: NodeJS.Timeout;

  // Metrics store
  private metrics: ApplicationMetrics = {
    performance: {
      totalRequests: 0,
      slowRequests: 0,
      avgResponseTime: 0,
      lastResponseTime: 0,
      requestPerMinute: 0,
    },
    userJourneys: {
      scanBarcode: { count: 0, avgTime: 0, errorRate: 0 },
      addInventoryItem: { count: 0, avgTime: 0, errorRate: 0 },
      generateReport: { count: 0, avgTime: 0, errorRate: 0 },
      login: { count: 0, avgTime: 0, errorRate: 0 },
    },
    // Webhook metrics initial state
    webhook: {
      total: 0,
      byEvent: {},
      idempotencySkips: 0,
    },
    errors: {
      totalErrors: 0,
      errorRate: 0,
      lastErrorCode: null,
    },
    health: {
      uptime: 0,
      healthyEndpoints: [],
      unhealthyEndpoints: [],
    },
    timestamp: new Date(),
  };

  // Store request start times for performance tracking
  private requestStartTimes = new Map<string, number>();

  private constructor() {
    super();
    // Set default configuration
    this.config = {
      slowEndpointThreshold: 500, // 500ms
      alertThresholds: {
        errorRate: 5, // 5%
        responseTimeThreshold: 1000, // 1 second
        requestPerMinuteThreshold: 1000, // 1000 requests per minute
        webhookFailureThreshold: 1, // 1 failure per check interval triggers alert
        idempotencySkipRateThreshold: 10, // 10% idempotency skips is suspicious
      },
      checkInterval: 60000, // 1 minute
      enableLogging: true,
      enableAlerting: true,
      monitoredEndpoints: [
        '/api/inventory-items',
        '/api/products',
        '/api/store-areas',
        '/api/auth/login',
        '/api/reports/usage',
        '/api/reports/expiry',
      ],
    };
  }

  public static getInstance(): ApplicationMonitoringService {
    if (!ApplicationMonitoringService.instance) {
      ApplicationMonitoringService.instance = new ApplicationMonitoringService();
    }
    return ApplicationMonitoringService.instance;
  }

  /**
   * Initialize the monitoring service with configuration
   */
  public initialize(config?: Partial<ApplicationMonitoringConfig>): void {
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
      Logger.warn('Application monitoring is already running');
      return;
    }

    this.isMonitoring = true;
    Logger.info('Application monitoring started');

    // Perform initial metrics collection
    void this.collectMetrics();

    // Set up periodic monitoring
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.collectMetrics();
      } catch (error) {
        Logger.error('Error during application monitoring', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }, this.config.checkInterval);
  }

  /**
   * Stop the monitoring process
   */
  public stopMonitoring(): void {
    if (!this.isMonitoring) {
      Logger.warn('Application monitoring is not running');
      return;
    }

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    this.isMonitoring = false;
    Logger.info('Application monitoring stopped');
  }

  /**
   * Middleware to track request performance
   */
  public requestTrackingMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();
      const requestId = `${req.method}-${req.url}-${Date.now()}-${Math.random()}`;

      // Store the start time for this request
      this.requestStartTimes.set(requestId, startTime);

      // Track when the response finishes
      res.on('finish', () => {
        const endTime = Date.now();
        const duration = endTime - startTime;

        // Record the request metrics
        this.recordRequest(req.method + req.url, duration, res.statusCode, req.url);

        // Clean up the start time
        this.requestStartTimes.delete(requestId);
      });

      next();
    };
  }

  /**
   * Record a request for performance monitoring
   */
  public recordRequest(endpoint: string, duration: number, statusCode: number, url: string): void {
    this.metrics.performance.totalRequests++;
    this.metrics.performance.lastResponseTime = duration;

    // Track specific user journeys based on endpoint
    this.trackUserJourney(endpoint, duration, statusCode);

    // Increment error count if status code indicates error
    if (statusCode >= 400) {
      this.metrics.errors.totalErrors++;
      this.metrics.errors.lastErrorCode = statusCode;
    }

    if (duration > this.config.slowEndpointThreshold) {
      this.metrics.performance.slowRequests++;

      if (this.config.enableAlerting) {
        this.emitAlert({
          type: ApplicationAlertType.SLOW_ENDPOINT,
          message: `Slow endpoint detected: ${endpoint} took ${duration}ms > ${this.config.slowEndpointThreshold}ms threshold`,
          severity: 'medium',
          timestamp: new Date(),
          metadata: {
            endpoint,
            responseTime: duration,
            threshold: this.config.slowEndpointThreshold,
            url,
          },
        });
      }
    }

    // Recalculate average response time
    const totalTime =
      this.metrics.performance.avgResponseTime * (this.metrics.performance.totalRequests - 1) +
      duration;
    this.metrics.performance.avgResponseTime = totalTime / this.metrics.performance.totalRequests;

    // Update error rate
    this.metrics.errors.errorRate =
      (this.metrics.errors.totalErrors / this.metrics.performance.totalRequests) * 100;
  }

  /**
   * Track specific user journeys
   */
  private trackUserJourney(endpoint: string, duration: number, statusCode: number): void {
    // Determine which user journey this endpoint represents
    let journeyType: keyof ApplicationMetrics['userJourneys'] | null = null;

    if (endpoint.includes('/api/inventory-items') && endpoint.includes('POST')) {
      journeyType = 'addInventoryItem';
    } else if (
      endpoint.includes('/api/reports/usage') ||
      endpoint.includes('/api/reports/expiry')
    ) {
      journeyType = 'generateReport';
    } else if (endpoint.includes('/api/auth/login')) {
      journeyType = 'login';
    } else if (endpoint.includes('/api/products')) {
      // Could be related to scanning (looking up products)
      journeyType = 'scanBarcode';
    }

    if (journeyType) {
      const journey = this.metrics.userJourneys[journeyType];
      const oldAvg = journey.avgTime;

      journey.count++;

      // Calculate new average time
      journey.avgTime = (oldAvg * (journey.count - 1) + duration) / journey.count;

      // Calculate error rate
      if (statusCode >= 400) {
        journey.errorRate = (journey.errorRate * (journey.count - 1) + 100) / journey.count;
      } else {
        journey.errorRate = (journey.errorRate * (journey.count - 1)) / journey.count;
      }
    }
  }

  /**
   * Get current application metrics
   */
  public getMetrics(): ApplicationMetrics {
    return { ...this.metrics };
  }

  /**
   * Record webhook handling metrics
   */
  public recordWebhookEvent(
    eventType: string,
    latencyMs: number,
    status: 'success' | 'error' | 'skipped',
  ) {
    this.metrics.webhook.total++;

    if (!this.metrics.webhook.byEvent[eventType]) {
      this.metrics.webhook.byEvent[eventType] = { count: 0, failures: 0, avgLatencyMs: 0 };
    }

    const entry = this.metrics.webhook.byEvent[eventType];
    entry.count++;

    // Update average latency
    entry.avgLatencyMs = (entry.avgLatencyMs * (entry.count - 1) + latencyMs) / entry.count;

    if (status === 'error') {
      entry.failures++;
    }

    if (status === 'skipped') {
      this.metrics.webhook.idempotencySkips++;
    }
  }

  public getWebhookMetrics() {
    return { ...this.metrics.webhook };
  }

  /**
   * Emit an alert event
   */
  private emitAlert(alert: ApplicationAlertEvent): void {
    if (this.config.enableAlerting) {
      this.emit('alert', alert);
      Logger.warn(`Application alert: ${alert.message}`, {
        type: alert.type,
        severity: alert.severity,
      });
    }
  }

  /**
   * Check for conditions that require alerts
   */
  private async checkForAlerts(): Promise<void> {
    // Check error rate
    if (this.metrics.errors.errorRate > this.config.alertThresholds.errorRate) {
      this.emitAlert({
        type: ApplicationAlertType.HIGH_ERROR_RATE,
        message: `Error rate is ${this.metrics.errors.errorRate.toFixed(2)}% > ${this.config.alertThresholds.errorRate}% threshold`,
        severity: 'high',
        timestamp: new Date(),
        metadata: {
          errorRate: this.metrics.errors.errorRate,
          threshold: this.config.alertThresholds.errorRate,
        },
      });
    }

    // Check average response time
    if (
      this.metrics.performance.avgResponseTime > this.config.alertThresholds.responseTimeThreshold
    ) {
      this.emitAlert({
        type: ApplicationAlertType.HIGH_LATENCY,
        message: `Average response time is ${this.metrics.performance.avgResponseTime}ms > ${this.config.alertThresholds.responseTimeThreshold}ms threshold`,
        severity: 'medium',
        timestamp: new Date(),
        metadata: {
          avgResponseTime: this.metrics.performance.avgResponseTime,
          threshold: this.config.alertThresholds.responseTimeThreshold,
        },
      });
    }

    // Webhook-specific alerts: failure spike or idempotency anomalies
    const webhookMetrics = this.metrics.webhook;
    const totalFailures = Object.values(webhookMetrics.byEvent).reduce((s, e) => s + e.failures, 0);
    if (totalFailures > (this.config.alertThresholds.webhookFailureThreshold || 0)) {
      this.emitAlert({
        type: ApplicationAlertType.ANOMALOUS_USER_BEHAVIOR,
        message: `Webhook handler failures detected: ${totalFailures} failures in the last interval`,
        severity: 'high',
        timestamp: new Date(),
        metadata: { totalFailures, webhookMetrics },
      });
    }

    const totalWebhooks = webhookMetrics.total || 0;
    const idempotencySkipRate =
      totalWebhooks === 0 ? 0 : (webhookMetrics.idempotencySkips / totalWebhooks) * 100;
    if (idempotencySkipRate > (this.config.alertThresholds.idempotencySkipRateThreshold || 100)) {
      this.emitAlert({
        type: ApplicationAlertType.ANOMALOUS_USER_BEHAVIOR,
        message: `High idempotency skip rate: ${idempotencySkipRate.toFixed(2)}%`,
        severity: 'medium',
        timestamp: new Date(),
        metadata: { idempotencySkipRate, webhookMetrics },
      });
    }
  }

  /**
   * Collect metrics from the application
   */
  public async collectMetrics(): Promise<ApplicationMetrics> {
    const startTime = Date.now();

    try {
      // Update timestamp
      this.metrics.timestamp = new Date();

      // Update uptime
      this.metrics.health.uptime = process.uptime();

      if (this.config.enableLogging) {
        Logger.debug('Application metrics collected', { metrics: this.metrics });
      }

      // Check for alerts
      await this.checkForAlerts();

      return this.metrics;
    } catch (error) {
      const duration = Date.now() - startTime;
      Logger.error('Failed to collect application metrics', {
        duration,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }
}
