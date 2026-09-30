/**
 * Consumer for `notification-emails-*` queues (task 3.3b): turns the
 * per-recipient messages the `trial-emails` and `credit-claim-follow-ups`
 * jobs enqueue into actual Resend sends.
 *
 * Every send is protected twice against duplicates, because Cloudflare queues
 * are at-least-once:
 *
 *  - **Trial emails** re-read the live subscription row and skip when it no
 *    longer matches the message, then *reserve* a `trial_events` row before
 *    sending — `ON CONFLICT (id) DO NOTHING` means a redelivery or a racing
 *    attempt loses the insert and acks without sending. The reservation id is
 *    also the Resend `Idempotency-Key`, so a retry after a provider error that
 *    Resend actually accepted cannot produce a second email inside its 24h
 *    window.
 *  - **Follow-ups** re-check due-ness inside `sendFollowUp` (`requireDueAt`),
 *    whose counter CAS already serializes concurrent senders.
 *
 * Failure posture mirrors `handleCatalogueImportQueue`: provider/provider-call
 * throws retry (each message is isolated — one failure never stops the batch),
 * everything that means "this message can never or should never send" acks.
 */
import * as Sentry from '@sentry/cloudflare';
import { sendClaimEmail, sendFollowUp } from '../credit-claim-service';
import { createWorkersDatabase, type Database } from '../database';
import type { Env } from '../types/env';
import { parseNotificationEmailMessage, type NotificationEmailMessage } from './messages';
import { renderTrialEndedEmail, renderTrialReminderEmail } from './trial-emails';
import {
  deleteTrialEmailEvent,
  findTrialEmailContext,
  reserveTrialEmailEvent,
  trialEndedEmailSentEventId,
  trialReminderSentEventId,
} from './trial-email-database';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type QueueMessage = MessageBatch<unknown>['messages'][number];

function logSkip(
  kind: NotificationEmailMessage['kind'],
  organizationId: string,
  reason: string,
  extra: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({
      event: 'notification_email_skipped',
      kind,
      organizationId,
      reason,
      ...extra,
    }),
  );
}

async function handleTrialEmailMessage(
  message: QueueMessage,
  body: Extract<NotificationEmailMessage, { kind: 'trial-reminder' | 'trial-ended' }>,
  env: Env,
  db: Database,
): Promise<void> {
  const context = await findTrialEmailContext(db.sql, body.organizationId);
  const messageEnd = new Date(body.trialEndDate);
  const now = new Date();

  // Re-validate against live state: between enqueue and consume the trial may
  // have converted, been re-dated, or lost its contact address. A stale
  // message acks — retrying it would never change the answer.
  const skip = (reason: string): void => {
    logSkip(body.kind, body.organizationId, reason);
    message.ack();
  };

  if (!context) {
    return skip('organization-or-subscription-missing');
  }
  if (context.status !== 'trialing') {
    return skip('status-not-trialing');
  }
  const storedEnd = context.trialEndDate;
  if (storedEnd === null || storedEnd.getTime() !== messageEnd.getTime()) {
    return skip('trial-end-date-changed');
  }
  const contactEmail = context.contactEmail?.trim() ?? '';
  if (contactEmail === '') {
    return skip('no-contact-email');
  }
  if (body.kind === 'trial-reminder' && now.getTime() >= storedEnd.getTime()) {
    return skip('trial-already-ended');
  }
  if (body.kind === 'trial-ended' && now.getTime() < storedEnd.getTime()) {
    return skip('trial-not-yet-ended');
  }

  const daysRemaining = Math.max(1, Math.ceil((storedEnd.getTime() - now.getTime()) / MS_PER_DAY));
  const id =
    body.kind === 'trial-reminder'
      ? trialReminderSentEventId(body.organizationId, body.trialEndDate, body.threshold)
      : trialEndedEmailSentEventId(body.organizationId, body.trialEndDate);

  const reserved = await reserveTrialEmailEvent(db.sql, {
    id,
    organizationId: body.organizationId,
    eventType: body.kind === 'trial-reminder' ? 'trial_reminder_sent' : 'trial_ended_email_sent',
    metadata:
      body.kind === 'trial-reminder'
        ? {
            threshold: body.threshold,
            daysRemaining,
            trialEndDate: body.trialEndDate,
          }
        : { trialEndDate: body.trialEndDate },
  });
  if (!reserved) {
    return skip('already-sent');
  }

  // From here on the reservation exists. A send that never happened — the
  // provider refusing as unconfigured, or throwing — must release it, or this
  // notification is permanently suppressed as "already sent" without an email.
  const releaseReservation = async (): Promise<void> => {
    try {
      await deleteTrialEmailEvent(db.sql, id);
    } catch (deleteError) {
      // The retry/redelivery will then read "already-sent" and skip a send that
      // never went out — silent suppression, so it must be loud.
      Sentry.captureException(deleteError, {
        tags: { feature: 'notification-email', action: 'release-reservation' },
        extra: { kind: body.kind, organizationId: body.organizationId, reservationId: id },
      });
    }
  };

  const rendered =
    body.kind === 'trial-reminder'
      ? renderTrialReminderEmail({
          organizationName: context.organizationName,
          trialEndDate: storedEnd,
          daysRemaining,
          frontendUrl: env.FRONTEND_URL,
        })
      : renderTrialEndedEmail({
          organizationName: context.organizationName,
          trialEndDate: storedEnd,
          frontendUrl: env.FRONTEND_URL,
        });

  try {
    const accepted = await sendClaimEmail(
      env,
      { to: contactEmail, ...rendered },
      { idempotencyKey: id },
    );
    if (!accepted) {
      // Unconfigured provider: not retryable in this deployment, so release
      // the reservation (a configured deploy could still send later) and ack.
      await releaseReservation();
      console.warn(
        JSON.stringify({
          event: 'notification_email_unconfigured',
          kind: body.kind,
          organizationId: body.organizationId,
        }),
      );
      message.ack();
      return;
    }
    message.ack();
  } catch (error) {
    await releaseReservation();
    Sentry.captureException(error, {
      tags: { feature: 'notification-email', action: 'queue-consumer' },
      extra: {
        kind: body.kind,
        organizationId: body.organizationId,
        attempts: message.attempts,
      },
    });
    message.retry();
  }
}

