/**
 * CORS (Cross-Origin Resource Sharing) Middleware for Phase 13 Security Hardening
 *
 * Configures CORS with environment-based origin whitelist.
 * - Development: localhost:3000, localhost:3001
 * - Production: CORS_ORIGINS environment variable (comma-separated)
 */

import cors, { CorsOptions } from 'cors';
import { envConfig } from '../config/environment';
import { Logger } from '../utils/logger';

/**
 * Parse CORS_ORIGINS environment variable into an array of allowed origins
 * Format: "https://example.com, https://app.example.com"
 */
const parseAllowedOrigins = (): string[] => {
  const allowedOrigins: string[] = [];

  // Development origins (always allowed in development)
  if (envConfig.NODE_ENV !== 'production') {
    allowedOrigins.push('http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002');
  }

  // Production/configured origins
  if (envConfig.CORS_ORIGINS) {
    const origins = envConfig.CORS_ORIGINS.split(',').map((origin) => origin.trim());
    allowedOrigins.push(...origins);
  }

  // If no origins configured, default to self
  if (allowedOrigins.length === 0) {
    Logger.warn('No CORS origins configured, restricting to self only');
    return [envConfig.FRONTEND_URL || 'http://localhost:3000'];
  }

  return allowedOrigins;
};

const allowedOrigins = parseAllowedOrigins();
const allowNoOriginRequests =
  envConfig.NODE_ENV !== 'production' || envConfig.ALLOW_NO_ORIGIN_IN_PRODUCTION;

/**
 * CORS options configuration
 */
const corsOptions: CorsOptions = {
  // Only allow requests from whitelisted origins
  origin: (origin, callback) => {
    if (!origin) {
      if (allowNoOriginRequests) {
        callback(null, true);
      } else {
        Logger.warn('CORS request rejected', {
          origin: 'undefined',
          reason: 'Missing Origin header in production',
        });
        callback(new Error('Not allowed by CORS'));
      }
      return;
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      Logger.warn('CORS request rejected', {
        origin,
        allowedOrigins,
      });
      callback(new Error('Not allowed by CORS'));
    }
  },

  // Allow credentials (cookies, authorization headers)
  credentials: true,

  // Allow specific headers
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-User-ID'],

  // Allow specific methods
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

  // Success status for legacy browsers
  optionsSuccessStatus: 200,

  // How long browsers can cache preflight requests
  maxAge: 86400, // 24 hours
};

/**
 * CORS middleware factory
 * Can be customized per route if needed
 */
export const corsMiddleware = cors(corsOptions);

/**
 * Get the current list of allowed origins
 * Useful for logging and debugging
 */
export const getAllowedOrigins = (): string[] => allowedOrigins;

/**
 * Check if an origin is allowed
 * Useful for custom logic
 */
export const isOriginAllowed = (origin?: string): boolean => {
  if (!origin) return allowNoOriginRequests;
  return allowedOrigins.includes(origin);
};
