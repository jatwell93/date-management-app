import { Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/logger';
import { BaseError, isBaseError, ValidationError, InternalError } from '../errors';

/**
 * Type-safe error payload structure
 */
interface ErrorPayload {
  code: string;
  message: string;
  statusCode: number;
  errors?: Record<string, unknown>[];
  stack?: string;
}

/**
 * Enhanced Error Handler Middleware (Phase 13)
 *
 * Handles both custom BaseError instances and generic Error objects.
 * Provides standardized JSON responses with appropriate HTTP status codes.
 * Logs errors with context for debugging and monitoring.
 */
export const errorHandler = (err: Error, req: Request, res: Response, _next: NextFunction) => {
  // Prevent multiple responses
  if (res.headersSent) {
    return _next(err);
  }

  // Determine status code and error payload
  let statusCode = 500;
  let errorPayload: ErrorPayload = {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    statusCode: 500,
  };

  if (isBaseError(err)) {
    // Custom error - use its properties
    statusCode = err.statusCode;
    errorPayload = {
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
    };

    // Include validation errors if present
    if (err instanceof ValidationError && err.errors) {
      errorPayload.errors = err.errors;
    }
  } else {
    // Generic Error - treat as internal error
    const isDevelopment = process.env.NODE_ENV === 'development';
    errorPayload.message = isDevelopment ? err.message : 'An unexpected error occurred';

    // Include stack trace in development
    if (isDevelopment && err.stack) {
      errorPayload.stack = err.stack;
    }
  }

  // Log the error with additional context
  Logger.error(`Request Error: ${err.message}`, {
    code: errorPayload.code,
    statusCode,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: (req as any).userId,
    stack: err.stack,
  });

  // Send error response
  res.status(statusCode).json(errorPayload);
};
