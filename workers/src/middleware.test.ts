import { describe, it, expect, vi } from 'vitest';
import { isPublicEndpoint } from './middleware/auth';
import { createCorsMiddleware } from './middleware/cors.middleware';
import { createRateLimiter } from './middleware/rate-limit.middleware';
import { createConnectionLimiter } from './middleware/connection-limiter.middleware';
import { createQueryLimiter } from './middleware/query-limiter.middleware';
import { formatMetricsForAnalytics } from './middleware/metrics.middleware';
import { ExpressResponse, ExpressRequest } from './express-adapter';
import type { Env } from './types/env';

describe('Auth middleware helpers', () => {
  it('treats organization bootstrap as public for Workers edge auth', () => {
    // Given: The Clerk-backed organization bootstrap endpoint path
    const pathname = '/api/organization/bootstrap';

    // When: The Workers public-endpoint helper evaluates the path
    const result = isPublicEndpoint(pathname);

    // Then: The request bypasses legacy JWT validation at the edge
    expect(result).toBe(true);
  });

  it('keeps unrelated protected API routes behind Workers auth', () => {
    // Given: A protected API route that should still require Workers auth
    const pathname = '/api/users';

    // When: The Workers public-endpoint helper evaluates the path
    const result = isPublicEndpoint(pathname);

    // Then: The request does not bypass edge authentication
    expect(result).toBe(false);
  });
});

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

  it('persists limits across middleware instances when KV is configured', async () => {
    const store = new Map<string, string>();
    const kv = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    } as unknown as NonNullable<Env['RATE_LIMITER']>;

    const kvEnv = {
      RATE_LIMIT_WINDOW: '60000',
      RATE_LIMIT_MAX_REQUESTS: '1',
      RATE_LIMIT_MAX_AUTHENTICATED: '1',
      RATE_LIMITER: kv,
    } as Env;

    const firstInstanceMiddleware = createRateLimiter(kvEnv);
    const secondInstanceMiddleware = createRateLimiter(kvEnv);

    const firstRes = new ExpressResponse();
    let firstNext = false;
    await firstInstanceMiddleware(createRequest(), firstRes, () => {
      firstNext = true;
    });
    expect(firstNext).toBe(true);

    const secondRes = new ExpressResponse();
    await secondInstanceMiddleware(createRequest(), secondRes, () => undefined);

    const blockedResponse = secondRes.toResponse();
    expect(blockedResponse.status).toBe(429);
    expect(kv.get).toHaveBeenCalled();
    expect(kv.put).toHaveBeenCalled();
  });
});

describe('Connection limiter middleware', () => {
  const env = {
    MAX_CONCURRENT_CONNECTIONS: '1',
  } as Env;

  const createRequest = (): ExpressRequest => ({
    body: null,
    params: {},
    query: {},
    headers: {},
    method: 'GET',
    url: 'https://example.com/api/products',
    path: '/api/products',
    ip: '10.0.0.1',
    get: () => undefined,
  });

  it('returns 503 when concurrent request limit is exceeded', async () => {
    const middleware = createConnectionLimiter(env);

    const req1 = createRequest();
    const res1 = new ExpressResponse();
    let next1 = false;
    await middleware(req1, res1, () => {
      next1 = true;
    });
    expect(next1).toBe(true);

    const req2 = createRequest();
    const res2 = new ExpressResponse();
    await middleware(req2, res2, () => undefined);
    const response2 = res2.toResponse();

    expect(response2.status).toBe(503);
    const body = (await response2.json()) as { error: string };
    expect(body.error).toBe('Service Unavailable');

    req1.releaseConnection?.();

    const req3 = createRequest();
    const res3 = new ExpressResponse();
    let next3 = false;
    await middleware(req3, res3, () => {
      next3 = true;
    });

    expect(next3).toBe(true);
    req3.releaseConnection?.();
  });
});

describe('Query limiter middleware', () => {
  const env = {
    QUERY_MAX_RESULTS: '100',
    QUERY_TIMEOUT_MS: '10000',
  } as Env;

  const createRequest = (path: string, limit?: string): ExpressRequest => ({
    body: null,
    params: {},
    query: limit ? { limit } : {},
    headers: {},
    method: 'GET',
    url: `https://example.com${path}`,
    path,
    ip: '10.0.0.1',
    get: () => undefined,
  });

  it('caps list endpoint limit query to configured max', async () => {
    const middleware = createQueryLimiter(env);
    const req = createRequest('/api/products', '500');
    const res = new ExpressResponse();
    let nextCalled = false;

    await middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.query.limit).toBe('100');
    expect(req.requestTimeoutMs).toBe(10000);
  });

  it('does not inject a limit when missing from the request', async () => {
    const middleware = createQueryLimiter(env);
    const req = createRequest('/api/inventory-items');
    const res = new ExpressResponse();

    await middleware(req, res, () => undefined);

    expect(req.query.limit).toBeUndefined();
    expect(req.requestTimeoutMs).toBe(10000);
  });

  it('does not modify non-api routes', async () => {
    const middleware = createQueryLimiter(env);
    const req = createRequest('/health', '500');
    const res = new ExpressResponse();

    await middleware(req, res, () => undefined);

    expect(req.query.limit).toBe('500');
    expect(req.requestTimeoutMs).toBeUndefined();
  });
});

describe('Metrics middleware', () => {
  it('formats analytics datapoints with a single sampling index', () => {
    const payload = formatMetricsForAnalytics({
      endpoint: '/api/health',
      routeGroup: '/api/health',
      method: 'GET',
      status: 200,
      statusClass: '2xx',
      responseTime: 25,
    });

    expect(payload.indexes).toHaveLength(1);
    expect(payload.indexes[0]).toBe('/api/health');
    expect(payload.blobs).toHaveLength(2);
    expect(payload.blobs).toEqual(['GET', '2xx']);
  });
});
