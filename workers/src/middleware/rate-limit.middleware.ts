/**
 * Rate Limiting Middleware for Cloudflare Workers
 * 
 * Implements IP-based rate limiting using in-memory storage.
 * For production, consider using KV namespace or Durable Objects for distributed rate limiting.
 */

import { Env } from '../types/env';
import { ExpressRequest, ExpressResponse, ExpressMiddleware } from '../express-adapter';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * In-memory rate limiter (per-worker instance)
 * Note: This resets on worker restart, but suitable for simple rate limiting
 */
class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private window: number;
  private maxRequests: number;
  private maxAuthenticated: number;

  constructor(window: number, maxRequests: number, maxAuthenticated: number) {
    this.window = window;
    this.maxRequests = maxRequests;
    this.maxAuthenticated = maxAuthenticated;
  }

  async checkLimit(key: string, isAuthenticated: boolean): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const now = Date.now();
    const entry = this.store.get(key);
    const limit = isAuthenticated ? this.maxAuthenticated : this.maxRequests;

    // Clean up expired entries periodically
    if (Math.random() < 0.01) {
      this.cleanup(now);
    }

    if (!entry || now > entry.resetTime) {
      // New window
      this.store.set(key, {
        count: 1,
        resetTime: now + this.window,
      });
      return {
        allowed: true,
        remaining: limit - 1,
        resetTime: now + this.window,
      };
    }

    if (entry.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: entry.resetTime,
      };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: limit - entry.count,
      resetTime: entry.resetTime,
    };
  }

  private cleanup(now: number) {
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetTime) {
        this.store.delete(key);
      }
    }
  }
}

/**
 * Create rate limiting middleware
 */
export function createRateLimiter(env: Env): ExpressMiddleware {
  const window = parseInt(env.RATE_LIMIT_WINDOW || '60000', 10); // 1 minute default
  const maxRequests = parseInt(env.RATE_LIMIT_MAX_REQUESTS || '10', 10);
  const maxAuthenticated = parseInt(env.RATE_LIMIT_MAX_AUTHENTICATED || '100', 10);

  const limiter = new RateLimiter(window, maxRequests, maxAuthenticated);

  return async (req: ExpressRequest, res: ExpressResponse, next: () => void) => {
    const key = `ratelimit:${req.ip}`;
    const isAuthenticated = !!req.user; // Set by authenticateToken middleware

    const result = await limiter.checkLimit(key, isAuthenticated);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', isAuthenticated ? maxAuthenticated.toString() : maxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
    res.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter.toString());
      res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
        retryAfter,
      });
      return;
    }

    next();
  };
}
