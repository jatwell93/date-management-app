import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, vi } from 'vitest';
import { healthCheck } from './health';
import {
  default as worker,
  handleLogin,
  handleOrganizationBootstrap,
  handleRegister,
  handleUploadInitiate,
  handleUploadStatus,
  maybeCompressJsonResponse,
} from './index-minimal';
import { createWorkersDatabase } from './database';
import type { Database } from './database';
import type { Env } from './types/env';
import { SignJWT } from 'jose';

async function createAuthToken(secret: string, userId: number): Promise<string> {
  const key = new TextEncoder().encode(secret);

  return await new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('15m')
    .setIssuedAt()
    .sign(key);
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
    R2_ACCOUNT_ID: 'test-account',
    R2_ACCESS_KEY_ID: 'test-key',
    R2_SECRET_ACCESS_KEY: 'test-secret',
    R2_BUCKET_NAME: 'test-bucket',
    CSV_UPLOADS: {
      head: vi.fn().mockResolvedValue({ key: 'uploads/user-7/1-big.csv' }),
      put: vi.fn().mockResolvedValue(undefined),
    } as unknown as R2Bucket,
    HYPERDRIVE: {
      connectionString: 'postgres://example',
    } as unknown as Hyperdrive,
    ...overrides,
  });

  it('returns presigned strategy for files larger than 2MB', async () => {
    const envForUpload = createUploadEnv();
    const token = await createAuthToken(envForUpload.JWT_SECRET, 7);

    const request = new Request('https://example.com/api/upload/initiate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filename: 'big.csv',
        fileSize: 3 * 1024 * 1024,
        contentType: 'text/csv',
      }),
    });

    const response = await handleUploadInitiate(request, envForUpload, '/api/upload');
    expect(response.status).toBe(200);

    const body = (await response.json()) as any;
    expect(body.strategy).toBe('presigned');
    expect(body.method).toBe('PUT');
    expect(body.uploadUrl).toContain('/api/upload/presigned/');
    expect(body.uploadUrl).toContain('token=');
  });

  it('returns complete upload status when object exists', async () => {
    const envForUpload = createUploadEnv();
    const token = await createAuthToken(envForUpload.JWT_SECRET, 7);
    const key = 'uploads/user-7/1-big.csv';

    const request = new Request(
      `https://example.com/api/upload/status/${encodeURIComponent(key)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    const response = await handleUploadStatus(request, envForUpload, key);
    expect(response.status).toBe(200);

    const body = (await response.json()) as any;
    expect(body.status).toBe('complete');
    expect(body.progress).toBe(100);
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

  const createDb = (overrides: Partial<Database> = {}): Database => ({
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
  });

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