async function handleCreditClaimFollowUpMessage(
  message: QueueMessage,
  body: Extract<NotificationEmailMessage, { kind: 'credit-claim-follow-up' }>,
  env: Env,
  db: Database,
): Promise<void> {
  try {
    // `requireDueAt` re-checks due-ness against the freshly loaded claim — a
    // duplicated message, or one delivered after the claim settled or was
    // nudged by the manual route, resolves to a refusal rather than a second
    // email. A provider throw inside `sendFollowUp` restores the schedule, so
    // retry() here cannot strand the claim's follow-up.
    const result = await sendFollowUp(db, env, body.organizationId, body.claimId, {
      requireDueAt: new Date(),
    });
    if (result.ok) {
      message.ack();
      return;
    }
    // Every refusal code is a permanent answer for this delivery — retrying a
    // NOT_FOUND/VALIDATION/CONFLICT changes nothing and only burns attempts.
    logSkip(body.kind, body.organizationId, result.message, {
      claimId: body.claimId,
      code: result.code,
    });
    message.ack();
  } catch (error) {
    Sentry.captureException(error, {
      tags: { feature: 'notification-email', action: 'queue-consumer' },
      extra: {
        kind: body.kind,
        organizationId: body.organizationId,
        claimId: body.claimId,
        attempts: message.attempts,
      },
    });
    message.retry();
  }
}

export async function handleNotificationEmailQueue(
  batch: MessageBatch<unknown>,
  env: Env,
  db: Database = createWorkersDatabase(env),
): Promise<void> {
  for (const message of batch.messages) {
    const body = parseNotificationEmailMessage(message.body);
    if (!body) {
      // Malformed bodies can never parse — ack rather than burn five retries
      // and a DLQ slot on them.
      console.warn(
        JSON.stringify({
          event: 'notification_email_invalid',
          attempts: message.attempts,
        }),
      );
      message.ack();
      continue;
    }
    try {
      if (body.kind === 'credit-claim-follow-up') {
        await handleCreditClaimFollowUpMessage(message, body, env, db);
      } else {
        await handleTrialEmailMessage(message, body, env, db);
      }
    } catch (error) {
      // Throws the per-kind handlers don't own — the live-state read or the
      // reservation write failing. Retry: the send did not happen.
      Sentry.captureException(error, {
        tags: { feature: 'notification-email', action: 'queue-consumer' },
        extra: {
          kind: body.kind,
          organizationId: body.organizationId,
          attempts: message.attempts,
        },
      });
      message.retry();
    }
  }
}
