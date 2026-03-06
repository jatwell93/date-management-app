/**
 * Error Handling Middleware for Cloudflare Workers
 * 
 * Centralized error handling with optional Sentry integration.
 */

import { Env } from '../types/env';
import { ExpressRequest, ExpressResponse } from '../express-adapter';

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * Logger for Workers environment
 */
export class WorkersLogger {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      environment: this.env.NODE_ENV,
      ...meta,
    };

    // Console log for all levels
    console.log(JSON.stringify(logEntry));

    // Send to Sentry for errors
    if (level === LogLevel.ERROR && this.env.SENTRY_DSN) {
      // Sentry integration would go here
      // For now, just log to console
    }
  }

  debug(message: string, meta?: Record<string, unknown>) {
    this.log(LogLevel.DEBUG, message, meta);
  }

  info(message: string, meta?: Record<string, unknown>) {
    this.log(LogLevel.INFO, message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>) {
    this.log(LogLevel.WARN, message, meta);
  }

  error(message: string, meta?: Record<string, unknown>) {
    this.log(LogLevel.ERROR, message, meta);
  }
}

/**
 * Error handler middleware
 */
export function createErrorHandler(env: Env) {
  const logger = new WorkersLogger(env);

  return (error: Error, req: ExpressRequest, res: ExpressResponse) => {
    const metricsContext = (req as any).metricsContext;
    const durationMs = metricsContext?.startTime ? Date.now() - metricsContext.startTime : undefined;

    // Log error
    logger.error('Request error', {
      error: error.message,
      stack: error.stack,
      method: req.method,
      path: req.path,
      ip: req.ip,
      correlationId: req.correlationId,
      userId: req.user?.id ?? req.userId,
      durationMs,
    });

    // Send error response (don't leak stack traces in production)
    const isDevelopment = env.NODE_ENV === 'development';
    
    res.status(500).json({
      error: 'Internal Server Error',
      message: isDevelopment ? error.message : 'An unexpected error occurred',
      ...(isDevelopment && { stack: error.stack }),
    });
  };
}

/**
 * Sanitize request data for logging (remove sensitive fields)
 */
export function sanitizeForLogging(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sensitiveFields = [
    'password',
    'token',
    'secret',
    'authorization',
    'api_key',
    'apiKey',
  ];

  const sanitized = { ...data };

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveFields.some(field => lowerKey.includes(field))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = sanitizeForLogging(sanitized[key]);
    }
  }

  return sanitized;
}

/**
 * Request logging middleware
 */
export function createRequestLogger(env: Env) {
  const logger = new WorkersLogger(env);

  return (req: ExpressRequest, res: ExpressResponse, next: () => void) => {
    const startTime = Date.now();

    // Log incoming request
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'Incoming request',
      organizationId: req.organizationId,
      path: req.path,
      method: req.method,
      correlationId: req.correlationId,
      userId: req.user?.id ?? req.userId,
    }));

    // Wrap response to log completion
    const originalJson = res.json.bind(res);
    res.json = function(data: any) {
      const duration = Date.now() - startTime;
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Request processed',
        organizationId: req.organizationId,
        path: req.path,
        duration: duration,
        statusCode: res['statusCode'] || 200,
        correlationId: req.correlationId,
        userId: req.user?.id ?? req.userId,
      }));
      return originalJson(data);
    };

    next();
  };
}
