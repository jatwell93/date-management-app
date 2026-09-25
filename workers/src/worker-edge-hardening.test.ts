/**
 * Integration coverage for task 3.1.o, exercising the **real entry point**
 * rather than the three utility modules in isolation.
 *
 * The unit tests beside each module prove the modules behave. They do not prove
 * the wiring, and the wiring is the whole claim: security headers are applied
 * at a single choke point that wraps `baseWorkerHandlers.fetch`, so *every*
 * response carries them regardless of which of the entry point's dozen return
 * statements produced it. A new `return` added above that choke point tomorrow
 * would not bypass it — but only a test that goes through `worker.fetch` can
 * say so.
 *
 * Each case below therefore picks a response produced by a DIFFERENT branch of
 * the entry point: the root metadata route, the health route, a 404, a rejected
 * API request, and a preflight.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
  createClerkClient: vi.fn(() => ({ users: { getUser: vi.fn() } })),
}));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => vi.fn()),
}));

import { default as worker } from './index-minimal';
import type { Env } from './types/env';

const ctx = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as ExecutionContext;

const testEnv = () =>
  ({
    ...env,
    NODE_ENV: 'production',
    JWT_SECRET: 'test-secret',
    NEON_CONNECTION_STRING: 'postgresql://user:pw@example.com/app',
  }) as unknown as Env;

const fetchWorker = (request: Request, overrides: Partial<Env> = {}) =>
  worker.fetch(request, { ...testEnv(), ...overrides } as Env, ctx);

describe('security headers reach every branch of the entry point', () => {
  const expectHardened = (response: Response) => {
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Strict-Transport-Security')).toBe(
      'max-age=31536000; includeSubDomains; preload',
    );
  };

  it('the root metadata response', async () => {
    expectHardened(await fetchWorker(new Request('https://api.example.com/')));
  });

  it('the health response', async () => {
    expectHardened(await fetchWorker(new Request('https://api.example.com/health')));
  });

  it('an unmatched path (404)', async () => {
    expectHardened(await fetchWorker(new Request('https://api.example.com/nope')));
  });

  it('an unauthenticated API rejection', async () => {
    const response = await fetchWorker(new Request('https://api.example.com/api/products'));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expectHardened(response);
  });

  it('a CORS preflight', async () => {
    const response = await fetchWorker(
      new Request('https://api.example.com/api/products', {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.example.com' },
      }),
    );

    expectHardened(response);
    // The CORS headers the preflight exists for are still intact.
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('omits HSTS on a plain-http origin while keeping the rest', async () => {
    const response = await fetchWorker(new Request('http://localhost:8787/'));

    expect(response.headers.get('Strict-Transport-Security')).toBeNull();
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('JSON body cap, through the entry point', () => {
  const bigJsonRequest = (path: string) =>
    new Request(`https://api.example.com${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(5 * 1024 * 1024) },
      body: JSON.stringify({ padded: 'x' }),
    });

  it('refuses an oversized JSON body with 413', async () => {
    const response = await fetchWorker(bigJsonRequest('/api/products'));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('maximum size'),
    });
  });

  it('does NOT refuse an oversized body on an upload route', async () => {
    // The regression this pins: uploads are served at BOTH `/upload/...` and
    // `/api/upload/...`, and a cap placed before the upload router (or one that
    // restated its path logic) would 413 a legitimate 25 MB upload. The cap
    // runs only after the upload router has declined the request, so neither
    // prefix can reach it.
    for (const path of ['/api/upload/initiate', '/upload/initiate']) {
      const response = await fetchWorker(bigJsonRequest(path));
      expect(response.status).not.toBe(413);
    }
  });

  it('does not refuse a webhook delivery', async () => {
    // Refusing a Stripe or Clerk delivery unread turns a provider retry loop
    // into a silent data gap. Webhooks dispatch above the API branch entirely.
    const response = await fetchWorker(bigJsonRequest('/api/webhooks/stripe'));

    expect(response.status).not.toBe(413);
  });

  it('allows an ordinary small body through to normal handling', async () => {
    const response = await fetchWorker(
      new Request('https://api.example.com/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': '32' },
        body: JSON.stringify({ barcode: '12345678', name: 'x' }),
      }),
    );

    // Unauthenticated, so it is refused -- but for auth reasons, not size.
    expect(response.status).not.toBe(413);
  });
});

describe('configuration validation, through /health', () => {
  it('reports pass for a configured environment', async () => {
    const response = await fetchWorker(new Request('https://api.example.com/health'));
    const body = (await response.json()) as any;

    expect(body.checks.config.status).toBe('pass');
    expect(response.status).toBe(200);
  });

  it('reports the missing capability and returns 503 when the database is unreachable by any route', async () => {
    const response = await fetchWorker(new Request('https://api.example.com/health'), {
      NEON_CONNECTION_STRING: '',
      DATABASE_URL: '',
      HYPERDRIVE: undefined,
    } as unknown as Partial<Env>);
    const body = (await response.json()) as any;

    expect(body.checks.config.status).toBe('fail');
    expect(body.status).toBe('unhealthy');
    expect(response.status).toBe(503);
  });

  it('stays healthy when only a feature key is absent', async () => {
    // A deployment without Resend is a valid deployment with email off.
    const response = await fetchWorker(new Request('https://api.example.com/health'), {
      RESEND_API_KEY: undefined,
    } as unknown as Partial<Env>);
    const body = (await response.json()) as any;

    expect(body.checks.config.status).toBe('pass');
    expect(body.checks.config.missingFeatures).toContain('RESEND_API_KEY');
    expect(body.status).not.toBe('unhealthy');
  });

  it('does not let an unrelated degradation mask a required-config failure', async () => {
    // `degrade()` only ever worsens the status. Before it existed, the R2 and
    // database branches assigned 'degraded' unconditionally, so an unrelated
    // failure would DOWNGRADE a config 'unhealthy' to 'degraded' -- and since
    // /health maps 'degraded' to HTTP 200, a broken deploy would have sailed
    // through the gate.
    //
    // **Getting this test able to fail took a second attempt.** The obvious
    // setup -- empty connection string, deep check -- is vacuous: the database
    // branch is guarded by `includeConnectivity && connectionString`, so with
    // no connection string it never runs, `degrade()` is never called, and the
    // assertion passes whether or not the guard exists. The status has to be
    // *contested*: a required key missing (config says unhealthy) AND a deep
    // check that genuinely fails (degrade fires). So JWT_SECRET is absent while
    // a connection string is present, and the mocked driver returns no rows.
    const response = await fetchWorker(new Request('https://api.example.com/health?deep=true'), {
      JWT_SECRET: '',
      NEON_CONNECTION_STRING: 'postgresql://user:pw@example.com/app',
    } as unknown as Partial<Env>);
    const body = (await response.json()) as any;

    // Both halves: the degrade really did fire, and it did not win.
    expect(body.checks.database?.status).toBe('fail');
    expect(body.checks.config.status).toBe('fail');
    expect(body.status).toBe('unhealthy');
    expect(response.status).toBe(503);
  });
});
