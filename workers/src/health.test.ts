import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, vi } from 'vitest';
import { verifyToken } from '@clerk/backend';
import { neon } from '@neondatabase/serverless';
import { healthCheck } from './health';
import {
  default as worker,
  handleLogin,
  handleOrganizationBootstrap,
  handleRegister,
  handleUploadComplete,
  handleUploadDirect,
  handleCatalogueImportQueue,
  handleUploadInitiate,
  handleUploadStatus,
  maybeCompressJsonResponse,
  isCatalogueWithinLimit,
  takeImportBatch,
  type ValidatedCatalogueRow,
} from './index-minimal';
import { createWorkersDatabase } from './database';
import type { Database } from './database';
import type { Env } from './types/env';

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
  createClerkClient: vi.fn(() => ({
    users: {
      getUser: vi.fn(),
    },
  })),
}));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => vi.fn()),
}));

/**
 * Stub the tagged-template function `neon()` returns.
 *
 * `NeonQueryFunction` is callable but also carries `query`, `unsafe` and
 * `transaction`. The readiness check in `health.ts` only ever invokes the tag
 * itself, so the stub implements just that and asserts the fuller shape — the
 * alternative is stubbing three methods no code under test can reach.
 */
function stubNeonQuery(implementation: (...args: unknown[]) => unknown): ReturnType<typeof neon> {
  return vi.fn(implementation) as unknown as ReturnType<typeof neon>;
}

