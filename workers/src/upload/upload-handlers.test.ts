import { describe, expect, it, vi } from 'vitest';
import {
  processStoredUpload,
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

  it('processes a stored upload and writes processing summary metadata back to R2', async () => {
    const csv = new TextEncoder().encode('SKU,Name,Barcode,Cost\n').buffer;
    const put = vi.fn();
    const processingEnv = {
      ...env,
      CSV_UPLOADS: {
        get: vi.fn().mockResolvedValue({
          arrayBuffer: vi.fn().mockResolvedValue(csv),
          httpMetadata: { contentType: 'text/csv' },
        }),
        put,
      },
    } as unknown as Env;

    const summary = await processStoredUpload(
      'uploads/user-7/products.csv',
      'org_test',
      processingEnv,
      { sql: vi.fn() } as unknown as Database,
    );

    expect(summary).toMatchObject({
      rowsProcessed: 0,
      rowsTotal: 0,
      importedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      errorCount: 1,
      errors: ['No product rows found'],
    });
    expect(put).toHaveBeenCalledWith(
      'uploads/user-7/products.csv',
      csv,
      expect.objectContaining({
        customMetadata: expect.objectContaining({
          errorCount: '1',
          errors: JSON.stringify(['No product rows found']),
        }),
      }),
    );
  });

  it('dispatches expiry-list uploads to the expiry processor, not the catalogue parser', async () => {
    // A header-only expiry file surfaces the expiry-specific "No expiry rows found"
    // error, proving importType routed to processExpiryListUpload (the catalogue path
    // would instead report "No product rows found").
    const csv = new TextEncoder().encode('SKU,Used-By Date\n').buffer;
    const processingEnv = {
      ...env,
      CSV_UPLOADS: {
        get: vi.fn().mockResolvedValue({
          arrayBuffer: vi.fn().mockResolvedValue(csv),
          httpMetadata: { contentType: 'text/csv' },
        }),
        put: vi.fn(),
      },
    } as unknown as Env;

    const summary = await processStoredUpload(
      'uploads/user-7/expiry.csv',
      'org_test',
      processingEnv,
      { sql: vi.fn() } as unknown as Database,
      'expiry-list',
    );

    expect(summary.errors).toEqual(['No expiry rows found']);
  });
});
