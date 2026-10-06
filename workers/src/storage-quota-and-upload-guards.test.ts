/**
 * Storage-quota route and upload-request guards (task 3.2, batch 4d).
 *
 * Express tested the storage quota as a service (`storage-quota.service.test.ts`) and the
 * upload guards through its upload routes (`upload-routes-service-provider.test.ts`). The
 * Worker has no quota service: `GET /api/storage-quota/:userId` computes the figures in the
 * handler, and the upload handlers validate the request before any storage read. These
 * tests drive both with a stubbed database, so they pin what the handlers own: the
 * numbers returned, the warning threshold, which tier the cap comes from, and which
 * requests are refused before anything is read or written.
 *
 * Over-quota REFUSAL of an upload is covered in `health.test.ts` ("tier storage quota").
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveMinimalApiRoute, type MinimalApiRoute } from './minimal-api-routes';
import * as minimalEntrypoint from './index-minimal';
import { handleUploadDirect, handleUploadInitiate, handleUploadPresigned } from './index-minimal';
import { authenticateClerkRequest } from './clerk/bootstrap-handler';
import { STORAGE_LIMIT_BYTES_BY_TIER } from './utils/usage-limits';
import type { Database } from './database';
import type { Env } from './types/env';

vi.mock('./clerk/bootstrap-handler', () => ({
  authenticateClerkRequest: vi.fn(),
  getClerkAuthorizedParties: vi.fn(() => []),
  handleOrganizationBootstrap: vi.fn().mockResolvedValue(new Response('bootstrap')),
}));

const mockedAuthenticateClerkRequest = vi.mocked(authenticateClerkRequest);
const ENV = { JWT_SECRET: 'test-upload-token-secret' } as Env;
const USER_ID = 7;
const GIB = 1024 * 1024 * 1024;

function routes(): MinimalApiRoute[] {
  return (minimalEntrypoint as typeof minimalEntrypoint & { MINIMAL_API_ROUTES: MinimalApiRoute[] })
    .MINIMAL_API_ROUTES;
}

/** User 7 in `org_123`; the organization's subscription is on `tier`. */
function databaseOnTier(tier: string, usedBytes: number) {
  const getStorageUsedBytes = vi.fn().mockResolvedValue(usedBytes);
  const database = {
    getStorageUsedBytes,
    sql: vi.fn((strings: TemplateStringsArray) =>
      strings.join('').includes('FROM subscription_tiers')
        ? Promise.resolve([{ tier_level: tier, status: 'active' }])
        : Promise.resolve([{ id: USER_ID, organizationId: 'org_123', role: 'admin' }]),
    ),
  } as unknown as Database;
  return { database, getStorageUsedBytes };
}

