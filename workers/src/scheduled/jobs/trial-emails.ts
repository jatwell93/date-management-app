/**
 * `trial-emails` — enqueue the per-recipient trial lifecycle emails (reminders
 * at the 10/5/2-day thresholds, plus one "your trial has ended" notice) onto
 * `NOTIFICATION_EMAIL_QUEUE` for the queue consumer to send (task 3.3b,
 * matrix row 5).
 *
 * The job only decides *who is due* and filters out ids already present in
 * `trial_events`; the consumer re-validates against live state and reserves
 * the `trial_events` row before sending, so a duplicated message still cannot
 * email twice.
 *
 * Batch-limited at 500 candidates per window per run, matching the photo-purge
 * posture: a backlog drains over successive daily ticks instead of one long
 * run against the lease.
 */
import {
  isResendConfigured,
  requireNotificationEmailQueue,
  type NotificationEmailMessage,
} from '../../notifications/messages';
import {
  listExistingTrialEventIds,
  listTrialEndedCandidates,
  listTrialReminderCandidates,
  reminderThresholdFor,
  trialEndedEmailSentEventId,
  trialReminderSentEventId,
} from '../../notifications/trial-email-database';
import type { JobContext, ScheduledJob } from '../schedule';

const BATCH_LIMIT = 500;
/** `sendBatch` accepts at most 100 messages per call — chunk the enqueue. */
const SEND_BATCH_CHUNK = 100;

export const trialEmailsJob: ScheduledJob = {
  name: 'trial-emails',
  cadence: { kind: 'daily', hourUtc: 22 },
  leaseSeconds: 300,
  async run({ env, sql, asOf }: JobContext) {
    // Nothing on this instance can send the emails, so scanning and enqueueing
    // would just churn the DLQ-bound messages' retries later. Skip — loudly,
    // but not as a failure: the configuration may be deliberate.
    if (!isResendConfigured(env)) {
      console.warn(
        '[ScheduledJob trial-emails] RESEND_API_KEY and RESEND_FROM_EMAIL must both be set; skipping.',
      );
      return { summary: { skipped: 'resend-not-configured' } };
    }
    // A missing binding is a broken deploy, not a deliberate configuration:
    // throw so the run is recorded failed and captured, rather than reporting
    // a successful tick that enqueued nothing.
    const queue = requireNotificationEmailQueue(env);

    const reminderCandidates = await listTrialReminderCandidates(sql, asOf, BATCH_LIMIT);
    const endedCandidates = await listTrialEndedCandidates(sql, asOf, BATCH_LIMIT);

    // One (message, dedupeId) pair per candidate. The reminder threshold is
    // resolved here — smallest covering threshold — and travels inside the
    // message so the consumer never recomputes which window it belongs to.
    const pending: Array<{ message: NotificationEmailMessage; dedupeId: string }> = [];

    for (const candidate of reminderCandidates) {
      const trialEndIso = candidate.trialEndDate.toISOString();
      const threshold = reminderThresholdFor(candidate.trialEndDate, asOf);
      if (threshold === null) {
        continue;
      }
      pending.push({
        message: {
          kind: 'trial-reminder',
          organizationId: candidate.organizationId,
          trialEndDate: trialEndIso,
          threshold,
        },
        dedupeId: trialReminderSentEventId(candidate.organizationId, trialEndIso, threshold),
      });
    }

    for (const candidate of endedCandidates) {
      const trialEndIso = candidate.trialEndDate.toISOString();
      pending.push({
        message: {
          kind: 'trial-ended',
          organizationId: candidate.organizationId,
          trialEndDate: trialEndIso,
        },
        dedupeId: trialEndedEmailSentEventId(candidate.organizationId, trialEndIso),
      });
    }

    // Drop candidates whose marker row already exists — sent (or reserved
    // mid-send) on an earlier run. A queued-but-unconsumed duplicate is caught
    // by the consumer's reservation instead. One PK lookup for the whole batch.
    const existing = await listExistingTrialEventIds(
      sql,
      pending.map((p) => p.dedupeId),
    );
    const fresh = pending.filter((p) => !existing.has(p.dedupeId));
    const alreadySent = pending.length - fresh.length;

    let remindersEnqueued = 0;
    let endedEnqueued = 0;
    const bodies = fresh.map((p) => p.message);
    for (let i = 0; i < bodies.length; i += SEND_BATCH_CHUNK) {
      await queue.sendBatch(bodies.slice(i, i + SEND_BATCH_CHUNK).map((body) => ({ body })));
    }
    for (const message of bodies) {
      if (message.kind === 'trial-reminder') {
        remindersEnqueued += 1;
      } else if (message.kind === 'trial-ended') {
        endedEnqueued += 1;
      }
    }

    return { summary: { remindersEnqueued, endedEnqueued, alreadySent } };
  },
};
