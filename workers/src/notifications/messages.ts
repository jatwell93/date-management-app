/**
 * The notification-email queue's message contract — what the `trial-emails`
 * and `credit-claim-follow-ups` scheduled jobs enqueue and what
 * `notification-email-queue.ts` consumes. Per-recipient sends travel through
 * the queue rather than the cron tick itself so each send gets the queue's
 * retry and DLQ policy (matrix rows 5, 7 and 14; task 3.3b).
 *
 * `trialEndDate` is an ISO-8601 string: the value the producing job read from
 * `subscription_tiers.trial_end_date`, so the consumer can detect a stale
 * message (the stored end moved on) instead of emailing about a trial that no
 * longer ends when the message claims. `asOf` is the producing tick's instant
 * for the same reason in the other direction: the consumer renders
 * `daysRemaining` from it, so a retried send is byte-identical under the same
 * Resend Idempotency-Key.
 */
import type { Env } from '../types/env';
import { TRIAL_REMINDER_THRESHOLDS, type TrialReminderThreshold } from './trial-email-database';

export type NotificationEmailMessage =
  | {
      kind: 'trial-reminder';
      organizationId: string;
      trialEndDate: string;
      threshold: TrialReminderThreshold;
      asOf: string;
    }
  | { kind: 'trial-ended'; organizationId: string; trialEndDate: string }
  | { kind: 'credit-claim-follow-up'; organizationId: string; claimId: number };

function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isTrialReminderThreshold(value: unknown): value is TrialReminderThreshold {
  return (TRIAL_REMINDER_THRESHOLDS as readonly number[]).includes(value as number);
}

function parseTrialReminder(
  record: Record<string, unknown>,
  organizationId: string,
): NotificationEmailMessage | null {
  if (!isIsoDateString(record.trialEndDate) || !isIsoDateString(record.asOf)) {
    return null;
  }
  if (!isTrialReminderThreshold(record.threshold)) {
    return null;
  }
  return {
    kind: 'trial-reminder',
    organizationId,
    trialEndDate: record.trialEndDate,
    threshold: record.threshold,
    asOf: record.asOf,
  };
}

function parseTrialEnded(
  record: Record<string, unknown>,
  organizationId: string,
): NotificationEmailMessage | null {
  if (!isIsoDateString(record.trialEndDate)) {
    return null;
  }
  return { kind: 'trial-ended', organizationId, trialEndDate: record.trialEndDate };
}

function parseCreditClaimFollowUp(
  record: Record<string, unknown>,
  organizationId: string,
): NotificationEmailMessage | null {
  if (!isPositiveInteger(record.claimId)) {
    return null;
  }
  return { kind: 'credit-claim-follow-up', organizationId, claimId: record.claimId };
}

/**
 * Validate an inbound queue body. Returns null for anything that is not a
 * well-formed notification message; the consumer acks those rather than
 * retrying a body that will never parse.
 */
export function parseNotificationEmailMessage(body: unknown): NotificationEmailMessage | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const organizationId = record.organizationId;
  if (typeof organizationId !== 'string' || organizationId.length === 0) {
    return null;
  }

  switch (record.kind) {
    case 'trial-reminder':
      return parseTrialReminder(record, organizationId);
    case 'trial-ended':
      return parseTrialEnded(record, organizationId);
    case 'credit-claim-follow-up':
      return parseCreditClaimFollowUp(record, organizationId);
    default:
      return null;
  }
}

/** Both Resend secrets are required — half-configured counts as unconfigured. */
export function isResendConfigured(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL);
}

/**
 * The producer binding, or a throw the dispatcher records as a failed run.
 * Distinct from Resend being unconfigured (a skip): a missing binding means
 * the deployment itself is wrong, which must be loud, not silent.
 */
export function requireNotificationEmailQueue(env: Env): Queue<NotificationEmailMessage> {
  const queue = env.NOTIFICATION_EMAIL_QUEUE;
  if (!queue) {
    throw new Error(
      'NOTIFICATION_EMAIL_QUEUE binding is not configured; notification emails cannot be enqueued.',
    );
  }
  return queue;
}
