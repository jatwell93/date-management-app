// Orchestration for the credit-claim write side on Workers: the send/follow-up/
// outcome flows, R2 photo storage, and the Resend transport. The DB primitives live
// in credit-claim-database.ts; the pure email body and the expected-credit maths live
// in shared/domain/ so this runtime and the Express backend cannot drift.
//
// The Express original is backend/src/services/credit-claim.service.ts. The one
// structural difference: Express wraps finalize-after-send in a transaction, which the
// Neon HTTP driver cannot do, so the finalize here is a single statement (claim row +
// SENT event together). That removes the *partial* finalize — either the statement
// lands or it does not — but it does NOT remove the stuck-SENDING problem: the
// statement can still fail outright after the supplier has been emailed. So the
// backend's compensation and its loud `sending-stuck` alert are mirrored below rather
// than dropped; see `reportStuckSending`.

import type { R2Bucket } from '@cloudflare/workers-types';
import * as Sentry from '@sentry/cloudflare';
import {
  isChaseableClaimStatus,
  isSettledClaimStatus,
  nextFollowUp,
} from '../../shared/domain/credit-claim';
import { renderClaimEmail } from '../../shared/domain/credit-claim-email';
import type { ClaimOutcome, ClaimWriteResult } from './credit-claim-database';
import type { CreditClaim, CreditClaimPhoto, Database } from './database';
import type { Env } from './types/env';

/** Days a settled claim's photos are retained before the purge job deletes them. */
export const PHOTO_RETENTION_DAYS = 90;

/** R2 key prefix for claim photos, inside the shared uploads bucket. */
const PHOTO_KEY_PREFIX = 'credit-claims';

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/**
 * Photo types the claim email may carry to a supplier. Mirrors the multer
 * `fileFilter` on the Express route so neither runtime can attach an arbitrary file.
 */
const ALLOWED_PHOTO_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

function fail<T>(
  code: 'NOT_FOUND' | 'VALIDATION' | 'CONFLICT',
  message: string,
): ClaimWriteResult<T> {
  return { ok: false, code, message };
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Make an uploaded filename safe to embed in an R2 key: drop any path segments and
 * reduce to a conservative charset so a crafted name cannot escape the claim's key
 * prefix. The original name is still stored verbatim in the DB for display and for
 * the email attachment. Byte-for-byte the backend's `sanitizeKeySegment`.
 */
export function sanitizeKeySegment(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.slice(0, 100) || 'photo';
}

/** Base64 for an ArrayBuffer — Workers has no Buffer, and btoa needs a binary string. */
function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  // Chunked so a large photo does not blow the argument limit of String.fromCharCode.
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Parse a timestamp read back from the DB. `sent_at::text` on a `timestamp(3)`
 * column has no timezone designator, and `new Date` reads such a string as *local*
 * time — correct on Workers only because its clock is UTC. Pin UTC explicitly so the
 * follow-up schedule does not depend on the runtime's timezone (the pglite harness
 * uses TIMESTAMPTZ and does emit an offset, so both shapes must work).
 */
export function parseDbTimestamp(value: string): Date {
  const hasZone = /(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(value.trim());
  return new Date(hasZone ? value : `${value.trim().replace(' ', 'T')}Z`);
}

export interface ClaimEmailAttachment {
  filename: string;
  content: ArrayBuffer;
  contentType: string;
}

export interface ClaimEmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: ClaimEmailAttachment[];
}

/**
 * Send via the Resend REST API using `fetch` — no Node SDK, which is the whole reason
 * the Express router could not be reused here. Returns false (rather than throwing)
 * when unconfigured, so an org without the secret gets the backend's
 * "provider is not configured" validation error instead of a 500.
 */
