/**
 * Brand enrichment after a catalogue import (task 3.2, batch 6).
 *
 * Express: "does not fail a successful product import when advisory enrichment fails"
 * (`csv.upload.test.ts`). Enrichment attaches brand and supplier hints to products that were
 * just imported. It is advisory: the products are already stored, so a failure in it must be
 * reported and must not turn a finished import into a failed one.
 */
import { describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/cloudflare';
import { enqueueCatalogueImport, enrichImportedProductsSafely } from './catalogue-import';
import type { Env } from '../types/env';
import type { Database } from '../database';

vi.mock('@sentry/cloudflare', () => ({ captureException: vi.fn() }));

const row = {
  rowNumber: 2,
  sku: 'S1',
  name: 'Milk',
  barcode: 'B1',
  costPrice: 1,
  retailPrice: null,
};

describe('enrichImportedProductsSafely', () => {
  it('swallows a failure in the enrichment query and reports it to Sentry', async () => {
    const failure = new Error('catalogue unavailable');
    const db = { sql: vi.fn().mockRejectedValue(failure) } as unknown as Database;

    await expect(enrichImportedProductsSafely(db, 'org_1', [row], 9)).resolves.toBeUndefined();

    expect(Sentry.captureException).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        tags: { feature: 'catalogue-import', action: 'brand-enrichment' },
        extra: { organizationId: 'org_1', uploadId: 9, rowCount: 1 },
      }),
    );
  });

  it('does not touch the database when there is nothing to enrich', async () => {
    const sql = vi.fn();

    await enrichImportedProductsSafely({ sql } as unknown as Database, 'org_1', []);

    expect(sql).not.toHaveBeenCalled();
  });
});

describe('enqueueCatalogueImport', () => {
  it('marks the import failed and deletes the source file when the queue send fails', async () => {
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const env = {
      CATALOGUE_IMPORT_QUEUE: { send: vi.fn().mockRejectedValue(new Error('queue unavailable')) },
      CSV_UPLOADS: { delete: deleteObject },
    } as unknown as Env;
    const sql = vi.fn((strings: TemplateStringsArray) =>
      Promise.resolve(
        strings.join('').includes("status = 'failed'") ? [{ fileKey: 'uploads/user-1/a.csv' }] : [],
      ),
    );

    const queued = await enqueueCatalogueImport(env, { sql } as unknown as Database, 9);

    expect(queued).toBe(false);
    expect(deleteObject).toHaveBeenCalledWith('uploads/user-1/a.csv');
  });
});
