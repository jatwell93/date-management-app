/**
 * Rate Limiting Middleware for Phase 13 Security Hardening
 *
 * Provides rate limiting with different presets:
 * - standard: 100 requests per 15 minutes
 * - strict: 5 requests per 15 minutes (for login/register)
 * - upload: 10 requests per 1 hour (for file uploads)
 *
 * Uses express-rate-limit for flexible, in-memory rate limiting.
 */

import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { envConfig } from '../config/environment';
import { Logger } from '../utils/logger';

/**
 * Standard rate limiter: 100 requests per 15 minutes
 * Used for general API endpoints
 */
export const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  statusCode: 429,
  skipSuccessfulRequests: false, // Count successful requests
  skipFailedRequests: false, // Count failed requests
  handler: (req: Request, res: Response) => {
    Logger.warn('Rate limit exceeded (standard)', {
      ip: (req.headers['x-forwarded-for'] as string) || req.ip,
      endpoint: req.path,
      method: req.method,
    });
    res.status(429).json({
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: (req as any).rateLimit?.resetTime
        ? new Date((req as any).rateLimit.resetTime).toISOString()
        : undefined,
    });
  },
  store: undefined, // Uses default memory store (fine for single-instance, use Redis for distributed)
});

/**
 * Strict rate limiter: 5 requests per 15 minutes
 * Used for authentication endpoints (login, register) to prevent brute force
 */
export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: 'Too many login attempts, please try again later.',
  statusCode: 429,
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  handler: (req: Request, res: Response) => {
    Logger.warn('Rate limit exceeded (strict)', {
      ip: (req.headers['x-forwarded-for'] as string) || req.ip,
      endpoint: req.path,
      method: req.method,
    });
    res.status(429).json({
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many login attempts, please try again later.',
      retryAfter: (req as any).rateLimit?.resetTime
        ? new Date((req as any).rateLimit.resetTime).toISOString()
        : undefined,
    });
  },
});

/**
 * Upload rate limiter: 10 requests per 1 hour
 * Used for file upload endpoints to prevent abuse
 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 requests per windowMs
  message: 'Too many uploads from this IP, please try again later.',
  statusCode: 429,
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  handler: (req: Request, res: Response) => {
    Logger.warn('Rate limit exceeded (upload)', {
      ip: (req.headers['x-forwarded-for'] as string) || req.ip,
      endpoint: req.path,
      method: req.method,
    });
    res.status(429).json({
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many uploads from this IP, please try again later.',
      retryAfter: (req as any).rateLimit?.resetTime
        ? new Date((req as any).rateLimit.resetTime).toISOString()
        : undefined,
    });
  },
});

/**
 * Global rate limiter: 1000 requests per 1 minute
 * Applied to all API requests as a catch-all for DDoS protection
 */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  statusCode: 429,
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  handler: (req: Request, res: Response) => {
    // Don't log global rate limit hits (would be noisy)
    res.status(429).json({
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again later.',
    });
  },
});

/**
 * Bypass rate limiting for specific IPs or requests
 * Useful for internal services or trusted clients
 *
 * @param allowedIps - Array of IPs to bypass rate limiting
 * @returns Middleware that skips rate limiting for allowed IPs
 */
export const skipRateLimitForIps = (allowedIps: string[]) => {
  return (req: Request) => {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip || '';
    return allowedIps.includes(clientIp);
  };
};

/**
 * Bypass rate limiting for specific paths
 * Useful for health checks or public endpoints
 *
 * @param allowedPaths - Array of paths to bypass rate limiting
 * @returns Middleware that skips rate limiting for allowed paths
 */
export const skipRateLimitForPaths = (allowedPaths: string[]) => {
  return (req: Request) => {
    return allowedPaths.some((path) => req.path.startsWith(path));
  };
};

/**
 * Trial conversion rate limiter: 5 requests per hour
 * Used for /convert-trial endpoint to prevent rapid re-submits
 */
export const trialConversionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Limit each IP to 5 requests per windowMs
  message: 'Too many trial conversion attempts, please try again later.',
  statusCode: 429,
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  handler: (req: Request, res: Response) => {
    Logger.warn('Rate limit exceeded (trial conversion)', {
      ip: (req.headers['x-forwarded-for'] as string) || req.ip,
      endpoint: req.path,
      method: req.method,
    });
    res.status(429).json({
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many trial conversion attempts, please try again later.',
      retryAfter: (req as any).rateLimit?.resetTime
        ? new Date((req as any).rateLimit.resetTime).toISOString()
        : undefined,
    });
  },
});
