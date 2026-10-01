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
 *    window. A reservation younger than the resend window — stranded by a
 *    crashed send or a failed release — is re-sent under that same key rather
 *    than skipped, so a leftover marker can never suppress the email entirely.
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
  type TrialEmailContext,
} from './trial-email-database';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type QueueMessage = MessageBatch<unknown>['messages'][number];

type TrialEmailMessage = Extract<
  NotificationEmailMessage,
  { kind: 'trial-reminder' | 'trial-ended' }
>;

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

type TrialMessageValidation =
  | { skip: string }
  | { skip: null; organizationName: string; storedEnd: Date; contactEmail: string };

/**
 * Re-validate a trial message against live state: between enqueue and consume
 * the trial may have converted, been re-dated, or lost its contact address. A
 * stale message acks — retrying it would never change the answer. `now` (not
 * `body.asOf`) decides the ended/not-ended checks: those are about the world,
 * not about payload determinism.
 */
function validateTrialMessage(
  context: TrialEmailContext | null,
  body: TrialEmailMessage,
  now: Date,
): TrialMessageValidation {
  const messageEnd = new Date(body.trialEndDate);
  if (!context) {
    return { skip: 'organization-or-subscription-missing' };
  }
  if (context.status !== 'trialing') {
    return { skip: 'status-not-trialing' };
  }
  const storedEnd = context.trialEndDate;
  if (storedEnd === null || storedEnd.getTime() !== messageEnd.getTime()) {
    return { skip: 'trial-end-date-changed' };
  }
  const contactEmail = context.contactEmail?.trim() ?? '';
  if (contactEmail === '') {
    return { skip: 'no-contact-email' };
  }
  if (body.kind === 'trial-reminder' && now.getTime() >= storedEnd.getTime()) {
    return { skip: 'trial-already-ended' };
  }
  if (body.kind === 'trial-ended' && now.getTime() < storedEnd.getTime()) {
    return { skip: 'trial-not-yet-ended' };
  }
  return { skip: null, organizationName: context.organizationName, storedEnd, contactEmail };
}

/**
 * The reservation row for this message: the `trial_events.id` PK doubles as
 * the Resend Idempotency-Key, and the metadata records what the send asserted.
 */
function trialEventFor(
  body: TrialEmailMessage,
  daysRemaining: number,
): { id: string; eventType: string; metadata: Record<string, unknown> } {
  if (body.kind === 'trial-reminder') {
    return {
      id: trialReminderSentEventId(body.organizationId, body.trialEndDate, body.threshold),
      eventType: 'trial_reminder_sent',
      metadata: {
        threshold: body.threshold,
        daysRemaining,
        trialEndDate: body.trialEndDate,
      },
    };
  }
  return {
    id: trialEndedEmailSentEventId(body.organizationId, body.trialEndDate),
    eventType: 'trial_ended_email_sent',
    metadata: { trialEndDate: body.trialEndDate },
  };
}

function renderTrialEmail(
  body: TrialEmailMessage,
  context: { organizationName: string; trialEndDate: Date },
  daysRemaining: number,
  frontendUrl: string | undefined,
): { subject: string; html: string; text: string } {
  if (body.kind === 'trial-reminder') {
    return renderTrialReminderEmail({
      organizationName: context.organizationName,
      trialEndDate: context.trialEndDate,
      daysRemaining,
      frontendUrl,
    });
  }
  return renderTrialEndedEmail({
    organizationName: context.organizationName,
    trialEndDate: context.trialEndDate,
    frontendUrl,
  });
}

async function handleTrialEmailMessage(
  message: QueueMessage,
  body: TrialEmailMessage,
  env: Env,
  db: Database,
): Promise<void> {
  const context = await findTrialEmailContext(db.sql, body.organizationId);
  const validation = validateTrialMessage(context, body, new Date());
  if (validation.skip !== null) {
    logSkip(body.kind, body.organizationId, validation.skip);
    message.ack();
    return;
  }
  const { organizationName, storedEnd, contactEmail } = validation;

  // daysRemaining comes from the producing tick's asOf, not the consume
  // instant: Resend rejects a reused Idempotency-Key carrying a different
  // payload (409 invalid_idempotent_request), so a retry must render identical
  // text rather than drifting with the wall clock.
  const daysRemaining =
    body.kind === 'trial-reminder'
      ? Math.max(1, Math.ceil((storedEnd.getTime() - Date.parse(body.asOf)) / MS_PER_DAY))
      : 0;
  const event = trialEventFor(body, daysRemaining);

  const reservation = await reserveTrialEmailEvent(db.sql, {
    id: event.id,
    organizationId: body.organizationId,
    eventType: event.eventType,
    metadata: event.metadata,
  });
  if (reservation === 'taken') {
    logSkip(body.kind, body.organizationId, 'already-sent');
    message.ack();
    return;
  }
  // 'recent' means a marker already exists but is too young to trust as
  // "already sent" — it was stranded by a crashed send or a failed release.
  // Re-send under the same Idempotency-Key (Resend replays rather than
  // double-sends), but the row is not ours: this delivery must never delete a
  // marker whose original send may have actually landed.
  const ownsReservation = reservation === 'reserved';
  if (!ownsReservation) {
    console.log(
      JSON.stringify({
        event: 'notification_email_resend_under_key',
        kind: body.kind,
        organizationId: body.organizationId,
        reservationId: event.id,
      }),
    );
  }

  // From here on the reservation exists. A send that never happened — the
  // provider refusing as unconfigured, or throwing — must release it, or this
  // notification is permanently suppressed as "already sent" without an email.
  const releaseReservation = async (): Promise<void> => {
    if (!ownsReservation) {
      return;
    }
    try {
      await deleteTrialEmailEvent(db.sql, event.id);
    } catch (deleteError) {
      // Not silent suppression: a redelivery inside the resend window heals a
      // stranded marker by re-sending under the same key. Still loud — a heap
      // of these would mean the heal path is doing real work every day.
      Sentry.captureException(deleteError, {
        tags: { feature: 'notification-email', action: 'release-reservation' },
        extra: {
          kind: body.kind,
          organizationId: body.organizationId,
          reservationId: event.id,
        },
      });
    }
  };

  const rendered = renderTrialEmail(
    body,
    { organizationName, trialEndDate: storedEnd },
    daysRemaining,
    env.FRONTEND_URL,
  );

  try {
    const accepted = await sendClaimEmail(
      env,
      { to: contactEmail, ...rendered },
      { idempotencyKey: event.id },
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
