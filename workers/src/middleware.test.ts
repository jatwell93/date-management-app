import { describe, it, expect } from 'vitest';
import { createCorsMiddleware } from './middleware/cors.middleware';
import { createRateLimiter } from './middleware/rate-limit.middleware';
import { ExpressResponse, ExpressRequest } from './express-adapter';
import type { Env } from './types/env';

describe('CORS middleware', () => {
  it('sets allow-origin for matching origin', async () => {
    const middleware = createCorsMiddleware({
      origin: ['http://localhost:3000'],
      credentials: true,
      methods: ['GET', 'OPTIONS'],
      allowedHeaders: ['Content-Type'],
    });

    const headers: Record<string, string> = { origin: 'http://localhost:3000' };
    const req: ExpressRequest = {
      body: null,
      params: {},
      query: {},
      headers,
      method: 'GET',
      url: 'https://example.com/api/health',
      path: '/api/health',
      ip: '127.0.0.1',
      get: (header: string) => headers[header.toLowerCase()],
    };

    const res = new ExpressResponse();
    let nextCalled = false;
    await middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(res.getHeader('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    expect(res.getHeader('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('returns 204 for preflight', async () => {
    const middleware = createCorsMiddleware({
      origin: '*',
      credentials: false,
      methods: ['GET', 'OPTIONS'],
    });

    const headers: Record<string, string> = { origin: 'http://localhost:3000' };
    const req: ExpressRequest = {
      body: null,
      params: {},
      query: {},
      headers,
      method: 'OPTIONS',
      url: 'https://example.com/api/health',
      path: '/api/health',
      ip: '127.0.0.1',
      get: (header: string) => headers[header.toLowerCase()],
    };

    const res = new ExpressResponse();
    await middleware(req, res, () => undefined);

    const response = res.toResponse();
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });
});

describe('Rate limiter middleware', () => {
  const env = {
    RATE_LIMIT_WINDOW: '1000',
    RATE_LIMIT_MAX_REQUESTS: '2',
    RATE_LIMIT_MAX_AUTHENTICATED: '3',
  } as Env;

  const createRequest = (): ExpressRequest => ({
    body: null,
    params: {},
    query: {},
    headers: {},
    method: 'GET',
    url: 'https://example.com/api/health',
    path: '/api/health',
    ip: '10.0.0.1',
    get: () => undefined,
  });

  it('blocks after exceeding limit', async () => {
    const middleware = createRateLimiter(env);

    const res1 = new ExpressResponse();
    let next1 = false;
    await middleware(createRequest(), res1, () => {
      next1 = true;
    });
    expect(next1).toBe(true);

    const res2 = new ExpressResponse();
    let next2 = false;
    await middleware(createRequest(), res2, () => {
      next2 = true;
    });
    expect(next2).toBe(true);

    const res3 = new ExpressResponse();
    await middleware(createRequest(), res3, () => undefined);

    const response = res3.toResponse();
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBeTruthy();
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Too Many Requests');
  });
});
