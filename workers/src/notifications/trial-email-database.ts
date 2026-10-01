/**
 * SQL for the notification-email feature (task 3.3b): the candidate queries the
 * `trial-emails` job runs, the `trial_events` dedupe lookups both sides share,
 * and the consumer's context load + reservation writes.
 *
 * `trial_end_date` reads come back as `::text` and are parsed with
 * `parseDbTimestamp` — the column is `TIMESTAMP(3)` without a zone, so an
 * unpinned `new Date` would read it as local time and skew both the threshold
 * buckets and the stale-message comparison.
 *
 * The "trial ended" query is deliberately lookback-bounded: nothing writes a
 * downgrade, so expired trials keep `status = 'trialing'` forever and an
 * unbounded query would re-select every trial ever created on every run.
 */
import type { NeonQueryFunction } from '@neondatabase/serverless';
import { parseDbTimestamp } from '../credit-claim-service';

type Sql = NeonQueryFunction<false, false>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const TRIAL_REMINDER_THRESHOLDS = [2, 5, 10] as const;
export type TrialReminderThreshold = (typeof TRIAL_REMINDER_THRESHOLDS)[number];

/** Days a just-ended trial remains eligible for the "your trial has ended" email. */
export const TRIAL_ENDED_LOOKBACK_DAYS = 3;

/**
 * Minutes for which a `trial_events` reservation is *not* trusted as
 * "already sent". A reservation younger than this is re-sent under the same
 * Resend Idempotency-Key — within Resend's 24h key retention a reused key
 * replays the original response without sending a duplicate — so a
 * reservation stranded by a crashed send or a failed release cannot suppress
 * the email. The window must cover the queue's retry span (max_retries 5 ×
 * retry_delay 60 s in wrangler.toml) and stay far below 24h.
 */
export const TRIAL_RESERVATION_RESEND_WINDOW_MINUTES = 60;

export interface TrialEmailCandidate {
  organizationId: string;
  organizationName: string;
  contactEmail: string;
  trialEndDate: Date;
}

interface TrialCandidateRow {
  organizationId: string;
  organizationName: string;
  contactEmail: string;
  trialEndDate: string;
}

function toCandidate(row: TrialCandidateRow): TrialEmailCandidate {
  return {
    organizationId: String(row.organizationId),
    organizationName: String(row.organizationName),
    contactEmail: String(row.contactEmail),
    trialEndDate: parseDbTimestamp(row.trialEndDate),
  };
}

/**
 * The dedupe/reservation ids — the `trial_events.id` primary key is a TEXT the
 * writer chooses, so the id *is* the idempotency key for both the enqueue-time
 * filter and the consumer's `ON CONFLICT DO NOTHING` reservation. The trial end
 * is part of the id so a new trial after conversion is never swallowed by the
 * old trial's sent marker.
 */
export function trialReminderSentEventId(
  organizationId: string,
  trialEndIso: string,
  threshold: TrialReminderThreshold,
): string {
  return `trial_reminder_sent:${organizationId}:${trialEndIso}:${threshold}`;
}

export function trialEndedEmailSentEventId(organizationId: string, trialEndIso: string): string {
  return `trial_ended_email_sent:${organizationId}:${trialEndIso}`;
}

/**
 * Trials whose end falls inside `(window.after, window.atOrBefore]`, soonest
 * first, across all organizations. Organizations with a blank `contact_email`
 * cannot be emailed and are filtered in SQL rather than selected and dropped.
 * One SELECT for both windows so the join and the address filter cannot drift.
 */
async function listTrialCandidatesEndingIn(
  sql: Sql,
  window: { after: Date; atOrBefore: Date },
  limit: number,
): Promise<TrialEmailCandidate[]> {
  const rows = (await sql`
    SELECT st.organization_id AS "organizationId",
           o.name AS "organizationName",
           o.contact_email AS "contactEmail",
           st.trial_end_date::text AS "trialEndDate"
    FROM subscription_tiers st
    JOIN organizations o ON o.id = st.organization_id
    WHERE st.status = 'trialing'
      AND st.trial_end_date > ${window.after.toISOString()}::timestamp
      AND st.trial_end_date <= ${window.atOrBefore.toISOString()}::timestamp
      AND trim(coalesce(o.contact_email, '')) <> ''
    ORDER BY st.trial_end_date ASC
    LIMIT ${limit}
  `) as TrialCandidateRow[];
  return rows.map(toCandidate);
}

/**
 * Trials ending inside the widest reminder window — `trial_end_date` in
 * `(asOf, asOf + TRIAL_REMINDER_THRESHOLDS max days]`.
 */
export async function listTrialReminderCandidates(
  sql: Sql,
  asOf: Date,
  limit = 500,
): Promise<TrialEmailCandidate[]> {
  return listTrialCandidatesEndingIn(
    sql,
    {
      after: asOf,
      atOrBefore: new Date(asOf.getTime() + Math.max(...TRIAL_REMINDER_THRESHOLDS) * MS_PER_DAY),
    },
    limit,
  );
}

/**
 * Trials whose end passed inside the lookback window — `trial_end_date` in
 * `(asOf - TRIAL_ENDED_LOOKBACK_DAYS days, asOf]`. The bound is what makes the
 * query safe against rows that are 'trialing' forever — see the file comment.
 */
