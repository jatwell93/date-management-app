import { describe, expect, it } from 'vitest';
import {
  applyCorsHeaders,
  errorResponse,
  getCorsHeaders,
  jsonResponse,
  maybeCompressJsonResponse,
} from './worker-response';
import type { Env } from '../types/env';

const createEnv = (overrides: Partial<Env> = {}): Env =>
  ({
    NODE_ENV: 'production',
    FRONTEND_URL: 'https://app.example.com',
    ...overrides,
  }) as Env;

describe('worker response helpers', () => {
  it('keeps production CORS credentialed to the configured frontend origin', () => {
    const headers = getCorsHeaders(createEnv(), 'https://evil.example.com') as Record<
      string,
      string
    >;

    expect(headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    expect(headers['Access-Control-Allow-Credentials']).toBe('true');
  });

  it('allows the request origin in development without credentials', () => {
    const headers = getCorsHeaders(
      createEnv({ NODE_ENV: 'development', FRONTEND_URL: undefined }),
      'http://localhost:3000',
    ) as Record<string, string>;

    expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
    expect(headers['Access-Control-Allow-Credentials']).toBeUndefined();
  });

  it('adds CORS to error responses that do not already have it', async () => {
    const response = applyCorsHeaders(
      errorResponse('boom', 500),
      createEnv(),
      'https://app.example.com',
    );

    expect(response.status).toBe(500);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
    await expect(response.json()).resolves.toEqual({ error: 'boom' });
  });

  it('compresses large JSON responses with manual gzip encoding and Vary', async () => {
    const request = new Request('https://example.com/api/health', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    const response = jsonResponse({
      items: Array.from({ length: 600 }, (_, index) => `item-${index}`),
    });

    const compressed = await maybeCompressJsonResponse(request, response);

    expect(compressed.headers.get('Content-Encoding')).toBe('gzip');
    expect(compressed.headers.get('Vary')).toBe('accept-encoding');
    const decompressed = await new Response(
      new Blob([await compressed.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).json();
    expect(decompressed).toMatchObject({ items: expect.any(Array) });
  });
});