function getQuota(pathAndQuery: string, database: Database) {
  const pathname = pathAndQuery.split('?')[0];
  return resolveMinimalApiRoute(routes(), {
    request: new Request(`https://example.com${pathAndQuery}`),
    pathname,
    method: 'GET',
    db: database,
    env: ENV,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAuthenticateClerkRequest.mockResolvedValue({
    clerkUserId: 'user_clerk_123',
    email: 'user@example.com',
    username: 'user',
    organizationId: 'org_123',
    organizationRole: 'org:admin',
  });
});

describe('GET /api/storage-quota/:userId', () => {
  it('reports the used bytes, the tier cap and the warning threshold', async () => {
    const { database } = databaseOnTier('free', GIB / 4);

    const response = await getQuota(`/api/storage-quota/${USER_ID}`, database);

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      used: GIB / 4,
      limit: GIB,
      percentageUsed: 25,
      tier: 'free',
      displayLimit: '1 GB',
      warningThreshold: 80,
      isWarning: false,
    });
  });

  it('does not warn at 79% and warns from 80%', async () => {
    const below = databaseOnTier('free', Math.floor(0.79 * GIB));
    const at = databaseOnTier('free', Math.ceil(0.8 * GIB));

    const belowBody = await (
      await getQuota(`/api/storage-quota/${USER_ID}`, below.database)
    )?.json();
    const atBody = await (await getQuota(`/api/storage-quota/${USER_ID}`, at.database))?.json();

    expect(belowBody).toMatchObject({ percentageUsed: 79, isWarning: false });
    expect(atBody).toMatchObject({ percentageUsed: 80, isWarning: true });
  });

  it('reports usage above the cap as over 100% without failing', async () => {
    const { database } = databaseOnTier('free', Math.floor(1.5 * GIB));

    const response = await getQuota(`/api/storage-quota/${USER_ID}`, database);

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({ percentageUsed: 150, isWarning: true });
  });

  it('measures against the cap of the organization tier, not the tier named in the query', async () => {
    const { database } = databaseOnTier('starter', 2 * GIB);

    const response = await getQuota(`/api/storage-quota/${USER_ID}?tier=free`, database);

    // Against the free cap this would read 200% and warn. The tier comes from the
    // organization, so it reads as the starter cap does.
    await expect(response?.json()).resolves.toMatchObject({
      tier: 'starter',
      limit: STORAGE_LIMIT_BYTES_BY_TIER.starter,
      isWarning: false,
    });
  });

  it('ignores a tier in the query that names no tier, instead of failing', async () => {
    const { database } = databaseOnTier('free', 0);

    const response = await getQuota(`/api/storage-quota/${USER_ID}?tier=platinum`, database);

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({ tier: 'free', limit: GIB });
  });

  it('refuses another user id before reading any storage', async () => {
    const { database, getStorageUsedBytes } = databaseOnTier('free', 0);

    const response = await getQuota(`/api/storage-quota/${USER_ID + 1}`, database);

    expect(response?.status).toBe(403);
    expect(getStorageUsedBytes).not.toHaveBeenCalled();
  });

  it('answers 400 for a user id that is not a number', async () => {
    const { database, getStorageUsedBytes } = databaseOnTier('free', 0);

    const response = await getQuota('/api/storage-quota/abc', database);

    expect(response?.status).toBe(400);
    expect(getStorageUsedBytes).not.toHaveBeenCalled();
  });
});

describe('upload initiate: required fields', () => {
  const initiate = (body: Record<string, unknown>, database: Database) =>
    handleUploadInitiate(
      new Request('https://example.com/api/upload/initiate', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
      ENV,
      '/api/upload',
      database,
    );

  it.each([
    ['filename', { fileSize: 1024, contentType: 'text/csv' }],
    ['an empty filename', { filename: '', fileSize: 1024, contentType: 'text/csv' }],
    ['fileSize', { filename: 'a.csv', contentType: 'text/csv' }],
    [
      'a fileSize that is a string',
      { filename: 'a.csv', fileSize: '1024', contentType: 'text/csv' },
    ],
    ['contentType', { filename: 'a.csv', fileSize: 1024 }],
  ])('refuses a request with no %s, before reading storage', async (_label, body) => {
    const { database, getStorageUsedBytes } = databaseOnTier('free', 0);

    const response = await initiate(body, database);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Missing required fields: filename, fileSize, contentType',
    });
    expect(getStorageUsedBytes).not.toHaveBeenCalled();
  });

  it('chooses the direct strategy at exactly 2 MiB and the presigned strategy one byte over', async () => {
    const { database } = databaseOnTier('free', 0);
    const base = { filename: 'a.csv', contentType: 'text/csv' };

    const atThreshold = await (
      await initiate({ ...base, fileSize: 2 * 1024 * 1024 }, database)
    ).json();
    const overThreshold = await (
      await initiate({ ...base, fileSize: 2 * 1024 * 1024 + 1 }, database)
    ).json();

    expect(atThreshold).toMatchObject({ strategy: 'direct', method: 'POST' });
    expect(overThreshold).toMatchObject({ strategy: 'presigned', method: 'PUT' });
  });
});

describe('direct upload: the file part', () => {
  const direct = (form: FormData, key: string, database: Database, env: Env = ENV) =>
    handleUploadDirect(
      new Request(`https://example.com/api/upload/direct/${encodeURIComponent(key)}`, {
        method: 'POST',
        body: form,
      }),
      env,
      key,
      database,
    );

  it('refuses a request with no file and writes nothing', async () => {
    const put = vi.fn();
    const { database } = databaseOnTier('free', 0);

    const response = await direct(new FormData(), `uploads/user-${USER_ID}/1-a.csv`, database, {
      CSV_UPLOADS: { put },
    } as unknown as Env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'No file uploaded' });
    expect(put).not.toHaveBeenCalled();
  });

  it('refuses a "file" field that is text, not a file', async () => {
    const form = new FormData();
    form.set('file', 'sku,name\n1,Milk');
    const { database } = databaseOnTier('free', 0);

    const response = await direct(form, `uploads/user-${USER_ID}/1-a.csv`, database);

    expect(response.status).toBe(400);
  });

  it('refuses a key that belongs to another user', async () => {
    const form = new FormData();
    form.set('file', new File(['sku,name\n1,Milk'], 'a.csv', { type: 'text/csv' }));
    const { database } = databaseOnTier('free', 0);

    const response = await direct(form, `uploads/user-${USER_ID + 1}/1-a.csv`, database);

    expect(response.status).toBe(403);
  });
});

