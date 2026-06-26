import { describe, expect, it, vi } from 'vitest';
import {
  processCompletedUploadSync,
  queueCompletedCatalogueUpload,
  userOwnsUploadKey,
} from './upload-handlers';
import type { Database } from '../database';
import type { Env } from '../types/env';

const env = {
  NODE_ENV: 'development',
  CATALOGUE_IMPORT_QUEUE: { send: vi.fn() },
} as unknown as Env;
const db = {} as Database;

describe('Worker upload completion helpers', () => {
  it('checks upload key ownership using the user-scoped prefix', () => {
    expect(userOwnsUploadKey('uploads/user-7/products.csv', 7)).toBe(true);
    expect(userOwnsUploadKey('uploads/user-8/products.csv', 7)).toBe(false);
  });

  it('queues a completed catalogue upload with R2 metadata', async () => {
    const response = await queueCompletedCatalogueUpload({
      env,
      db,
      key: 'uploads/user-7/products.csv',
      object: { size: 123, httpMetadata: { contentType: 'text/csv' } },
      organizationId: 'org_test',
      userId: 7,
      deps: {
        getOrganizationLaunchTier: vi.fn().mockResolvedValue('professional'),
        createQueuedCatalogueUpload: vi.fn().mockResolvedValue(42),
        enqueueCatalogueImport: vi.fn().mockResolvedValue(true),
      },
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      key: 'uploads/user-7/products.csv',
      uploadId: 42,
      status: 'queued',
    });
  });

  it('maps disappearing R2 objects during sync processing to 404', async () => {
    const response = await processCompletedUploadSync({
      env,
      db,
      key: 'uploads/user-7/products.csv',
      organizationId: 'org_test',
      deps: {
        processStoredUpload: vi.fn().mockRejectedValue(new Error('Upload not found')),
      },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Upload not found' });
  });
});
