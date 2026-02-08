/**
 * Metrics Collection Middleware for Cloudflare Workers
 * 
 * Captures and instruments metrics for:
 * - All API requests (response time, status)
 * - CSV uploads (file size, processing duration, row count)
 * 
 * Metrics are written to Cloudflare Analytics Engine for dashboard monitoring.
 */

import { ExpressRequest, ExpressResponse } from '../express-adapter';

/**
 * Metrics collected during request processing
 */
export interface RequestMetrics {
  timestamp: number;
  endpoint: string;
  method: string;
  status: number;
  statusClass?: string;
  routeGroup?: string;
  responseTime: number;
  csvProcessingTime?: number;
  uploadSize?: number;
  rowCount?: number;
  batchCount?: number;
  errorMessage?: string;
  correlationId?: string;
}

/**
 * Attach metrics tracking to request for middleware chain
 */
declare global {
  interface Request {
    metricsContext?: {
      startTime: number;
      metrics: Partial<RequestMetrics>;
    };
  }
}

/**
 * Middleware to initialize metrics tracking for the request
 * Should be called at the beginning of the middleware chain
 */
export function createMetricsInitializer() {
  return async (req: ExpressRequest, res: ExpressResponse, next: () => void): Promise<void> => {
    const correlationId =
      req.get('x-request-id') ||
      req.get('cf-ray') ||
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

    // Initialize metrics context on request
    const request = req as any;
    request.metricsContext = {
      startTime: Date.now(),
      metrics: {
        timestamp: Date.now(),
        endpoint: req.path,
        method: req.method,
        correlationId,
      },
    };

    request.correlationId = correlationId;
    res.setHeader('X-Request-ID', correlationId);
    next();
  };
}

/**
 * Track CSV upload metrics (file size, row count)
 * Call this from upload handlers to capture CSV-specific data
 */
export function trackCsvUpload(
  req: any,
  options: {
    fileSize: number;
    rowCount?: number;
    batchCount?: number;
  }
): void {
  if (!req.metricsContext) {
    req.metricsContext = {
      startTime: Date.now(),
      metrics: {
        timestamp: Date.now(),
      },
    };
  }

  req.metricsContext.metrics.uploadSize = options.fileSize;
  req.metricsContext.metrics.rowCount = options.rowCount;
  req.metricsContext.metrics.batchCount = options.batchCount;
}

/**
 * Track CSV processing completion metrics
 * Call this when CSV processing finishes to capture processing duration
 */
export function trackCsvProcessing(
  req: any,
  processingDuration: number,
  options?: {
    rowCount?: number;
    batchCount?: number;
    errors?: number;
  }
): void {
  if (!req.metricsContext) {
    req.metricsContext = {
      startTime: Date.now(),
      metrics: {
        timestamp: Date.now(),
      },
    };
  }

  req.metricsContext.metrics.csvProcessingTime = processingDuration;
  if (options?.rowCount) {
    req.metricsContext.metrics.rowCount = options.rowCount;
  }
  if (options?.batchCount) {
    req.metricsContext.metrics.batchCount = options.batchCount;
  }
}

/**
 * Extract collected metrics and finalize response metrics
 * Call this at the end of request processing to get final metrics
 */
export function getRequestMetrics(
  req: any,
  res: any,
  status: number
): RequestMetrics {
  const metricsContext = req.metricsContext || {
    startTime: Date.now(),
    metrics: {
      timestamp: Date.now(),
      endpoint: req.path || '/',
      method: req.method || 'GET',
    },
  };

  const responseTime = Date.now() - metricsContext.startTime;

  const statusClass = `${Math.floor(status / 100)}xx`;
  const endpoint = metricsContext.metrics.endpoint || '/';
  const routeGroup = endpoint.split('/').slice(0, 3).join('/') || '/';

  return {
    timestamp: metricsContext.metrics.timestamp || Date.now(),
    endpoint,
    method: metricsContext.metrics.method || 'GET',
    status,
    statusClass,
    routeGroup,
    responseTime,
    csvProcessingTime: metricsContext.metrics.csvProcessingTime,
    uploadSize: metricsContext.metrics.uploadSize,
    rowCount: metricsContext.metrics.rowCount,
    batchCount: metricsContext.metrics.batchCount,
    correlationId: metricsContext.metrics.correlationId,
  };
}

/**
 * Format metrics for Cloudflare Analytics Engine
 * 
 * Analytics Engine dataset schema:
 * - indexes: [endpoint, method] - for grouping/filtering
 * - blobs: []  - not used for metrics
 * - doubles: [responseTime, uploadSize, processingTime]
 */
export function formatMetricsForAnalytics(metrics: RequestMetrics) {
  return {
    indexes: [
      metrics.routeGroup || metrics.endpoint,
      metrics.method,
      metrics.statusClass || `status_${metrics.status}`,
    ],
    blobs: [],
    doubles: [
      metrics.responseTime,
      metrics.uploadSize || 0,
      metrics.csvProcessingTime || 0,
      metrics.rowCount || 0,
    ],
  };
}

/**
 * Instrumentation utilities for common operations
 */
export const metricsUtils = {
  /**
   * Measure async operation duration
   */
  async measureAsync<T>(
    operation: () => Promise<T>,
    onDuration?: (duration: number) => void
  ): Promise<T> {
    const start = Date.now();
    const result = await operation();
    const duration = Date.now() - start;
    onDuration?.(duration);
    return result;
  },

  /**
   * Format file size for human-readable display
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  },

  /**
   * Calculate rows per second
   */
  calculateThroughput(rowCount: number, durationMs: number): number {
    if (durationMs === 0) return 0;
    return Math.round((rowCount / (durationMs / 1000)) * 100) / 100;
  },
};