export async function sendClaimEmail(env: Env, message: ClaimEmailMessage): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[CreditClaim] RESEND_API_KEY not set; claim email not sent.');
    return false;
  }

  const body: Record<string, unknown> = {
    from: env.RESEND_FROM_EMAIL || 'noreply@example.com',
    to: [message.to],
    subject: message.subject,
    html: message.html,
    text: message.text,
  };
  if (message.attachments?.length) {
    body.attachments = message.attachments.map((a) => ({
      filename: a.filename,
      content: toBase64(a.content),
      content_type: a.contentType,
    }));
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Resend send failed (${response.status}): ${detail}`);
  }
  return true;
}

function photoBucket(env: Env): R2Bucket {
  return env.CSV_UPLOADS;
}

/**
 * A claim left in SENDING cannot be moved by any route: `reserveClaimForSending`
 * needs DRAFT, follow-ups need a chaseable status, `recordOutcome` refuses anything
 * that is neither chaseable nor `PARTIALLY_CREDITED`, and `revertClaimToDraft` is
 * only reachable from inside `sendClaim`'s own failure paths. It therefore needs
 * manual reconciliation, and the one thing that must never happen is for it to be
 * silent. Same posture — and the same Sentry tags — as the backend.
 */
function reportStuckSending(
  organizationId: string,
  claimId: number,
  error: unknown,
  originalError?: string,
): void {
  console.error(
    `[CreditClaim] Claim ${claimId} stuck in SENDING (org ${organizationId}): ${String(error)}`,
  );
  Sentry.captureException(error, {
    level: 'error',
    tags: { feature: 'credit-claim-send', event: 'sending-stuck' },
    extra: { organizationId, claimId, originalError },
  });
}

/**
 * Give a reservation back after a send that never happened. Best-effort: the claim
 * being stuck in SENDING is worth reporting but must not replace the refusal the
 * caller is about to receive with a database error.
 */
async function releaseReservation(
  db: Database,
  organizationId: string,
  claimId: number,
  reason: string,
): Promise<void> {
  try {
    await db.revertClaimToDraft(organizationId, claimId);
  } catch (error) {
    reportStuckSending(organizationId, claimId, error, reason);
  }
}

async function loadAttachments(
  db: Database,
  env: Env,
  organizationId: string,
  claimId: number,
): Promise<ClaimEmailAttachment[]> {
  const photos = await db.listClaimPhotoKeys(organizationId, claimId);
  // Independent reads, fetched together: this runs before every claim email, so a
  // claim with several photos would otherwise pay one R2 round-trip each, serially,
  // on the latency-critical send path. Order is preserved by `map`, so attachments
  // still follow line/photo id order.
  const fetched = await Promise.all(
    photos.map(async (photo) => ({
      photo,
      object: await photoBucket(env).get(photo.storageKey),
    })),
  );
  const attachments: ClaimEmailAttachment[] = [];
  for (const { photo, object } of fetched) {
    if (!object) continue; // Already purged; send the claim without it rather than fail.
    attachments.push({
      filename: photo.fileName,
      content: await object.arrayBuffer(),
      contentType: 'application/octet-stream',
    });
  }
  return attachments;
}

/**
 * Store a claim-line photo in R2 and record its metadata. The caller must have
 * already rejected a missing file — see `handleAddClaimPhoto`, which mirrors the
 * Express controller's reject-before-work ordering.
 */
export async function uploadClaimPhoto(
  db: Database,
  env: Env,
  organizationId: string,
  claimId: number,
  lineId: number,
  file: File,
): Promise<ClaimWriteResult<CreditClaimPhoto>> {
  if (file.size > MAX_PHOTO_BYTES) {
    return fail('VALIDATION', `Photo exceeds the ${MAX_PHOTO_BYTES} byte limit.`);
  }
  const contentType = file.type.toLowerCase();
  if (!ALLOWED_PHOTO_MIME_TYPES.has(contentType)) {
    return fail(
      'VALIDATION',
      `Unsupported photo type: ${file.type || 'unknown'}. Upload an image.`,
    );
  }

  const key = `${PHOTO_KEY_PREFIX}/${organizationId}/${claimId}/${lineId}/${crypto.randomUUID()}-${sanitizeKeySegment(file.name)}`;
  const bytes = await file.arrayBuffer();
  await photoBucket(env).put(key, bytes, { httpMetadata: { contentType } });

  const recorded = await db.addCreditClaimPhoto(organizationId, claimId, lineId, {
    storageKey: key,
    fileName: file.name,
    sizeBytes: file.size,
  });
  if (!recorded.ok) {
    // The row was refused (wrong org, missing line, or the claim is no longer a
    // draft), so the bytes are orphaned. Drop them rather than leave an object that
    // nothing references and the purge job will never see.
    await photoBucket(env)
      .delete(key)
      .catch(() => undefined);
  }
  return recorded;
}

/**
 * Send a draft claim to its supplier. The DRAFT→SENDING reservation is a single-row
 * CAS, so exactly one concurrent caller emails the supplier; `sentAt` and the first
 * follow-up are written only after the provider accepts.
 */
export async function sendClaim(
  db: Database,
  env: Env,
  organizationId: string,
  id: number,
  now: () => Date = () => new Date(),
): Promise<ClaimWriteResult<CreditClaim>> {
  const claim = await db.findCreditClaim(organizationId, id);
  if (!claim) return fail('NOT_FOUND', `Claim ${id} not found`);
  if (claim.status !== 'DRAFT') return fail('VALIDATION', `Claim ${id} has already been sent.`);
  if (claim.lines.length === 0) {
    return fail('VALIDATION', 'A claim needs at least one line before sending.');
  }
  const to = claim.contactEmailSnapshot || claim.supplier.contactEmail;
  if (!to) {
    return fail('VALIDATION', 'The supplier has no contact email; add one before sending.');
  }

  const reserved = await db.reserveClaimForSending(organizationId, id);
  if (!reserved) {
    return fail('CONFLICT', `Claim ${id} has already been sent or is currently sending.`);
  }

  try {
    const email = renderClaimEmail(claim);
    const attachments = await loadAttachments(db, env, organizationId, id);
    const accepted = await sendClaimEmail(env, { to, ...email, attachments });
    if (!accepted) {
      // The revert is itself a network call. If it fails the claim is stuck in
      // SENDING, so report that rather than letting the DB error replace the
      // caller's "not configured" answer with an opaque 500.
      await releaseReservation(db, organizationId, id, 'provider-not-configured');
      return fail('VALIDATION', 'Email provider is not configured; claim was not sent.');
    }
  } catch (error) {
    await releaseReservation(db, organizationId, id, 'send-failed');
    throw error;
  }

  const sentAt = now();
  const finalize = () =>
    db.finalizeSentClaim(organizationId, id, {
      contactEmail: to,
      sentAt,
      nextFollowUpAt: nextFollowUp(sentAt, claim.supplier.followUpDays, 0),
    });

  try {
    await finalize();
  } catch (error) {
    // The supplier has the email. Reverting to DRAFT here would let someone send it
    // again, so the only safe moves are to retry the finalize or to shout. Mirrors
    // the compensation in backend/src/services/credit-claim.service.ts.
    //
    // Retrying a write is only safe because `finalizeSentClaim` is idempotent (it is
    // gated on status = 'SENDING'). Issue #487 is the standing warning here: a
    // statement that times out *after* the server committed it would otherwise be
    // applied twice — in this case appending a second SENT event to the timeline.
    try {
      await finalize();
    } catch (retryError) {
      reportStuckSending(organizationId, id, retryError, String(error));
      throw error;
    }
  }

  const updated = await db.findCreditClaim(organizationId, id);
  if (!updated) return fail('NOT_FOUND', `Claim ${id} not found`);
  return { ok: true, value: updated };
}

/** Send a follow-up nudge and advance the schedule. */
export async function sendFollowUp(
  db: Database,
  env: Env,
  organizationId: string,
  id: number,
): Promise<ClaimWriteResult<CreditClaim>> {
  const claim = await db.findCreditClaim(organizationId, id);
  if (!claim) return fail('NOT_FOUND', `Claim ${id} not found`);
  if (!isChaseableClaimStatus(claim.status) || !claim.sentAt) {
    return fail('VALIDATION', `Claim ${id} is not awaiting a supplier response.`);
  }
  const to = claim.contactEmailSnapshot || claim.supplier.contactEmail;
  if (!to) return fail('VALIDATION', 'The supplier has no contact email.');

  const nextCount = claim.followUpCount + 1;
  const sentAt = parseDbTimestamp(claim.sentAt);
  const nextFollowUpAt = nextFollowUp(sentAt, claim.supplier.followUpDays, nextCount);

  // Reserve the slot before sending, keyed on the counter the caller observed, so an
  // overlapping cron tick and a manual nudge cannot both email the supplier.
  const reserved = await db.reserveFollowUp(organizationId, id, claim.followUpCount, {
    followUpCount: nextCount,
    nextFollowUpAt,
  });
  if (!reserved) return fail('CONFLICT', `Claim ${id} follow-up is already in progress.`);

  const restore = () =>
    db
      .restoreFollowUpSchedule(organizationId, id, {
        followUpCount: claim.followUpCount,
        nextFollowUpAt: claim.nextFollowUpAt,
      })
      .catch(() => undefined);

  try {
    const email = renderClaimEmail(claim, { followUp: true });
    const attachments = await loadAttachments(db, env, organizationId, id);
    const accepted = await sendClaimEmail(env, { to, ...email, attachments });
    if (!accepted) {
      await restore();
      return fail('VALIDATION', 'Email provider is not configured; follow-up was not sent.');
    }
  } catch (error) {
    // Rolled back to what we observed so the reminder engine retries this claim next
    // run rather than silently skipping it.
    await restore();
    throw error;
  }

  await db.addCreditClaimEvent(organizationId, id, 'FOLLOW_UP_SENT', null);
  const updated = await db.findCreditClaim(organizationId, id);
  if (!updated) return fail('NOT_FOUND', `Claim ${id} not found`);
  return { ok: true, value: updated };
}

/**
 * Record a supplier outcome. Credited/partially-credited/rejected settle the claim,
 * stop follow-ups, and schedule photo deletion after the retention window.
 */
export async function recordOutcome(
  db: Database,
  organizationId: string,
  id: number,
  outcome: ClaimOutcome,
  creditedValue: number | null,
  note: string | null,
  now: () => Date = () => new Date(),
): Promise<ClaimWriteResult<CreditClaim>> {
  const claim = await db.findCreditClaim(organizationId, id);
  if (!claim) return fail('NOT_FOUND', `Claim ${id} not found`);
  if (claim.status === 'DRAFT') {
    return fail('VALIDATION', 'Cannot record an outcome for a claim that was never sent.');
  }
  // Terminal outcomes are final. PARTIALLY_CREDITED is intentionally left open so a
  // later top-up can progress it to CREDITED — the one settled status that still
  // accepts an outcome.
  if (isSettledClaimStatus(claim.status) && claim.status !== 'PARTIALLY_CREDITED') {
    return fail(
      'VALIDATION',
      `Claim ${id} is already settled (${claim.status}); its outcome is final.`,
    );
  }
  if (!isChaseableClaimStatus(claim.status) && claim.status !== 'PARTIALLY_CREDITED') {
    return fail('VALIDATION', `Claim ${id} is not awaiting a supplier outcome.`);
  }

  const settledAt = now();
  await db.recordClaimOutcome(
    organizationId,
    id,
    outcome,
    creditedValue,
    note,
    settledAt,
    addDays(settledAt, PHOTO_RETENTION_DAYS),
  );

  const updated = await db.findCreditClaim(organizationId, id);
  if (!updated) return fail('NOT_FOUND', `Claim ${id} not found`);
  return { ok: true, value: updated };
}
