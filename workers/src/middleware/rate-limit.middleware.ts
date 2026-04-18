/**
 * Rate Limiting Middleware for Cloudflare Workers
 *
 * Implements distributed IP-based rate limiting using Cloudflare KV when available.
 * Falls back to in-memory storage when KV is not configured (development/test safety net).
 */

import { Env } from '../types/env';
import { ExpressRequest, ExpressResponse, ExpressMiddleware } from '../express-adapter';

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
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

  async checkLimit(key: string, isAuthenticated: boolean): Promise<RateLimitResult> {
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
 * KV-backed distributed rate limiter.
 *
 * Uses a two-window weighted counter approximation for sliding-window behavior:
 * - Current window count (full weight)
 * - Previous window count (decays linearly)
 */
class KvRateLimiter {
  private kv: KVNamespace;
  private window: number;
  private maxRequests: number;
  private maxAuthenticated: number;

  constructor(kv: KVNamespace, window: number, maxRequests: number, maxAuthenticated: number) {
    this.kv = kv;
    this.window = window;
    this.maxRequests = maxRequests;
    this.maxAuthenticated = maxAuthenticated;
  }

  async checkLimit(key: string, isAuthenticated: boolean): Promise<RateLimitResult> {
    const now = Date.now();
    const limit = isAuthenticated ? this.maxAuthenticated : this.maxRequests;

    const currentWindow = Math.floor(now / this.window);
    const previousWindow = currentWindow - 1;

    const currentKey = this.buildWindowKey(key, currentWindow);
    const previousKey = this.buildWindowKey(key, previousWindow);

    const [currentCount, previousCount] = await Promise.all([
      this.readCount(currentKey),
      this.readCount(previousKey),
    ]);

    const elapsedInWindow = now - currentWindow * this.window;
    const previousWeight = (this.window - elapsedInWindow) / this.window;
    const effectiveCount = currentCount + previousCount * previousWeight;

    if (effectiveCount + 1 > limit) {
      const resetTime = (currentWindow + 1) * this.window;
      return {
        allowed: false,
        remaining: 0,
        resetTime,
      };
    }

    const nextCurrentCount = currentCount + 1;
    await this.kv.put(currentKey, String(nextCurrentCount), {
      expirationTtl: Math.ceil((this.window * 2) / 1000),
    });

    const resetTime = (currentWindow + 1) * this.window;
    const remaining = Math.max(0, Math.floor(limit - (effectiveCount + 1)));

    return {
      allowed: true,
      remaining,
      resetTime,
    };
  }

  private buildWindowKey(key: string, windowNumber: number): string {
    return `ratelimit:${key}:${windowNumber}`;
  }

  private async readCount(windowKey: string): Promise<number> {
    const raw = await this.kv.get(windowKey);
    if (!raw) {
      return 0;
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
}

/**
 * Extract client IP from Cloudflare headers
 * In Workers, the actual client IP is in CF-Connecting-IP or X-Forwarded-For
 */
function getClientIp(req: ExpressRequest): string {
  return (
    (req.headers['cf-connecting-ip'] as string) ||
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * Create rate limiting middleware
 */
export function createRateLimiter(env: Env): ExpressMiddleware {
  const window = parseInt(env.RATE_LIMIT_WINDOW || '60000', 10); // 1 minute default
  const maxRequests = parseInt(env.RATE_LIMIT_MAX_REQUESTS || '10', 10);
  const maxAuthenticated = parseInt(env.RATE_LIMIT_MAX_AUTHENTICATED || '100', 10);
  const inMemoryLimiter = new RateLimiter(window, maxRequests, maxAuthenticated);
  const kvLimiter = env.RATE_LIMITER
    ? new KvRateLimiter(env.RATE_LIMITER, window, maxRequests, maxAuthenticated)
    : null;

  return async (req: ExpressRequest, res: ExpressResponse, next: () => void) => {
    const key = getClientIp(req);
    const isAuthenticated = !!req.user; // Set by authenticateToken middleware
    const result = kvLimiter
      ? await kvLimiter.checkLimit(key, isAuthenticated)
      : await inMemoryLimiter.checkLimit(key, isAuthenticated);

    // Set rate limit headers
    res.setHeader(
      'X-RateLimit-Limit',
      isAuthenticated ? maxAuthenticated.toString() : maxRequests.toString(),
    );
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