describe('presigned upload: initiate then PUT', () => {
  const THREE_MIB = 3 * 1024 * 1024;

  async function initiatePresigned(database: Database) {
    const response = await handleUploadInitiate(
      new Request('https://example.com/api/upload/initiate', {
        method: 'POST',
        body: JSON.stringify({
          filename: 'big.csv',
          fileSize: THREE_MIB,
          contentType: 'text/csv',
        }),
      }),
      ENV,
      '/api/upload',
      database,
    );
    const body = (await response.json()) as { uploadUrl: string; key: string };
    const url = new URL(body.uploadUrl);
    return { key: body.key, token: url.searchParams.get('token'), url };
  }

  const put = (key: string, token: string | null, bytes: BodyInit, env: Env) =>
    handleUploadPresigned(
      new Request('https://example.com/upload', { method: 'PUT', body: bytes }),
      env,
      key,
      token,
    );

  it('stores the bytes under the key the initiate step issued', async () => {
    const { database } = databaseOnTier('free', 0);
    const { key, token, url } = await initiatePresigned(database);
    const bucketPut = vi.fn().mockResolvedValue(undefined);

    const response = await put(key, token, 'sku,name\n1,Milk', {
      ...ENV,
      CSV_UPLOADS: { put: bucketPut },
    } as unknown as Env);

    expect(url.pathname).toBe(`/api/upload/presigned/${encodeURIComponent(key)}`);
    expect(response.status).toBe(200);
    expect(key).toContain(`uploads/user-${USER_ID}/`);
    expect(bucketPut).toHaveBeenCalledTimes(1);
    expect(bucketPut.mock.calls[0][0]).toBe(key);
  });

  it('refuses a PUT with no token, or a token issued for a different key, and stores nothing', async () => {
    const { database } = databaseOnTier('free', 0);
    const { key, token } = await initiatePresigned(database);
    const bucketPut = vi.fn();
    const env = { ...ENV, CSV_UPLOADS: { put: bucketPut } } as unknown as Env;

    const noToken = await put(key, null, 'sku,name\n1,Milk', env);
    const otherKey = await put(
      `uploads/user-${USER_ID}/9-other.csv`,
      token,
      'sku,name\n1,Milk',
      env,
    );

    expect(noToken.status).toBe(401);
    expect(otherKey.status).toBe(403);
    expect(bucketPut).not.toHaveBeenCalled();
  });

  it('refuses a body larger than the size the token was issued for', async () => {
    const { database } = databaseOnTier('free', 0);
    const { key, token } = await initiatePresigned(database);
    const bucketPut = vi.fn();
    const env = { ...ENV, CSV_UPLOADS: { put: bucketPut } } as unknown as Env;

    const response = await put(key, token, new Uint8Array(26 * 1024 * 1024), env);

    expect(response.status).toBe(400);
    expect(bucketPut).not.toHaveBeenCalled();
  });
});

describe('GET /api/products/export-excess: a failed read', () => {
  it('does not answer 200 with an empty export when the product count cannot be read', async () => {
    const { database } = databaseOnTier('free', 0);
    (database as unknown as Record<string, unknown>).countProducts = vi
      .fn()
      .mockRejectedValue(new Error('connection reset'));

    const response = resolveMinimalApiRoute(routes(), {
      request: new Request('https://example.com/api/products/export-excess'),
      pathname: '/api/products/export-excess',
      method: 'GET',
      db: database,
      env: ENV,
    });

    // The handler lets the failure propagate to the Worker's top-level catch,
    // which answers 500. The one thing it must not do is swallow the failure and
    // hand a locked-out customer an empty "nothing to export".
    await expect(response).rejects.toThrow('connection reset');
  });
});
