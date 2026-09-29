/**
 * `credit-claim-photo-purge` — delete claim evidence photos whose retention
 * deadline (`credit_claim_photos.delete_after`) has passed (audit row 15).
 *
 * Batch-limited at 500 per run: a large backlog drains over successive daily
 * ticks rather than one long run against the lease window.
 *
 * Failure posture is Express's: an R2 delete error is swallowed (the object may
 * already be gone — the row must still be removed), while a *row* delete error
 * is per-photo captured and the loop continues; `failed > 0` marks the run
 * failed so the missed rows are retried on the next tick.
 */
import * as Sentry from '@sentry/cloudflare';
import { deletePhotoRowById, listPhotosDueForPurgeAcrossOrgs } from '../../credit-claim-database';
import { photoBucket } from '../../credit-claim-service';
import type { JobContext, ScheduledJob } from '../schedule';

const BATCH_LIMIT = 500;

export const creditClaimPhotoPurgeJob: ScheduledJob = {
  name: 'credit-claim-photo-purge',
  cadence: { kind: 'daily', hourUtc: 3 },
  leaseSeconds: 600,
  async run({ env, sql, asOf }: JobContext) {
    const photos = await listPhotosDueForPurgeAcrossOrgs(sql, asOf, BATCH_LIMIT);
    let purged = 0;
    let failed = 0;

    for (const photo of photos) {
      // The object may already be gone (manual delete, lifecycle rule). The row
      // is the source of truth for "still retained", so an R2 miss must not stop
      // the row being removed — Express treats this identically.
      await photoBucket(env)
        .delete(photo.storageKey)
        .catch(() => undefined);
      try {
        await deletePhotoRowById(sql, photo.id);
        purged += 1;
      } catch (error) {
        failed += 1;
        Sentry.captureException(error, {
          tags: { job: 'credit-claim-photo-purge', event: 'photo-delete' },
          extra: { organizationId: photo.organizationId, photoId: photo.id },
        });
      }
    }

    return {
      summary: { purged, failed, hitBatchLimit: photos.length === BATCH_LIMIT },
      failed: failed > 0,
    };
  },
};
