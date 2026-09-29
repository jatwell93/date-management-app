/**
 * `credit-claim-photo-purge` — delete claim evidence photos whose retention
 * deadline (`credit_claim_photos.delete_after`) has passed (audit row 15).
 *
 * Batch-limited at 500 per run: a large backlog drains over successive daily
 * ticks rather than one long run against the lease window.
 *
 * The R2 binding's `delete()` does not throw for a missing key, so a throw is a
 * real failure: the row is left in place (the next tick retries it), the error
 * is captured per photo with the photo and object identifiers, and the loop
 * continues. `failed > 0` marks the run failed so the slot stays owed.
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
      try {
        // Object first, row second: a row deleted before its object would leave
        // untracked R2 garbage, while a failed R2 delete leaving the row is
        // self-healing — the next tick retries it.
        await photoBucket(env).delete(photo.storageKey);
        await deletePhotoRowById(sql, photo.id);
        purged += 1;
      } catch (error) {
        failed += 1;
        Sentry.captureException(error, {
          tags: { job: 'credit-claim-photo-purge', event: 'photo-delete' },
          extra: {
            organizationId: photo.organizationId,
            photoId: photo.id,
            storageKey: photo.storageKey,
          },
        });
      }
    }

    return {
      summary: { purged, failed, hitBatchLimit: photos.length === BATCH_LIMIT },
      failed: failed > 0,
    };
  },
};
