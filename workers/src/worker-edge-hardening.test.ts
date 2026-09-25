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

/**
 * Every request gets a unique client IP.
 *
 * The Worker's rate limiter keys on `CF-Connecting-IP` and keeps its counters
 * in a module-level store that persists for the whole test file, so without
 * this the tests share one bucket: adding a few cases to one `it` starts
 * returning 429 from unrelated `it`s further down, and the failure looks like a
 * bug in whatever was added last. Distinct IPs make each request independent of
 * how many ran before it.
 */
let clientIpCounter = 0;
const withUniqueClientIp = (request: Request): Request => {
  clientIpCounter += 1;
  const headers = new Headers(request.headers);
  headers.set('CF-Connecting-IP', `203.0.113.${clientIpCounter % 254}`);
  headers.set('X-Test-Seq', String(clientIpCounter));
  return new Request(request, { headers });
};

const fetchWorker = (request: Request, overrides: Partial<Env> = {}) =>
  worker.fetch(withUniqueClientIp(request), { ...testEnv(), ...overrides } as Env, ctx);

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

  it('refuses an oversized JSON body on the upload initiate/complete routes', async () => {
    // These take a small JSON body (filename/fileSize/contentType; an upload
    // id) and buffer it with `request.json()`, but they dispatch from the
    // upload router which runs above the entry-point cap -- so they were
    // entirely uncapped. `handleUploadInitiate`'s `fileSize` check validates a
    // declared field, not the body, so it was never a body-size control.
    // Found in review of PR #531, where a comment had wrongly implied uploads
    // were covered by their tier-aware cap.
    for (const path of [
      '/api/upload/initiate',
      '/upload/initiate',
      '/api/upload/complete',
      '/upload/complete',
    ]) {
      const response = await fetchWorker(bigJsonRequest(path));
      expect(response.status, path).toBe(413);
    }
  });

  it('does NOT refuse an oversized body on a file-carrying upload route', async () => {
    // The regression this pins: a 1 MiB JSON cap must never reach the routes
    // whose entire purpose is carrying a file. Those keep their own tier-aware
    // cap (STANDARD_MAX_FILE_SIZE / getTierFileSizeLimit), which is larger and
    // correct. Both prefixes, because uploads serve at `/upload/...` and
    // `/api/upload/...` alike and an earlier draft of the cap knew only one.
    const fileCarrying = [
      { path: '/api/upload/direct/some-key', method: 'POST' },
      { path: '/upload/direct/some-key', method: 'POST' },
      { path: '/api/upload/presigned/some-key', method: 'PUT' },
      { path: '/upload/presigned/some-key', method: 'PUT' },
    ];

    for (const { path, method } of fileCarrying) {
      const response = await fetchWorker(
        new Request(`https://api.example.com${path}`, {
          method,
          headers: { 'Content-Length': String(5 * 1024 * 1024) },
          body: 'x',
        }),
      );
      expect(response.status, path).not.toBe(413);
    }
  });

  it('refuses an oversized body on the bootstrap route, which dispatches above the cap', async () => {
    // `resolveBootstrapApiRoute` runs before the entry-point cap (bootstrap
    // must precede the legacy JWT_SECRET check), and the handler buffers with
    // `request.text()`. Without its own call to `enforceJsonBodyLimit` this is
    // the one authenticated route that buffers an unbounded body. Found in
    // review of PR #531.
    const response = await fetchWorker(bigJsonRequest('/api/organization/bootstrap'));

    expect(response.status).toBe(413);
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

  it('runs the deep database check for a Hyperdrive-only deployment', async () => {
    // The config check declares Hyperdrive a valid database source, so
    // `/health?deep=true` must actually probe it. It did not: the deep check
    // resolved `NEON_CONNECTION_STRING || DATABASE_URL` only, so a
    // Hyperdrive-only deployment skipped `checks.database` entirely and
    // reported `healthy` without ever touching the database. Both paths now go
    // through `getConnectionString`. Found in review of PR #531.
    const response = await fetchWorker(new Request('https://api.example.com/health?deep=true'), {
      NEON_CONNECTION_STRING: '',
      DATABASE_URL: '',
      HYPERDRIVE: { connectionString: 'postgresql://user:pw@hyperdrive.example.com/app' },
    } as unknown as Partial<Env>);
    const body = (await response.json()) as any;

    // Config is satisfied by Hyperdrive...
    expect(body.checks.config.status).toBe('pass');
    // ...and the deep check actually ran rather than being silently skipped.
    expect(body.checks.database).toBeDefined();
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
