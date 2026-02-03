import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, vi } from 'vitest';
import { healthCheck } from './health';
import { handleLogin, handleRegister } from './index-minimal';
import type { Database } from './database';
import type { Env } from './types/env';

describe('Health Check API', () => {
  it('should return 200 OK for /health', async () => {
    const response = await SELF.fetch('https://example.com/health');
    expect(response.status).toBe(200);
    
    const data = await response.json() as any;
    expect(data.status).toBe('healthy');
    expect(data.checks.workers.status).toBe('pass');
  });

  it('should return 200 OK for /api/health', async () => {
    const response = await SELF.fetch('https://example.com/api/health');
    expect(response.status).toBe(200);
    
    const data = await response.json() as any;
    expect(data.status).toBe('healthy');
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
    const body = await response.json() as any;
    expect(body.error).toBeTruthy();
  });

  it('returns 500 when database config is missing for /api/users/me', async () => {
    const response = await SELF.fetch('https://example.com/api/users/me');
    expect(response.status).toBe(500);
    const body = await response.json() as any;
    expect(body.error).toBeTruthy();
  });

  it('returns 500 when database config is missing for /api/dashboard', async () => {
    const response = await SELF.fetch('https://example.com/api/dashboard');
    expect(response.status).toBe(500);
    const body = await response.json() as any;
    expect(body.error).toBeTruthy();
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
    const body = await response.json() as any;
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
    const body = await response.json() as any;
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
    const body = await response.json() as any;
    expect(body.error).toBe('Email already registered');
  });
});