describe('Health Check API', () => {
  it('should return API metadata for root path', async () => {
    const response = await SELF.fetch('https://example.com/');
    expect(response.status).toBe(200);

    const data = (await response.json()) as any;
    expect(data.service).toBe('ExpiryMate API');
    expect(data.health).toBe('/health');
    expect(data.docs).toBe('/api');
  });

  it('should return 200 OK for /health', async () => {
    const response = await SELF.fetch('https://example.com/health');
    expect(response.status).toBe(200);

    const data = (await response.json()) as any;
    expect(data.status).toBe('healthy');
    expect(data.checks.workers.status).toBe('pass');
  });

  it('should return 200 OK for /api/health', async () => {
    const response = await SELF.fetch('https://example.com/api/health');
    expect(response.status).toBe(200);

    const data = (await response.json()) as any;
    expect(data.status).toBe('healthy');
  });

  it('serves manually gzipped JSON responses that decode correctly', async () => {
    const payload = JSON.stringify({
      status: 'healthy',
      items: Array.from({ length: 600 }, (_, idx) => `item-${idx}`),
    });

    const request = new Request('https://example.com/api/health', {
      method: 'GET',
      headers: {
        'Accept-Encoding': 'gzip',
      },
    });

    const baseResponse = new Response(payload, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const response = await maybeCompressJsonResponse(request, baseResponse);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Encoding')).toBe('gzip');

    const compressedBuffer = await response.arrayBuffer();
    const compressedStream = new Blob([compressedBuffer]).stream();
    const decompressedStream = compressedStream.pipeThrough(new DecompressionStream('gzip'));
    const decompressedText = await new Response(decompressedStream).text();
    const data = JSON.parse(decompressedText) as any;

    expect(data.status).toBe('healthy');
    expect(Array.isArray(data.items)).toBe(true);
    expect(data.items.length).toBe(600);
  });
});

describe('healthCheck', () => {
  const createEnv = (overrides: Partial<Env> = {}): Env => ({
    NODE_ENV: 'development',
    STORAGE_PROVIDER: 'r2',
    MAX_FILE_SIZE: '10485760',
    CSV_BATCH_SIZE: '100',
    RATE_LIMIT_WINDOW: '60000',
    RATE_LIMIT_MAX_REQUESTS: '100',
    RATE_LIMIT_MAX_AUTHENTICATED: '1000',
    NEON_CONNECTION_STRING: 'postgres://example',
    JWT_SECRET: 'test-secret',
    CLERK_WEBHOOK_SECRET: 'whsec_test',
    R2_ACCOUNT_ID: 'test',
    R2_ACCESS_KEY_ID: 'test',
    R2_SECRET_ACCESS_KEY: 'test',
    R2_BUCKET_NAME: 'test',
    CSV_UPLOADS: {
      list: vi.fn().mockResolvedValue({ objects: [] }),
    } as unknown as R2Bucket,
    HYPERDRIVE: {
      connectionString: 'postgres://example',
    } as unknown as Hyperdrive,
    ...overrides,
  });

  it('returns healthy without connectivity checks', async () => {
    const result = await healthCheck(createEnv(), false);
    expect(result.status).toBe('healthy');
    expect(result.checks.workers.status).toBe('pass');
    expect(result.checks.r2).toBeUndefined();
    expect(result.checks.database).toBeUndefined();
  });

  it('marks degraded when R2 check fails', async () => {
    const failingEnv = createEnv({
      CSV_UPLOADS: {
        list: vi.fn().mockRejectedValue(new Error('R2 down')),
      } as unknown as R2Bucket,
    });

    const result = await healthCheck(failingEnv, true);
    expect(result.status).toBe('degraded');
    expect(result.checks.r2?.status).toBe('fail');
    expect(result.checks.r2?.error).toBe('R2 down');
  });

  it('passes the database check when the readiness query returns a row', async () => {
    const sqlMock = stubNeonQuery(() => Promise.resolve([{ '?column?': 1 }]));
    vi.mocked(neon).mockReturnValueOnce(sqlMock);

    const result = await healthCheck(createEnv(), true);
    expect(result.status).toBe('healthy');
    expect(result.checks.database?.status).toBe('pass');
    expect(result.checks.database?.responseTime).toBeGreaterThanOrEqual(0);
  });

  it('marks degraded when the database query throws', async () => {
    const sqlMock = stubNeonQuery(() => Promise.reject(new Error('connection refused')));
    vi.mocked(neon).mockReturnValueOnce(sqlMock);

    const result = await healthCheck(createEnv(), true);
    expect(result.status).toBe('degraded');
    expect(result.checks.database?.status).toBe('fail');
    expect(result.checks.database?.error).toBe('connection refused');
  });

  it('fails by timeout when the database query never resolves', async () => {
    const sqlMock = stubNeonQuery(() => new Promise(() => {}));
    vi.mocked(neon).mockReturnValueOnce(sqlMock);

    const result = await healthCheck(createEnv(), true);
    expect(result.status).toBe('degraded');
    expect(result.checks.database?.status).toBe('fail');
    expect(result.checks.database?.error).toContain('timed out');
  });

  it('redacts credentials from a database error containing a connection URL', async () => {
    const sqlMock = stubNeonQuery(() =>
      Promise.reject(
        new Error('connect failed: postgres://user:supersecret@db.example.com/app?sslmode=require'),
      ),
    );
    vi.mocked(neon).mockReturnValueOnce(sqlMock);

    const result = await healthCheck(createEnv(), true);
    expect(result.status).toBe('degraded');
    expect(result.checks.database?.status).toBe('fail');
    expect(result.checks.database?.error).not.toContain('supersecret');
    expect(result.checks.database?.error).toContain('[redacted]');
  });

  it('omits the database check when no connection string is configured', async () => {
    const result = await healthCheck(
      createEnv({ NEON_CONNECTION_STRING: '', DATABASE_URL: undefined }),
      true,
    );
    expect(result.checks.database).toBeUndefined();
  });
});

describe('API config guard', () => {
  it('returns 500 when database config is missing for /api/products', async () => {
    const response = await SELF.fetch('https://example.com/api/products');
    expect(response.status).toBe(500);
    const body = (await response.json()) as any;
    expect(body.error).toBeTruthy();
  });

  it('routes /api/organization/bootstrap instead of returning 404', async () => {
    // Given: A bootstrap request hitting the deployed minimal Worker entrypoint
    const response = await SELF.fetch('https://example.com/api/organization/bootstrap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    // When: The Worker processes the bootstrap route
    const body = (await response.json()) as any;

    // Then: The route exists, even if auth/config validation still fails
    expect(response.status).not.toBe(404);
    expect(body.error || body.message).toBeTruthy();
  });

  it('dispatches organization bootstrap before requiring the legacy JWT secret', async () => {
    const productionLikeEnv = {
      ...env,
      NODE_ENV: 'production',
      JWT_SECRET: '',
      NEON_CONNECTION_STRING:
        'postgresql://user:password@direct-neon.example.com/app?sslmode=require',
      HYPERDRIVE: {
        connectionString: 'postgresql://user:password@hyperdrive.example.com/app?sslmode=require',
      } as unknown as Hyperdrive,
    } as Env;
    const ctx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;

    const response = await worker.fetch(
      new Request('https://example.com/api/organization/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      productionLikeEnv,
      ctx,
    );

    const body = (await response.json()) as any;
    expect(response.status).toBe(401);
    expect(body.error || body.message).not.toBe('JWT_SECRET is required');
  });

  it('dispatches organization bootstrap before initializing generic API database setup', async () => {
    const productionLikeEnv = {
      ...env,
      NODE_ENV: 'production',
      JWT_SECRET: 'legacy-jwt-secret',
      NEON_CONNECTION_STRING: '',
      DATABASE_URL: '',
      HYPERDRIVE: undefined,
    } as unknown as Env;
    const ctx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;

    const response = await worker.fetch(
      new Request('https://example.com/api/organization/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      productionLikeEnv,
      ctx,
    );

    const body = (await response.json()) as any;
    expect(response.status).toBe(401);
    expect(body.error || body.message).not.toContain('database connection string');
  });

  it('returns 500 when database config is missing for /api/users/me', async () => {
    const response = await SELF.fetch('https://example.com/api/users/me');
    expect(response.status).toBe(500);
    const body = (await response.json()) as any;
    expect(body.error).toBeTruthy();
  });

  it('returns 500 when database config is missing for /api/dashboard', async () => {
    const response = await SELF.fetch('https://example.com/api/dashboard');
    expect(response.status).toBe(500);
    const body = (await response.json()) as any;
    expect(body.error).toBeTruthy();
  });

  it('routes /upload/initiate and returns an auth/config error when unauthenticated', async () => {
    const response = await SELF.fetch('https://example.com/upload/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'test.csv', fileSize: 128, contentType: 'text/csv' }),
    });

    expect(response.status).not.toBe(404);
    expect([401, 429, 500]).toContain(response.status);
    const body = (await response.json()) as any;
    expect(body.error).toBeTruthy();
  });

  it('routes /api/upload/initiate and returns an auth/config error when unauthenticated', async () => {
    const response = await SELF.fetch('https://example.com/api/upload/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'test.csv', fileSize: 128, contentType: 'text/csv' }),
    });

    expect(response.status).not.toBe(404);
    expect([401, 429, 500]).toContain(response.status);
    const body = (await response.json()) as any;
    expect(body.error).toBeTruthy();
  });

  it('routes /api/upload/status/:key and returns an auth/config error when unauthenticated', async () => {
    const key = encodeURIComponent('uploads/user-1/123456-test.csv');

    const response = await SELF.fetch(`https://example.com/api/upload/status/${key}`, {
      method: 'GET',
    });

    expect(response.status).not.toBe(404);
    expect([401, 429, 500]).toContain(response.status);
    const body = (await response.json()) as any;
    expect(body.error).toBeTruthy();
  });

  it.each([
    ['direct', 'POST', '/api/upload/direct/uploads%2Fuser-7%2Fproducts.csv'],
    ['presigned', 'PUT', '/api/upload/presigned/uploads%2Fuser-7%2Fproducts.csv'],
    ['complete', 'POST', '/api/upload/complete'],
    ['error report', 'GET', '/api/upload/error-report/uploads%2Fuser-7%2Fproducts.csv'],
  ])('routes the %s upload endpoint', async (_name, method, pathname) => {
    const response = await SELF.fetch(`https://example.com${pathname}`, { method });

    expect(response.status).not.toBe(404);
  });

  it('routes /api/webhooks/clerk and rejects requests without Svix headers', async () => {
    const response = await SELF.fetch('https://example.com/api/webhooks/clerk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '198.51.100.45',
      },
      body: JSON.stringify({ type: 'user.created', data: {} }),
    });

    expect(response.status).toBe(400);

    const body = (await response.json()) as any;
    expect(body.error).toContain('Svix');
  });

  it('does not expose the synthetic test-error endpoint', async () => {
    const productionLikeEnv = {
      ...env,
      NODE_ENV: 'production',
      JWT_SECRET: 'test-secret',
      STORAGE_PROVIDER: 'r2',
      MAX_FILE_SIZE: '10485760',
      CSV_BATCH_SIZE: '100',
      RATE_LIMIT_WINDOW: '60000',
      RATE_LIMIT_MAX_REQUESTS: '100',
      RATE_LIMIT_MAX_AUTHENTICATED: '1000',
      NEON_CONNECTION_STRING: 'postgresql://user:password@db.example.com/app?sslmode=require',
      R2_ACCOUNT_ID: 'test',
      R2_ACCESS_KEY_ID: 'test',
      R2_SECRET_ACCESS_KEY: 'test',
      R2_BUCKET_NAME: 'test',
      CSV_UPLOADS: {
        list: vi.fn().mockResolvedValue({ objects: [] }),
      } as unknown as R2Bucket,
      HYPERDRIVE: {
        connectionString: 'postgresql://user:password@db.example.com/app?sslmode=require',
      } as unknown as Hyperdrive,
    } as Env;

    const ctx = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as unknown as ExecutionContext;

    const response = await worker.fetch(
      new Request('https://example.com/api/test-error'),
      productionLikeEnv,
      ctx,
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as any;
    expect(body.error || body.message).toBe('Not Found');
    expect(JSON.stringify(body)).not.toContain('Test error from Cloudflare Workers');
  });
});

describe('Upload strategy parity', () => {
  // `verifyToken` resolves to Clerk's full `JwtPayload`. Tests only assert on the
  // handful of claims the Worker reads, so type the mock against a loose claims shape
  // rather than reconstructing every required Clerk field at each call site.
  const mockedVerifyToken = vi.mocked(
    verifyToken as unknown as (...args: unknown[]) => Promise<Record<string, unknown>>,
  );

  const createUploadEnv = (overrides: Partial<Env> = {}): Env => ({
    NODE_ENV: 'development',
    STORAGE_PROVIDER: 'r2',
    MAX_FILE_SIZE: '10485760',
    CSV_BATCH_SIZE: '100',
    RATE_LIMIT_WINDOW: '60000',
    RATE_LIMIT_MAX_REQUESTS: '10',
    RATE_LIMIT_MAX_AUTHENTICATED: '100',
    NEON_CONNECTION_STRING: 'postgres://example',
    JWT_SECRET: 'upload-test-secret',
    CLERK_WEBHOOK_SECRET: 'whsec_test',
    R2_ACCOUNT_ID: 'test-account',
    R2_ACCESS_KEY_ID: 'test-key',
    R2_SECRET_ACCESS_KEY: 'test-secret',
    R2_BUCKET_NAME: 'test-bucket',
    CSV_UPLOADS: {
      head: vi.fn().mockResolvedValue({ key: 'uploads/user-7/1-big.csv' }),
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as R2Bucket,
    CATALOGUE_IMPORT_QUEUE: {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as Queue,
    CATALOGUE_QUEUE_ENABLED: 'false',
    HYPERDRIVE: {
      connectionString: 'postgres://example',
    } as unknown as Hyperdrive,
    ...overrides,
  });

  const createUploadDb = (userId = 7): Database =>
    ({
      sql: vi.fn().mockResolvedValue([
        {
          id: userId,
          organizationId: 'org_test',
          role: 'admin',
        },
      ]),
    }) as unknown as Database;

  const createProductImportDb = (userId = 7): Database =>
    ({
      sql: vi.fn((strings: TemplateStringsArray) => {
        const query = strings.join('');
        if (query.includes('FROM users')) {
          return Promise.resolve([
            {
              id: userId,
              organizationId: 'org_test',
              role: 'admin',
            },
          ]);
        }

        return Promise.resolve([{ inserted: true }]);
      }),
      findProductBySku: vi.fn().mockResolvedValue(null),
      findProductByBarcode: vi.fn().mockResolvedValue(null),
      createProduct: vi.fn().mockResolvedValue({
        id: 101,
        sku: 'SKU-1',
        barcode: 'BAR-1',
        name: 'Milk',
        costPrice: 12.99,
        notes: '',
      }),
    }) as unknown as Database;

  it('returns direct strategy for Clerk-authenticated upload initiation', async () => {
    mockedVerifyToken.mockResolvedValueOnce({
      sub: 'user_clerk_7',
      email: 'uploader@example.com',
      org_id: 'org_test',
      org_role: 'org:admin',
    });
    const envForUpload = createUploadEnv({ CLERK_SECRET_KEY: 'test-clerk-secret' });
    const db = createUploadDb(7);

    const request = new Request('https://example.com/api/upload/initiate', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer clerk-session-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: 'test.csv',
        fileSize: 1024,
        contentType: 'text/csv',
      }),
    });

    const response = await handleUploadInitiate(request, envForUpload, '/api/upload', db);
    expect(response.status).toBe(200);

    const body = (await response.json()) as any;
    expect(body.strategy).toBe('direct');
    expect(body.method).toBe('POST');
    expect(body.key).toContain('uploads/user-7/');
  });

  it('returns presigned strategy for files larger than 2MB', async () => {
    mockedVerifyToken.mockResolvedValueOnce({
      sub: 'user_clerk_7',
      email: 'uploader@example.com',
      org_id: 'org_test',
      org_role: 'org:admin',
    });
    const envForUpload = createUploadEnv({ CLERK_SECRET_KEY: 'test-clerk-secret' });
    const db = createUploadDb(7);

    const request = new Request('https://example.com/api/upload/initiate', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer clerk-session-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: 'big.csv',
        fileSize: 3 * 1024 * 1024,
        contentType: 'text/csv',
      }),
    });

    const response = await handleUploadInitiate(request, envForUpload, '/api/upload', db);
    expect(response.status).toBe(200);

    const body = (await response.json()) as any;
    expect(body.strategy).toBe('presigned');
    expect(body.method).toBe('PUT');
    expect(body.uploadUrl).toContain('/api/upload/presigned/');
    expect(body.uploadUrl).toContain('token=');
  });

  it('returns complete upload status when object exists', async () => {
    mockedVerifyToken.mockResolvedValueOnce({
      sub: 'user_clerk_7',
      email: 'uploader@example.com',
      org_id: 'org_test',
      org_role: 'org:admin',
    });
    const envForUpload = createUploadEnv({ CLERK_SECRET_KEY: 'test-clerk-secret' });
    const db = createUploadDb(7);
    const key = 'uploads/user-7/1-big.csv';

    const request = new Request(
      `https://example.com/api/upload/status/${encodeURIComponent(key)}`,
      {
        method: 'GET',
        headers: {
          Authorization: 'Bearer clerk-session-token',
        },
      },
    );

    const response = await handleUploadStatus(request, envForUpload, key, db);
    expect(response.status).toBe(200);

    const body = (await response.json()) as any;
    expect(body.status).toBe('complete');
    expect(body.progress).toBe(100);
  });

  it('reports real product import counts after a direct CSV upload', async () => {
    mockedVerifyToken.mockResolvedValue({
      sub: 'user_clerk_7',
      email: 'uploader@example.com',
      org_id: 'org_test',
      org_role: 'org:admin',
    });

    const storedObjects = new Map<
      string,
      { data: ArrayBuffer; customMetadata?: Record<string, string> }
    >();
    const envForUpload = createUploadEnv({
      CLERK_SECRET_KEY: 'test-clerk-secret',
      CSV_UPLOADS: {
        put: vi.fn(
          async (
            key: string,
            data: ArrayBuffer,
            options?: { customMetadata?: Record<string, string> },
          ) => {
            storedObjects.set(key, {
              data,
              customMetadata: options?.customMetadata,
            });
          },
        ),
        head: vi.fn(async (key: string) => {
          const stored = storedObjects.get(key);
          return stored
            ? {
                key,
                customMetadata: stored.customMetadata,
              }
            : null;
        }),
      } as unknown as R2Bucket,
    });
    const db = createProductImportDb(7);
    const key = 'uploads/user-7/1-products.csv';
    const formData = new FormData();
    formData.append(
      'file',
      new File(['SKU,Name,Barcode,Cost\nSKU-1,Milk,BAR-1,12.99\n'], 'products.csv', {
        type: 'text/csv',
      }),
    );

    const directResponse = await handleUploadDirect(
      new Request(`https://example.com/api/upload/direct/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer clerk-session-token',
        },
        body: formData,
      }),
      envForUpload,
      key,
      db,
    );

    expect(directResponse.status).toBe(200);
    const directBody = (await directResponse.json()) as any;
    expect(directBody.importedCount).toBe(1);

    const statusResponse = await handleUploadStatus(
      new Request(`https://example.com/api/upload/status/${encodeURIComponent(key)}`, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer clerk-session-token',
        },
      }),
      envForUpload,
      key,
      db,
    );
    expect(statusResponse.status).toBe(200);

    const statusBody = (await statusResponse.json()) as any;
    expect(statusBody.status).toBe('complete');
    expect(statusBody.importedCount).toBe(1);
    expect(statusBody.updatedCount).toBe(0);
    expect(statusBody.skippedCount).toBe(0);
    expect(statusBody.rowsProcessed).toBe(1);
    expect(statusBody.rowsTotal).toBe(1);
  });

  it.each([49, 50, 51])(
    'queues a %i-row catalogue without row-by-row database subrequests',
    async (rowCount) => {
      mockedVerifyToken.mockResolvedValue({
        sub: 'user_clerk_7',
        email: 'uploader@example.com',
        org_id: 'org_test',
        org_role: 'org:admin',
      });

      const queue = { send: vi.fn().mockResolvedValue(undefined) } as unknown as Queue;
      const envForUpload = createUploadEnv({
        CLERK_SECRET_KEY: 'test-clerk-secret',
        CATALOGUE_QUEUE_ENABLED: 'true',
        CATALOGUE_IMPORT_QUEUE: queue,
      });
      const db = createProductImportDb(7);
      vi.mocked(db.sql).mockImplementation((strings: TemplateStringsArray) => {
        const query = strings.join('');
        if (query.includes('FROM users')) {
          return Promise.resolve([{ id: 7, organizationId: 'org_test', role: 'admin' }]) as never;
        }
        if (query.includes('FROM subscription_tiers')) {
          return Promise.resolve([{ tier_level: 'professional' }]) as never;
        }
        if (query.includes('INSERT INTO uploads')) {
          return Promise.resolve([{ id: 42 }]) as never;
        }
        return Promise.resolve([]) as never;
      });

      const rows = Array.from(
        { length: rowCount },
        (_, index) => `SKU-${index},Product ${index},BAR-${index},12.99`,
      );
      const formData = new FormData();
      formData.append(
        'file',
        new File([`SKU,Name,Barcode,Cost\n${rows.join('\n')}\n`], 'products.csv', {
          type: 'text/csv',
        }),
      );

      const response = await handleUploadDirect(
        new Request('https://example.com/api/upload/direct/uploads%2Fuser-7%2Fproducts.csv', {
          method: 'POST',
          headers: { Authorization: 'Bearer clerk-session-token' },
          body: formData,
        }),
        envForUpload,
        'uploads/user-7/products.csv',
        db,
      );

      expect(response.status).toBe(202);
      expect(queue.send).toHaveBeenCalledWith({ uploadId: 42 });
      const productQueries = vi
        .mocked(db.sql)
        .mock.calls.filter(([strings]) => strings.join('').includes('UPDATE products'));
      expect(productQueries).toHaveLength(0);
    },
  );

  it('fails and unlocks a direct catalogue upload when queue enqueueing fails', async () => {
    mockedVerifyToken.mockResolvedValue({
      sub: 'user_clerk_7',
      email: 'uploader@example.com',
      org_id: 'org_test',
      org_role: 'org:admin',
    });
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const envForUpload = createUploadEnv({
      CLERK_SECRET_KEY: 'test-clerk-secret',
      CATALOGUE_QUEUE_ENABLED: 'true',
      CATALOGUE_IMPORT_QUEUE: {
        send: vi.fn().mockRejectedValue(new Error('queue unavailable')),
      } as unknown as Queue,
      CSV_UPLOADS: {
        put: vi.fn().mockResolvedValue(undefined),
        delete: deleteObject,
      } as unknown as R2Bucket,
    });
    const db = createProductImportDb(7);
    vi.mocked(db.sql).mockImplementation((strings: TemplateStringsArray) => {
      const query = strings.join('');
      if (query.includes('FROM users')) {
        return Promise.resolve([{ id: 7, organizationId: 'org_test', role: 'admin' }]) as never;
      }
      if (query.includes('FROM subscription_tiers')) {
        return Promise.resolve([{ tier_level: 'professional' }]) as never;
      }
      if (query.includes('INSERT INTO uploads')) {
        return Promise.resolve([{ id: 42 }]) as never;
      }
      return Promise.resolve([]) as never;
    });
    const key = 'uploads/user-7/products.csv';
    const formData = new FormData();
    formData.append(
      'file',
      new File(['SKU,Name,Barcode,Cost\nS1,One,B1,1.00\n'], 'products.csv', {
        type: 'text/csv',
      }),
    );

    const response = await handleUploadDirect(
      new Request(`https://example.com/api/upload/direct/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer clerk-session-token' },
        body: formData,
      }),
      envForUpload,
      key,
      db,
    );

    expect(response.status).toBe(503);
    expect(deleteObject).toHaveBeenCalledWith(key);
    expect(
      vi
        .mocked(db.sql)
        .mock.calls.some(([strings]) =>
          strings.join('').includes("UPDATE uploads SET status = 'failed'"),
        ),
    ).toBe(true);
  });

  it('fails and unlocks a completed presigned upload when queue enqueueing fails', async () => {
    mockedVerifyToken.mockResolvedValue({
      sub: 'user_clerk_7',
      email: 'uploader@example.com',
      org_id: 'org_test',
      org_role: 'org:admin',
    });
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const key = 'uploads/user-7/products.csv';
    const envForUpload = createUploadEnv({
      CLERK_SECRET_KEY: 'test-clerk-secret',
      CATALOGUE_QUEUE_ENABLED: 'true',
      CATALOGUE_IMPORT_QUEUE: {
        send: vi.fn().mockRejectedValue(new Error('queue unavailable')),
      } as unknown as Queue,
      CSV_UPLOADS: {
        head: vi.fn().mockResolvedValue({
          key,
          size: 100,
          httpMetadata: { contentType: 'text/csv' },
        }),
        delete: deleteObject,
      } as unknown as R2Bucket,
    });
    const db = createProductImportDb(7);
    vi.mocked(db.sql).mockImplementation((strings: TemplateStringsArray) => {
      const query = strings.join('');
      if (query.includes('FROM users')) {
        return Promise.resolve([{ id: 7, organizationId: 'org_test', role: 'admin' }]) as never;
      }
      if (query.includes('FROM subscription_tiers')) {
        return Promise.resolve([{ tier_level: 'professional' }]) as never;
      }
      if (query.includes('INSERT INTO uploads')) {
        return Promise.resolve([{ id: 43 }]) as never;
      }
      return Promise.resolve([]) as never;
    });

    const response = await handleUploadComplete(
      new Request('https://example.com/api/upload/complete', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer clerk-session-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key }),
      }),
      envForUpload,
      db,
    );

    expect(response.status).toBe(503);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(db.sql)
        .mock.calls.some(([strings]) =>
          strings.join('').includes("UPDATE uploads SET status = 'failed'"),
        ),
    ).toBe(true);
  });

  it('acknowledges duplicate delivery for an already completed catalogue job', async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    const db = {
      sql: vi.fn().mockResolvedValue([
        {
          id: 42,
          organizationId: 'org_test',
          fileKey: 'uploads/user-7/products.csv',
          status: 'completed',
          processingOffset: 51,
          maxSkusSnapshot: 50000,
        },
      ]),
    } as unknown as Database;
    const envForUpload = createUploadEnv({
      CSV_UPLOADS: { get: vi.fn() } as unknown as R2Bucket,
    });

    await handleCatalogueImportQueue(
      {
        queue: 'catalogue-imports-dev',
        messages: [{ body: { uploadId: 42 }, ack, retry }],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      } as unknown as MessageBatch<unknown>,
      envForUpload,
      db,
    );

    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(envForUpload.CSV_UPLOADS.get).not.toHaveBeenCalled();
  });

  it('acknowledges malformed queue messages without retrying', async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    const db = { sql: vi.fn() } as unknown as Database;
    await handleCatalogueImportQueue(
      {
        queue: 'catalogue-imports-dev',
        messages: [{ body: { uploadId: 'invalid' }, ack, retry }],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      } as unknown as MessageBatch<unknown>,
      createUploadEnv(),
      db,
    );
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(db.sql).not.toHaveBeenCalled();
  });

  it('marks the job failed and acks once the final retry attempt errors (releases lock)', async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    const queries: string[] = [];
    const db = {
      sql: vi.fn((strings: TemplateStringsArray) => {
        const query = strings.join('');
        queries.push(query);
        // The failCatalogueImport UPDATE succeeds; everything else (job load) errors,
        // simulating a job that keeps failing to process.
        if (query.includes("status = 'failed'")) return Promise.resolve([]);
        return Promise.reject(new Error('processing boom'));
      }),
    } as unknown as Database;
    const env = createUploadEnv({ CSV_UPLOADS: { get: vi.fn() } as unknown as R2Bucket });

    await handleCatalogueImportQueue(
      {
        queue: 'catalogue-imports-dev',
        messages: [{ body: { uploadId: 42 }, attempts: 5, ack, retry }],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      } as unknown as MessageBatch<unknown>,
      env,
      db,
    );

    expect(retry).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
    expect(queries.some((q) => q.includes("status = 'failed'"))).toBe(true);
  });

  it('retries (without marking failed) before the final attempt', async () => {
    const ack = vi.fn();
    const retry = vi.fn();
    const queries: string[] = [];
    const db = {
      sql: vi.fn((strings: TemplateStringsArray) => {
        const query = strings.join('');
        queries.push(query);
        if (query.includes("status = 'failed'")) return Promise.resolve([]);
        return Promise.reject(new Error('processing boom'));
      }),
    } as unknown as Database;
    const env = createUploadEnv({ CSV_UPLOADS: { get: vi.fn() } as unknown as R2Bucket });

    await handleCatalogueImportQueue(
      {
        queue: 'catalogue-imports-dev',
        messages: [{ body: { uploadId: 42 }, attempts: 1, ack, retry }],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      } as unknown as MessageBatch<unknown>,
      env,
      db,
    );

    expect(retry).toHaveBeenCalledTimes(1);
    expect(ack).not.toHaveBeenCalled();
    expect(queries.some((q) => q.includes("status = 'failed'"))).toBe(false);
  });

  it('falls back to R2 metadata status for a synchronous upload when the queue flag is on', async () => {
    mockedVerifyToken.mockResolvedValueOnce({
      sub: 'user_clerk_7',
      email: 'uploader@example.com',
      org_id: 'org_test',
      org_role: 'org:admin',
    });
    const key = 'uploads/user-7/expiry.csv';
    // Flag on, but no `uploads` row exists (synchronous expiry-list upload). The handler
    // must fall through to the R2 head/customMetadata path instead of returning 404.
    const db = {
      sql: vi.fn((strings: TemplateStringsArray) => {
        const query = strings.join('');
        if (query.includes('FROM users')) {
          return Promise.resolve([{ id: 7, organizationId: 'org_test', role: 'admin' }]);
        }
        return Promise.resolve([]); // no uploads row
      }),
    } as unknown as Database;
    const env = createUploadEnv({
      CLERK_SECRET_KEY: 'test-clerk-secret',
      CATALOGUE_QUEUE_ENABLED: 'true',
      CSV_UPLOADS: {
        head: vi.fn().mockResolvedValue({ key, customMetadata: {} }),
      } as unknown as R2Bucket,
    });

    const response = await handleUploadStatus(
      new Request(`https://example.com/api/upload/status/${encodeURIComponent(key)}`, {
        method: 'GET',
        headers: { Authorization: 'Bearer clerk-session-token' },
      }),
      env,
      key,
      db,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('complete');
  });

  it.each([500, 5000, 50000])(
    'batches a generated %i-row catalogue into at most 1,000 rows and 2 MiB',
    (rowCount) => {
      const rows: ValidatedCatalogueRow[] = Array.from({ length: rowCount }, (_, index) => ({
        rowNumber: index + 2,
        sku: `SKU-${index}`,
        name: `Product ${index}`,
        barcode: `BAR-${index}`,
        costPrice: 12.99,
        retailPrice: null,
      }));
      let offset = 0;
      while (offset < rows.length) {
        const batch = takeImportBatch(rows, offset, rows.length);
        expect(batch.length).toBeGreaterThan(0);
        expect(batch.length).toBeLessThanOrEqual(1000);
        expect(new TextEncoder().encode(JSON.stringify(batch)).byteLength).toBeLessThan(
          2 * 1024 * 1024,
        );
        offset += batch.length;
      }
      expect(offset).toBe(rowCount);
    },
  );

  it('reduces a batch when serialized rows would exceed 2 MiB', () => {
    const rows: ValidatedCatalogueRow[] = Array.from({ length: 1000 }, (_, index) => ({
      rowNumber: index + 2,
      sku: `SKU-${index}`,
      name: `Product ${index} ${'x'.repeat(3000)}`,
      barcode: `BAR-${index}`,
      costPrice: 12.99,
      retailPrice: null,
    }));
    const batch = takeImportBatch(rows, 0, rows.length);
    expect(batch.length).toBeLessThan(1000);
    expect(new TextEncoder().encode(JSON.stringify(batch)).byteLength).toBeLessThan(
      2 * 1024 * 1024,
    );
  });

  it.each([
    [49999, 50000, true],
    [50000, 50000, true],
    [50001, 50000, false],
  ])('enforces projected SKU boundary %i/%i', (projected, limit, allowed) => {
    expect(isCatalogueWithinLimit(projected, limit)).toBe(allowed);
  });

  it('accepts FRED product catalog headers after spreadsheet-to-CSV conversion', async () => {
    mockedVerifyToken.mockResolvedValue({
      sub: 'user_clerk_7',
      email: 'uploader@example.com',
      org_id: 'org_test',
      org_role: 'org:admin',
    });

    const envForUpload = createUploadEnv({ CLERK_SECRET_KEY: 'test-clerk-secret' });
    const db = createProductImportDb(7);
    const key = 'uploads/user-7/1-fred-products.csv';
    const formData = new FormData();
    formData.append(
      'file',
      new File(
        [
          'Item Code,Item Description,Cost Ex,Barcode\n' +
            '619647,A/SEARCH NEB TUBING 2M,7.53,9318766200185\n',
        ],
        'fred-products.csv',
        { type: 'text/csv' },
      ),
    );

    const response = await handleUploadDirect(
      new Request(`https://example.com/api/upload/direct/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer clerk-session-token',
        },
        body: formData,
      }),
      envForUpload,
      key,
      db,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.errors).toEqual([]);
    expect(body.importedCount).toBe(1);
    expect(body.rowsProcessed).toBe(1);
    expect(body.rowsTotal).toBe(1);
  });

  /**
   * Posts a catalogue CSV through `handleUploadDirect` as an authenticated admin
   * and returns the parsed summary.
   *
   * Extracted because three header-alias tests below repeated the same ~25 lines
   * of token mock, env, FormData and Request construction, differing only in the
   * CSV text. That duplication is what a reader has to wade through to find the
   * one line that actually varies.
   */
  const uploadCatalogueCsv = async (csv: string, slug: string) => {
    mockedVerifyToken.mockResolvedValue({
      sub: 'user_clerk_7',
      email: 'uploader@example.com',
      org_id: 'org_test',
      org_role: 'org:admin',
    });

    const envForUpload = createUploadEnv({ CLERK_SECRET_KEY: 'test-clerk-secret' });
    const db = createProductImportDb(7);
    const key = `uploads/user-7/${slug}-products.csv`;
    const formData = new FormData();
    formData.append('file', new File([csv], `${slug}.csv`, { type: 'text/csv' }));

    const response = await handleUploadDirect(
      new Request(`https://example.com/api/upload/direct/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { Authorization: 'Bearer clerk-session-token' },
        body: formData,
      }),
      envForUpload,
      key,
      db,
    );

    return { status: response.status, body: (await response.json()) as any };
  };

  // Third column is the COST header. `Selling Price` and `Retail Price` are
  // retail aliases (catalogue-parser.ts:26) and belong to the two dedicated
  // tests below, not here: cost is required and retail is optional, so putting
  // a retail alias in this slot asserts that a retail-only catalogue imports,
  // which the parser deliberately rejects.
  it.each([
    ['Reorder Number', 'Item Name', 'Cost Price', 'Alias'],
    ['Product Code', 'Name', 'Item Cost', 'UPC'],
    ['Item Number', 'Name', 'Cost inc', 'Product Barcode'],
    ['SKU', 'Name', 'Unit Cost', 'Barcode Number'],
  ])(
    'accepts normalized product headers %s, %s, %s, and %s',
    async (skuHeader, nameHeader, costHeader, barcodeHeader) => {
      const { status, body } = await uploadCatalogueCsv(
        `${skuHeader},${nameHeader},${costHeader},${barcodeHeader}\n` +
          'SKU-ALIAS,Alias Product,12.99,BAR-ALIAS\n',
        skuHeader.replace(/\s/g, '-'),
      );

      expect(status).toBe(200);
      expect(body.errors).toEqual([]);
      expect(body.importedCount).toBe(1);
      expect(body.rowsProcessed).toBe(1);
      expect(body.rowsTotal).toBe(1);
    },
  );

  it.each([['Retail Price'], ['Selling Price'], ['RRP']])(
    'accepts a catalogue carrying both Cost and the retail alias %s',
    async (retailHeader) => {
      const { status, body } = await uploadCatalogueCsv(
        `SKU,Name,Cost,${retailHeader},Barcode\n` + 'SKU-R,Retail Product,10.00,19.99,BAR-R\n',
        retailHeader.replace(/\s/g, '-'),
      );

      expect(status).toBe(200);
      expect(body.errors).toEqual([]);
      expect(body.importedCount).toBe(1);
    },
  );

  /**
   * Cost is required and retail is optional (catalogue-parser.ts:24-26), so a
   * catalogue priced only at retail has no cost basis and is rejected. Pinned
   * because two earlier cases asserted the opposite by placing a retail alias
   * in the cost slot of the parity table above; they failed for two months
   * without being noticed, since no CI workflow ran this suite.
   */
  it('rejects a catalogue that carries a retail price but no cost column', async () => {
    const { status, body } = await uploadCatalogueCsv(
      'SKU,Name,Selling Price,Barcode\n' + 'SKU-S,Sell Product,19.99,BAR-S\n',
      'retail-only',
    );

    expect(status).toBe(200);
    expect(body.errors).toEqual(['Missing required column header(s): cost']);
    expect(body.importedCount).toBe(0);
  });

  it('accepts direct CSV uploads when the browser omits the MIME type', async () => {
    mockedVerifyToken.mockResolvedValue({
      sub: 'user_clerk_7',
      email: 'uploader@example.com',
      org_id: 'org_test',
      org_role: 'org:admin',
    });

    const envForUpload = createUploadEnv({ CLERK_SECRET_KEY: 'test-clerk-secret' });
    const db = createProductImportDb(7);
    const key = 'uploads/user-7/1-products.csv';
    const formData = new FormData();
    formData.append(
      'file',
      new File(['SKU,Name,Barcode,Cost\nSKU-1,Milk,BAR-1,12.99\n'], 'products.csv', {
        type: '',
      }),
    );

    const response = await handleUploadDirect(
      new Request(`https://example.com/api/upload/direct/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer clerk-session-token',
        },
        body: formData,
      }),
      envForUpload,
      key,
      db,
    );

    expect(response.status).toBe(200);
  });

  it('does not expose internal import errors in upload summaries', async () => {
    mockedVerifyToken.mockResolvedValue({
      sub: 'user_clerk_7',
      email: 'uploader@example.com',
      org_id: 'org_test',
      org_role: 'org:admin',
    });

    const envForUpload = createUploadEnv({ CLERK_SECRET_KEY: 'test-clerk-secret' });
    const db = {
      ...createProductImportDb(7),
      sql: vi.fn((strings: TemplateStringsArray) => {
        const query = strings.join('');
        if (query.includes('FROM users')) {
          return Promise.resolve([
            {
              id: 7,
              organizationId: 'org_test',
              role: 'admin',
            },
          ]);
        }

        return Promise.reject(new Error('SQLSTATE 23505: secret detail'));
      }),
    } as unknown as Database;
    const key = 'uploads/user-7/1-products.csv';
    const formData = new FormData();
    formData.append(
      'file',
      new File(['SKU,Name,Barcode,Cost\nSKU-1,Milk,BAR-1,12.99\n'], 'products.csv', {
        type: 'text/csv',
      }),
    );

    const response = await handleUploadDirect(
      new Request(`https://example.com/api/upload/direct/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer clerk-session-token',
        },
        body: formData,
      }),
      envForUpload,
      key,
      db,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as any;
    expect(body.errors).toEqual(['Row 2: Product import failed']);
    expect(JSON.stringify(body)).not.toContain('SQLSTATE');
    const putOptions = vi.mocked(envForUpload.CSV_UPLOADS.put).mock.calls[0]?.[2];
    expect(putOptions?.customMetadata?.errors).toBe(
      JSON.stringify(['Row 2: Product import failed']),
    );
    expect(JSON.stringify(putOptions?.customMetadata)).not.toContain('SQLSTATE');
  });

  it('preserves quoted commas in direct CSV uploads', async () => {
    mockedVerifyToken.mockResolvedValue({
      sub: 'user_clerk_7',
      email: 'uploader@example.com',
      org_id: 'org_test',
      org_role: 'org:admin',
    });

    const envForUpload = createUploadEnv({ CLERK_SECRET_KEY: 'test-clerk-secret' });
    const db = createProductImportDb(7);
    const key = 'uploads/user-7/1-products.csv';
    const formData = new FormData();
    formData.append(
      'file',
      new File(['SKU,Name,Barcode,Cost\nSKU-1,"Milk, full cream",BAR-1,12.99\n'], 'products.csv', {
        type: 'text/csv',
      }),
    );

    const response = await handleUploadDirect(
      new Request(`https://example.com/api/upload/direct/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer clerk-session-token',
        },
        body: formData,
      }),
      envForUpload,
      key,
      db,
    );

    expect(response.status).toBe(200);
    const productWrite = vi
      .mocked(db.sql)
      .mock.calls.find(([strings]) => !strings.join('').includes('FROM users'));
    expect(productWrite).toBeDefined();
    expect(productWrite).toContain('Milk, full cream');
  });

  it('returns 404 when a completed upload disappears before processing', async () => {
    mockedVerifyToken.mockResolvedValue({
      sub: 'user_clerk_7',
      email: 'uploader@example.com',
      org_id: 'org_test',
      org_role: 'org:admin',
    });

    const envForUpload = createUploadEnv({
      CLERK_SECRET_KEY: 'test-clerk-secret',
      CSV_UPLOADS: {
        head: vi.fn().mockResolvedValue({ key: 'uploads/user-7/1-products.csv' }),
        get: vi.fn().mockResolvedValue(null),
      } as unknown as R2Bucket,
    });
    const db = createProductImportDb(7);

    const response = await handleUploadComplete(
      new Request('https://example.com/api/upload/complete', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer clerk-session-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: 'uploads/user-7/1-products.csv' }),
      }),
      envForUpload,
      db,
    );

    expect(response.status).toBe(404);
  });
});

describe('Auth input validation', () => {
  const envForAuth = {
    NODE_ENV: 'development',
    STORAGE_PROVIDER: 'local',
    MAX_FILE_SIZE: '10485760',
    CSV_BATCH_SIZE: '100',
    RATE_LIMIT_WINDOW: '60000',
    RATE_LIMIT_MAX_REQUESTS: '10',
    RATE_LIMIT_MAX_AUTHENTICATED: '100',
    NEON_CONNECTION_STRING: 'postgres://example',
    JWT_SECRET: 'test-secret',
    R2_ACCOUNT_ID: 'test',
    R2_ACCESS_KEY_ID: 'test',
    R2_SECRET_ACCESS_KEY: 'test',
    R2_BUCKET_NAME: 'test',
    CSV_UPLOADS: {} as R2Bucket,
    HYPERDRIVE: {} as Hyperdrive,
  } as Env;

  it('returns 401 when organization bootstrap is called without a bearer token', async () => {
    // Given: A bootstrap request without Clerk authentication
    const request = new Request('https://example.com/api/organization/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    // When: The dedicated bootstrap handler runs
    const response = await handleOrganizationBootstrap(request, envForAuth);

    // Then: The request is rejected as unauthorized instead of 404ing
    expect(response.status).toBe(401);
    const body = (await response.json()) as any;
    expect(body.error || body.message).toBeTruthy();
  });

  const createDb = (overrides: Partial<Database> = {}) =>
    ({
      sql: {} as any,
      findUserByEmail: vi.fn().mockResolvedValue(null),
      findUserById: vi.fn(),
      createUser: vi.fn().mockResolvedValue({
        id: 1,
        email: 'user@example.com',
        name: 'User',
        passwordHash: 'hash',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      findProducts: vi.fn(),
      findProductById: vi.fn(),
      countProducts: vi.fn(),
      findInventoryItems: vi.fn(),
      countInventoryItems: vi.fn(),
      findStoreAreas: vi.fn(),
      getDashboardStats: vi.fn(),
      ...overrides,
    }) as unknown as Database;

  it('returns 400 when login body is missing fields', async () => {
    const request = new Request('https://example.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com' }),
    });

    const response = await handleLogin(request, createDb(), envForAuth);
    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body.error).toBe('Email and password are required');
  });

  it('returns 400 when register body is missing fields', async () => {
    const request = new Request('https://example.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'pass' }),
    });

    const response = await handleRegister(request, createDb(), envForAuth);
    expect(response.status).toBe(400);
    const body = (await response.json()) as any;
    expect(body.error).toBe('Email, password, and name are required');
  });

  it('returns 409 when registering existing email', async () => {
    const request = new Request('https://example.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'pass', name: 'User' }),
    });

    const db = createDb({
      findUserByEmail: vi.fn().mockResolvedValue({
        id: 1,
        email: 'user@example.com',
        name: 'User',
        passwordHash: 'hash',
        role: 'user',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });

    const response = await handleRegister(request, db, envForAuth);
    expect(response.status).toBe(409);
    const body = (await response.json()) as any;
    expect(body.error).toBe('Email already registered');
  });
});

describe('Workers database connection strategy', () => {
  it('prefers direct Neon connection when available to avoid Hyperdrive DNS failures', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const envWithBoth = {
      NODE_ENV: 'production',
      STORAGE_PROVIDER: 'r2',
      MAX_FILE_SIZE: '10485760',
      CSV_BATCH_SIZE: '100',
      RATE_LIMIT_WINDOW: '60000',
      RATE_LIMIT_MAX_REQUESTS: '10',
      RATE_LIMIT_MAX_AUTHENTICATED: '100',
      NEON_CONNECTION_STRING:
        'postgresql://neondb_owner:testpass@direct-neon.example.com/neondb?sslmode=require',
      DATABASE_URL:
        'postgresql://neondb_owner:testpass@fallback-db.example.com/neondb?sslmode=require',
      JWT_SECRET: 'test-secret',
      R2_ACCOUNT_ID: 'test',
      R2_ACCESS_KEY_ID: 'test',
      R2_SECRET_ACCESS_KEY: 'test',
      R2_BUCKET_NAME: 'test',
      CSV_UPLOADS: {} as R2Bucket,
      HYPERDRIVE: {
        connectionString:
          'postgresql://neondb_owner:testpass@hyperdrive-proxy.example.com/neondb?sslmode=require',
      } as unknown as Hyperdrive,
    } as Env;

    createWorkersDatabase(envWithBoth);

    expect(logSpy).toHaveBeenCalledWith(
      '[Database] Connecting via Neon serverless driver (direct)',
    );
    expect(warnSpy).not.toHaveBeenCalledWith(
      '[Database] Direct Neon connection not found, falling back to Hyperdrive connection string',
    );

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