export async function listTrialEndedCandidates(
  sql: Sql,
  asOf: Date,
  limit = 500,
): Promise<TrialEmailCandidate[]> {
  return listTrialCandidatesEndingIn(
    sql,
    {
      after: new Date(asOf.getTime() - TRIAL_ENDED_LOOKBACK_DAYS * MS_PER_DAY),
      atOrBefore: asOf,
    },
    limit,
  );
}

/**
 * The reminder threshold a candidate is due at `asOf`: the smallest of
 * 10/5/2 days that still covers the remaining time. Picking the *smallest*
 * matching threshold means a missed day still sends (a 1.5-day-out trial gets
 * the 2-day reminder) and exactly one reminder goes out per candidate.
 */
export function reminderThresholdFor(
  trialEndDate: Date,
  asOf: Date,
): TrialReminderThreshold | null {
  const daysRemaining = (trialEndDate.getTime() - asOf.getTime()) / MS_PER_DAY;
  for (const threshold of TRIAL_REMINDER_THRESHOLDS) {
    if (daysRemaining <= threshold) {
      return threshold;
    }
  }
  return null;
}

/**
 * Which of the given dedupe ids already exist in `trial_events` — a PK lookup
 * used by the producing job to drop already-sent notifications and by nothing
 * else (the consumer re-checks via the reservation insert itself).
 */
export async function listExistingTrialEventIds(sql: Sql, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) {
    return new Set();
  }
  const rows = (await sql`
    SELECT id FROM trial_events WHERE id = ANY(${ids})
  `) as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

/** The subscription + organization fields the consumer needs to render and address a trial email. */
export interface TrialEmailContext {
  status: string;
  trialEndDate: Date | null;
  organizationName: string;
  contactEmail: string | null;
}

export async function findTrialEmailContext(
  sql: Sql,
  organizationId: string,
): Promise<TrialEmailContext | null> {
  const rows = (await sql`
    SELECT st.status,
           st.trial_end_date::text AS "trialEndDate",
           o.name AS "organizationName",
           o.contact_email AS "contactEmail"
    FROM subscription_tiers st
    JOIN organizations o ON o.id = st.organization_id
    WHERE st.organization_id = ${organizationId}
    LIMIT 1
  `) as Array<{
    status: string;
    trialEndDate: string | null;
    organizationName: string;
    contactEmail: string | null;
  }>;
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    status: String(row.status),
    trialEndDate: row.trialEndDate == null ? null : parseDbTimestamp(row.trialEndDate),
    organizationName: String(row.organizationName),
    contactEmail: row.contactEmail ?? null,
  };
}

/** How a reservation attempt resolved — see `reserveTrialEmailEvent`. */
export type TrialEmailReservation = 'reserved' | 'recent' | 'taken';

/**
 * Reserve a send by inserting the marker row *before* the email goes out —
 * `ON CONFLICT DO NOTHING` makes exactly one concurrent consumer win.
 *
 *  - `'reserved'`: this delivery wrote the marker and owns it — if the send
 *    never happens the caller must release (delete) the row.
 *  - `'taken'`: a marker older than `TRIAL_RESERVATION_RESEND_WINDOW_MINUTES`
 *    already exists — the email already went out (or the send was given up on
 *    long ago); the caller must skip.
 *  - `'recent'`: a marker exists but is younger than the resend window —
 *    stranded by a crashed send or a failed release. The caller re-sends under
 *    the same id (which is also the Resend Idempotency-Key, so a send that
 *    already landed replays rather than double-sends) but does NOT own the
 *    row and must never delete it.
 *
 * One statement: the outer SELECT cannot see the CTE's own insert, so `recent`
 * only reflects a pre-existing row. `occurred_at` is `TIMESTAMP(3) DEFAULT
 * CURRENT_TIMESTAMP` in the session timezone, hence `LOCALTIMESTAMP`.
 */
export async function reserveTrialEmailEvent(
  sql: Sql,
  event: { id: string; organizationId: string; eventType: string; metadata: unknown },
): Promise<TrialEmailReservation> {
  const rows = (await sql`
    WITH ins AS (
      INSERT INTO trial_events (id, organization_id, event_type, metadata)
      VALUES (${event.id}, ${event.organizationId}, ${event.eventType}, ${JSON.stringify(
        event.metadata,
      )})
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    )
    SELECT EXISTS (SELECT 1 FROM ins) AS reserved,
           EXISTS (
             SELECT 1 FROM trial_events
             WHERE id = ${event.id}
               AND occurred_at > LOCALTIMESTAMP - make_interval(mins => ${TRIAL_RESERVATION_RESEND_WINDOW_MINUTES}::int)
           ) AS recent
  `) as Array<{ reserved: boolean; recent: boolean }>;
  const row = rows[0];
  if (row?.reserved) {
    return 'reserved';
  }
  return row?.recent ? 'recent' : 'taken';
}

/** Release a reservation after a send that never happened (unconfigured provider or provider error). */
export async function deleteTrialEmailEvent(sql: Sql, id: string): Promise<void> {
  await sql`DELETE FROM trial_events WHERE id = ${id}`;
}
