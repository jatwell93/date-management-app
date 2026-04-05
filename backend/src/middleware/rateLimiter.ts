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

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request, Response } from 'express';
import { Logger } from '../utils/logger';

interface AuthenticatedRateLimitRequest extends Request {
  organizationId?: string;
  userId?: number;
  rateLimit?: {
    resetTime?: number | Date;
  };
}

function getRetryAfterIso(req: Request): string | undefined {
  const resetTime = (req as AuthenticatedRateLimitRequest).rateLimit?.resetTime;
  if (!resetTime) {
    return undefined;
  }

  const resetDate = resetTime instanceof Date ? resetTime : new Date(resetTime);
  return resetDate.toISOString();
}

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
      retryAfter: getRetryAfterIso(req),
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
      retryAfter: getRetryAfterIso(req),
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
      retryAfter: getRetryAfterIso(req),
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
 * Presigned URL rate limiter: 50 requests per hour per AUTHENTICATED USER
 *
 * SECURITY CRITICAL (Phase 20 - Security Audit Finding):
 * - Rates limits by organizationId + userId, NOT by IP
 * - Prevents malicious users from generating excessive presigned URLs
 * - Presigned URLs can be shared, but per-user limit prevents abuse
 * - Monitoring: logs organizationId for security team analysis
 *
 * Reference: docs/security-audit.md section 3 "Presigned URL Security"
 * Reference: docs/PHASE-20-SESSION-2-SUMMARY.md - Task 9
 */
export const presignedUrlLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 presigned URLs per hour per authenticated user
  message: 'Too many presigned URL requests. Limit is 50 per hour.',
  statusCode: 429,
  skipSuccessfulRequests: false,
  skipFailedRequests: false,
  // Key generator: use organizationId + userId for authenticated users, IP for unauthenticated
  keyGenerator: (req: Request) => {
    const authReq = req as AuthenticatedRateLimitRequest;
    if (authReq.organizationId && authReq.userId) {
      // Authenticated request: rate limit by user
      return `presigned-url:${authReq.organizationId}:${authReq.userId}`;
    }
    // Fallback to IP if not authenticated (shouldn't happen on this endpoint).
    // Use ipKeyGenerator to normalize IPv6 addresses and prevent bypass.
    const forwardedFor = (req.headers['x-forwarded-for'] as string | undefined)
      ?.split(',')[0]
      ?.trim();
    const ip = forwardedFor || req.ip || '';
    return `presigned-url:ip:${ipKeyGenerator(ip)}`;
  },
  handler: (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRateLimitRequest;
    Logger.warn('Presigned URL rate limit exceeded', {
      organizationId: authReq.organizationId || 'unknown',
      userId: authReq.userId || 'unauthenticated',
      ip: (req.headers['x-forwarded-for'] as string) || req.ip,
      endpoint: req.path,
      method: req.method,
      timestamp: new Date().toISOString(),
    });
    const resetTime = authReq.rateLimit?.resetTime;
    const resetTimeMs =
      resetTime instanceof Date
        ? resetTime.getTime()
        : typeof resetTime === 'number'
          ? resetTime
          : undefined;
    const retryAfter = resetTimeMs ? Math.ceil((resetTimeMs - Date.now()) / 1000) : 3600;
    res.setHeader('Retry-After', retryAfter.toString());
    res.status(429).json({
      code: 'ERR_RATE_LIMIT_EXCEEDED',
      message: 'Too many presigned URL requests. Limit is 50 per hour.',
      retryAfter,
      details: {
        limit: 50,
        window: '1 hour',
        type: 'presigned_url_generation',
      },
    });
  },
});

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
      retryAfter: getRetryAfterIso(req),
    });
  },
});
