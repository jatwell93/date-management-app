import { describe, expect, it, vi } from 'vitest';
import {
  applyRateLimitHeaders,
  checkRateLimit,
  createInMemoryRateLimitStore,
} from './minimal-rate-limit';
import type { Env } from '../types/env';

const createEnv = (overrides: Partial<Env> = {}): Env =>
  ({
    RATE_LIMIT_WINDOW: '60000',
    RATE_LIMIT_MAX_REQUESTS: '1',
    RATE_LIMIT_MAX_AUTHENTICATED: '3',
    ...overrides,
  }) as Env;

describe('minimal Worker rate limit helpers', () => {
  it('applies rate-limit headers and retry metadata without changing the body', async () => {
    const base = new Response(JSON.stringify({ error: 'blocked' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
    const response = applyRateLimitHeaders(
      base,
      { allowed: false, limit: 1, remaining: 0, resetTime: Date.UTC(2026, 0, 1) },
      60,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('X-RateLimit-Limit')).toBe('1');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(response.headers.get('Retry-After')).toBe('60');
    await expect(response.json()).resolves.toEqual({ error: 'blocked' });
  });

  it('uses the authenticated limit for presigned PUT uploads without Authorization', async () => {
    const store = createInMemoryRateLimitStore();
    const request = new Request('https://example.com/api/upload/presigned/uploads%2Fuser-7%2Fbig.csv', {
      method: 'PUT',
      headers: { 'CF-Connecting-IP': '203.0.113.10' },
    });

    const decision = await checkRateLimit(request, createEnv(), store);

    expect(decision.allowed).toBe(true);
    expect(decision.limit).toBe(3);
    expect(decision.remaining).toBe(2);
  });

  it('uses KV sliding-window counters when the RATE_LIMITER binding exists', async () => {
    const get = vi.fn().mockResolvedValue('0');
    const put = vi.fn().mockResolvedValue(undefined);
    const request = new Request('https://example.com/api/products', {
      headers: { 'CF-Connecting-IP': '203.0.113.11' },
    });

    const decision = await checkRateLimit(
      request,
      createEnv({
        RATE_LIMITER: { get, put } as unknown as KVNamespace,
      }),
      createInMemoryRateLimitStore(),
    );

    expect(decision.allowed).toBe(true);
    expect(put).toHaveBeenCalledWith(expect.stringContaining('ratelimit:anon:203.0.113.11'), '1', {
      expirationTtl: 120,
    });
  });
});
