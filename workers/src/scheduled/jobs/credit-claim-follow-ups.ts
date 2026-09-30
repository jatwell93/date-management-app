/**
 * `credit-claim-follow-ups` — enqueue one queue message per supplier claim
 * whose `next_follow_up_at` has arrived, so the notification-email consumer
 * sends the nudge with the queue's retry and DLQ policy (task 3.3b, matrix
 * rows 7/14).
 *
 * The job deliberately enqueues *candidates*, not sends: the consumer calls
 * `sendFollowUp` with `requireDueAt`, which re-loads the claim and re-checks
 * due-ness at send time — a duplicated or delayed message cannot nudge a
 * supplier twice. Batch-limited at 500 per run like the photo purge.
 */
import { listClaimsDueForFollowUpAcrossOrgs } from '../../credit-claim-database';
import { isResendConfigured, requireNotificationEmailQueue } from '../../notifications/messages';
import type { JobContext, ScheduledJob } from '../schedule';

const BATCH_LIMIT = 500;
/** `sendBatch` accepts at most 100 messages per call — chunk the enqueue. */
const SEND_BATCH_CHUNK = 100;

export const creditClaimFollowUpsJob: ScheduledJob = {
  name: 'credit-claim-follow-ups',
  cadence: { kind: 'daily', hourUtc: 23 },
  leaseSeconds: 300,
  async run({ env, sql, asOf }: JobContext) {
    // Same posture as `trial-emails`: unconfigured Resend is a skip (possibly
    // deliberate), a missing queue binding is a broken deploy (throw).
    if (!isResendConfigured(env)) {
      console.warn(
        '[ScheduledJob credit-claim-follow-ups] RESEND_API_KEY and RESEND_FROM_EMAIL must both be set; skipping.',
      );
      return { summary: { skipped: 'resend-not-configured' } };
    }
    const queue = requireNotificationEmailQueue(env);

    const claims = await listClaimsDueForFollowUpAcrossOrgs(sql, asOf, BATCH_LIMIT);
    for (let i = 0; i < claims.length; i += SEND_BATCH_CHUNK) {
      await queue.sendBatch(
        claims.slice(i, i + SEND_BATCH_CHUNK).map((claim) => ({
          body: {
            kind: 'credit-claim-follow-up' as const,
            organizationId: claim.organizationId,
            claimId: claim.id,
          },
        })),
      );
    }

    return {
      summary: { enqueued: claims.length, hitBatchLimit: claims.length === BATCH_LIMIT },
    };
  },
};
