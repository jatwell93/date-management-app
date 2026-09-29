/**
 * Unit coverage for the `credit-claim-photo-purge` job's failure posture: R2
 * errors are swallowed (the object may already be gone — the row is still
 * deleted), row-delete errors are per-photo captured and the loop continues,
 * and `failed > 0` marks the run failed. The underlying SELECT/DELETE
 * statements are real-SQL covered in `scheduled.pglite.node.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../types/env';
import type { SqlClient } from '../schedule';

const sentryCalls = vi.hoisted(() => ({ exceptions: [] as unknown[] }));

vi.mock('@sentry/cloudflare', () => ({
  captureException: (error: unknown, context?: unknown) => {
    sentryCalls.exceptions.push([error, context]);
  },
}));

import { creditClaimPhotoPurgeJob } from './credit-claim-photo-purge';

const AS_OF = new Date('2026-10-01T03:00:00.000Z');

/** Fake bucket recording deletes; `failingKeys` reject. */
function fakeBucket(failingKeys: string[] = []) {
  const deleted: string[] = [];
  return {
    deleted,
    bucket: {
      delete: async (key: string) => {
        if (failingKeys.includes(key)) throw new Error('r2 gone');
        deleted.push(key);
      },
    } as unknown as R2Bucket,
  };
}

/** Fake SqlClient: SELECT returns `photos`; DELETE fails for `failingIds`. */
function fakeSql(
  photos: Array<{ id: number; organizationId: string; storageKey: string }>,
  failingIds: number[] = [],
) {
  const deletedIds: number[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (/FROM credit_claim_photos/.test(text) && /SELECT/.test(text)) {
      return photos.map((p) => ({ ...p }));
    }
    if (/DELETE FROM credit_claim_photos/.test(text)) {
      const id = values[0] as number;
      if (failingIds.includes(id)) throw new Error('row delete exploded');
      deletedIds.push(id);
      return [];
    }
    throw new Error(`unexpected query: ${text}`);
  }) as unknown as SqlClient;
  return { sql, deletedIds };
}

function env(bucket: R2Bucket): Env {
  return { NODE_ENV: 'test', CSV_UPLOADS: bucket } as unknown as Env;
}

describe('credit-claim-photo-purge job', () => {
  beforeEach(() => {
    sentryCalls.exceptions.length = 0;
  });

  it('deletes the R2 object then the row for each due photo', async () => {
    const { bucket, deleted } = fakeBucket();
    const { sql, deletedIds } = fakeSql([
      { id: 1, organizationId: 'org_1', storageKey: 'a.jpg' },
      { id: 2, organizationId: 'org_2', storageKey: 'b.jpg' },
    ]);

    const result = await creditClaimPhotoPurgeJob.run({ env: env(bucket), sql, asOf: AS_OF });

    expect(deleted.sort()).toEqual(['a.jpg', 'b.jpg']);
    expect(deletedIds).toEqual([1, 2]);
    expect(result.summary.purged).toBe(2);
    expect(result.summary.failed).toBe(0);
    expect(result.failed).not.toBe(true);
  });

  it('still deletes the row when the R2 delete fails (object may be gone)', async () => {
    const { bucket } = fakeBucket(['gone.jpg']);
    const { sql, deletedIds } = fakeSql([
      { id: 1, organizationId: 'org_1', storageKey: 'gone.jpg' },
    ]);

    const result = await creditClaimPhotoPurgeJob.run({ env: env(bucket), sql, asOf: AS_OF });

    expect(deletedIds).toEqual([1]);
    expect(result.summary.purged).toBe(1);
    expect(result.failed).not.toBe(true);
    expect(sentryCalls.exceptions).toHaveLength(0);
  });

  it('captures a row-delete failure per photo, continues, and marks the run failed', async () => {
    const { bucket } = fakeBucket();
    const { sql, deletedIds } = fakeSql(
      [
        { id: 1, organizationId: 'org_1', storageKey: 'a.jpg' },
        { id: 2, organizationId: 'org_2', storageKey: 'b.jpg' },
      ],
      [1],
    );

    const result = await creditClaimPhotoPurgeJob.run({ env: env(bucket), sql, asOf: AS_OF });

    expect(deletedIds).toEqual([2]);
    expect(result.summary).toEqual({ purged: 1, failed: 1, hitBatchLimit: false });
    expect(result.failed).toBe(true);
    expect(sentryCalls.exceptions).toHaveLength(1);
    const ctx = (
      sentryCalls.exceptions[0] as [
        unknown,
        { tags: Record<string, string>; extra: Record<string, unknown> },
      ]
    )[1];
    expect(ctx.tags.job).toBe('credit-claim-photo-purge');
    expect(ctx.extra.photoId).toBe(1);
    expect(ctx.extra.organizationId).toBe('org_1');
  });
});
