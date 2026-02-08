"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = void 0;
const logger_1 = require("../utils/logger");
const errors_1 = require("../errors");
/**
 * Enhanced Error Handler Middleware (Phase 13)
 *
 * Handles both custom BaseError instances and generic Error objects.
 * Provides standardized JSON responses with appropriate HTTP status codes.
 * Logs errors with context for debugging and monitoring.
 */
const errorHandler = (err, req, res, _next) => {
    // Prevent multiple responses
    if (res.headersSent) {
        return _next(err);
    }
    // Determine status code and error payload
    let statusCode = 500;
    let errorPayload = {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        statusCode: 500,
    };
    if ((0, errors_1.isBaseError)(err)) {
        // Custom error - use its properties
        statusCode = err.statusCode;
        errorPayload = {
            code: err.code,
            message: err.message,
            statusCode: err.statusCode,
        };
        // Include validation errors if present
        if (err instanceof errors_1.ValidationError && err.errors) {
            errorPayload.errors = err.errors;
        }
    }
    else {
        // Generic Error - treat as internal error
        const isDevelopment = process.env.NODE_ENV === 'development';
        errorPayload.message = isDevelopment ? err.message : 'An unexpected error occurred';
        // Include stack trace in development
        if (isDevelopment && err.stack) {
            errorPayload.stack = err.stack;
        }
    }
    // Log the error with additional context
    logger_1.Logger.error(`Request Error: ${err.message}`, {
        code: errorPayload.code,
        statusCode,
        url: req.url,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        userId: req.userId,
        stack: err.stack,
    });
    // Send error response
    res.status(statusCode).json(errorPayload);
};
exports.errorHandler = errorHandler;
