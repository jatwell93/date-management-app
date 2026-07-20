import type { Env } from '../types/env';

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
}

export type InMemoryRateLimitStore = Map<string, { count: number; resetTime: number }>;

export function createInMemoryRateLimitStore(): InMemoryRateLimitStore {
  return new Map<string, { count: number; resetTime: number }>();
}

export const inMemoryRateLimitStore = createInMemoryRateLimitStore();

function getClientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
    'unknown'
  );
}

export function applyRateLimitHeaders(
  response: Response,
  decision: RateLimitDecision,
  retryAfterSeconds?: number,
): Response {
  const headers = new Headers(response.headers);
  headers.set('X-RateLimit-Limit', String(decision.limit));
  headers.set('X-RateLimit-Remaining', String(decision.remaining));
  headers.set('X-RateLimit-Reset', new Date(decision.resetTime).toISOString());

  if (retryAfterSeconds !== undefined) {
    headers.set('Retry-After', String(retryAfterSeconds));
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function checkRateLimit(
  request: Request,
  env: Env,
  store: InMemoryRateLimitStore = inMemoryRateLimitStore,
): Promise<RateLimitDecision> {
  const windowMs = parseInt(env.RATE_LIMIT_WINDOW || '60000', 10);
  const maxAnonymous = parseInt(env.RATE_LIMIT_MAX_REQUESTS || '5', 10);
  const maxAuthenticated = parseInt(env.RATE_LIMIT_MAX_AUTHENTICATED || '30', 10);

  const pathname = new URL(request.url).pathname;
  const isPresignedUpload = request.method === 'PUT' && pathname.includes('/upload/presigned/');
  const isAuthenticated = Boolean(request.headers.get('Authorization')) || isPresignedUpload;
  const limit = isAuthenticated ? maxAuthenticated : maxAnonymous;

  const ip = getClientIp(request);
  const keyBase = `${isAuthenticated ? 'auth' : 'anon'}:${ip}`;

  const now = Date.now();
  const currentWindow = Math.floor(now / windowMs);
  const previousWindow = currentWindow - 1;
  const currentKey = `ratelimit:${keyBase}:${currentWindow}`;
  const previousKey = `ratelimit:${keyBase}:${previousWindow}`;
  const resetTime = (currentWindow + 1) * windowMs;

  if (env.RATE_LIMITER) {
    const [currentRaw, previousRaw] = await Promise.all([
      env.RATE_LIMITER.get(currentKey),
      env.RATE_LIMITER.get(previousKey),
    ]);

    const currentCount = Number.parseInt(currentRaw || '0', 10) || 0;
    const previousCount = Number.parseInt(previousRaw || '0', 10) || 0;

    const elapsedInWindow = now - currentWindow * windowMs;
    const previousWeight = (windowMs - elapsedInWindow) / windowMs;
    const effectiveCount = currentCount + previousCount * previousWeight;

    if (effectiveCount + 1 > limit) {
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetTime,
      };
    }

    const nextCurrentCount = currentCount + 1;
    await env.RATE_LIMITER.put(currentKey, String(nextCurrentCount), {
      expirationTtl: Math.ceil((windowMs * 2) / 1000),
    });

    return {
      allowed: true,
      limit,
      remaining: Math.max(0, Math.floor(limit - (effectiveCount + 1))),
      resetTime,
    };
  }

  const existing = store.get(keyBase);
  if (!existing || now > existing.resetTime) {
    store.set(keyBase, {
      count: 1,
      resetTime: now + windowMs,
    });

    return {
      allowed: true,
      limit,
      remaining: limit - 1,
      resetTime: now + windowMs,
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetTime: existing.resetTime,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    limit,
    remaining: limit - existing.count,
    resetTime: existing.resetTime,
  };
}
