export type ExpressRequest = {
  startTime?: number;
  path?: string;
  originalUrl?: string;
  method: string;
  csvMetrics?: {
    rowsProcessed?: number;
    rowsSkipped?: number;
    duration?: number;
    memoryUsed?: number;
  };
  error?: Error | { message?: string };
  [key: string]: any;
};

export type ExpressResponse = {
  [key: string]: any;
};

export interface RequestMetrics {
  timestamp: number;
  endpoint: string;
  method: string;
  status: number;
  responseTime: number;
  errorMessage?: string;
  csvMetrics?: {
    rowsProcessed?: number;
    rowsSkipped?: number;
    duration?: number;
    memoryUsed?: number;
  };
}

/**
 * Extract metrics from request context
 * This includes both request metrics and any CSV instrumentation data
 */
export function getRequestMetrics(
  req: ExpressRequest,
  res: ExpressResponse,
  status: number
): RequestMetrics {
  const now = Date.now();
  const startTime = req.startTime || now;
  const responseTime = now - startTime;

  const metrics: RequestMetrics = {
    timestamp: startTime,
    endpoint: req.path || req.originalUrl || '/',
    method: req.method,
    status,
    responseTime,
  };

  // Include CSV metrics if present from instrumentation
  if (req.csvMetrics) {
    metrics.csvMetrics = {
      rowsProcessed: req.csvMetrics.rowsProcessed,
      rowsSkipped: req.csvMetrics.rowsSkipped,
      duration: req.csvMetrics.duration,
      memoryUsed: req.csvMetrics.memoryUsed,
    };
  }

  // Include error message if present
  if (req.error) {
    metrics.errorMessage = req.error.message || String(req.error);
  }

  return metrics;
}
