/**
 * Real-SQL (pglite) coverage for the notification-email queue consumer —
 * task 3.3b. What only real SQL proves here:
 *
 *  - the `trial_events` reservation (`INSERT ... ON CONFLICT DO NOTHING`) is
 *    what dedupes a redelivered message, and is *released* again when the send
 *    never happened (provider unconfigured or throwing);
 *  - `sendFollowUp`'s `requireDueAt` re-check turns a duplicated follow-up
 *    delivery into a no-email skip once the first nudge advanced the schedule;
 *  - a provider throw inside the follow-up path restores the follow-up
 *    schedule, so retry() cannot strand the claim.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCreditClaimDatabase } from '../credit-claim-database';
import type { Database } from '../database';
import type { Env } from '../types/env';
import {
  createPgliteHarness,
  createTaggedSql,
  seedOrganization,
  type PgliteHarness,
} from '../__tests__/pglite-db';
import { handleNotificationEmailQueue } from './notification-email-queue';
import { trialEndedEmailSentEventId, trialReminderSentEventId } from './trial-email-database';
import type { SqlClient } from '../scheduled/schedule';

const sentryCalls = vi.hoisted(() => ({ exceptions: [] as unknown[] }));

vi.mock('@sentry/cloudflare', () => ({
  captureException: (error: unknown, context?: unknown) => {
    sentryCalls.exceptions.push([error, context]);
  },
}));

const ORG = 'org_notify_1';
const TRIAL_END_TEXT = '2030-06-15 12:00:00';
const TRIAL_END_ISO = '2030-06-15T12:00:00.000Z';

const RESEND_ENV = {
  NODE_ENV: 'test',
  RESEND_API_KEY: 'test-key',
  RESEND_FROM_EMAIL: 'billing@example.test',
  FRONTEND_URL: 'https://app.example.com',
} as unknown as Env;

function message(body: unknown) {
  return { body, attempts: 1, ack: vi.fn(), retry: vi.fn() };
}

function batchOf(...messages: ReturnType<typeof message>[]): MessageBatch<unknown> {
  return {
    queue: 'notification-emails-dev',
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<unknown>;
}

describe('handleNotificationEmailQueue (pglite)', () => {
  let harness: PgliteHarness;
  let sql: SqlClient;
  let db: Database;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    db = { sql, ...createCreditClaimDatabase(sql) } as unknown as Database;
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    sentryCalls.exceptions.length = 0;
    await sql`DELETE FROM trial_events`;
    await sql`DELETE FROM subscription_tiers`;
    await sql`DELETE FROM credit_claim_events`;
    await sql`DELETE FROM credit_claim_lines`;
    await sql`DELETE FROM credit_claims`;
    await sql`DELETE FROM suppliers`;
    await sql`DELETE FROM organizations`;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function seedTrial(
    orgId: string,
    opts: { contactEmail?: string | null; status?: string; trialEnd?: string | null } = {},
  ): Promise<void> {
    await seedOrganization(harness.pg, orgId);
    await sql`
      UPDATE organizations SET contact_email = ${
        opts.contactEmail === undefined ? 'owner@example.test' : opts.contactEmail
      }
      WHERE id = ${orgId}`;
    await sql`
      INSERT INTO subscription_tiers (organization_id, tier_level, status, trial_end_date, updated_at)
      VALUES (${orgId}, 'professional', ${opts.status ?? 'trialing'},
              ${opts.trialEnd === undefined ? TRIAL_END_TEXT : opts.trialEnd}::timestamp, NOW())`;
  }

  async function seedDueClaim(orgId: string): Promise<number> {
    await seedOrganization(harness.pg, orgId);
    const supplier = await sql`
      INSERT INTO suppliers (organization_id, name, contact_email, follow_up_days)
      VALUES (${orgId}, 'Supplier A', 'supplier@x.test', 7)
      RETURNING id`;
    const rows = await sql`
      INSERT INTO credit_claims (organization_id, supplier_id, status, sent_at, next_follow_up_at)
      VALUES (${orgId}, ${Number(supplier[0].id)}, 'SENT',
              NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 minute')
      RETURNING id`;
    return Number(rows[0].id);
  }

  async function trialEventIds(): Promise<string[]> {
    const rows = (await sql`SELECT id FROM trial_events ORDER BY id`) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  }

  function sentEmailInit(): RequestInit {
    return fetchMock.mock.calls[0][1] as RequestInit;
  }

  describe('trial-reminder messages', () => {
    const reminderBody = () => ({
      kind: 'trial-reminder',
      organizationId: ORG,
      trialEndDate: TRIAL_END_ISO,
      threshold: 5,
      asOf: '2026-10-01T00:00:00.000Z',
    });

    it('reserves the trial_events row, emails once with the id as Idempotency-Key, and acks', async () => {
      await seedTrial(ORG);
      fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
      const msg = message(reminderBody());

      await handleNotificationEmailQueue(batchOf(msg), RESEND_ENV, db);

      const expectedId = trialReminderSentEventId(ORG, TRIAL_END_ISO, 5);
      expect(await trialEventIds()).toEqual([expectedId]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const headers = (sentEmailInit().headers ?? {}) as Record<string, string>;
      expect(headers['Idempotency-Key']).toBe(expectedId);
      const body = JSON.parse(String(sentEmailInit().body));
      expect(body.to).toEqual(['owner@example.test']);
      expect(body.subject).toContain('free trial ends');
      expect(msg.ack).toHaveBeenCalledTimes(1);
      expect(msg.retry).not.toHaveBeenCalled();
    });

    it('acks a redelivery without emailing again (the reservation already exists)', async () => {
      await seedTrial(ORG);
      fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
      const first = message(reminderBody());
      await handleNotificationEmailQueue(batchOf(first), RESEND_ENV, db);

      // Backdate the marker past the resend window: a reservation younger than
      // TRIAL_RESERVATION_RESEND_WINDOW_MINUTES is deliberately re-sent under
      // the same key (it may have been stranded by a failed release), so the
      // "already sent" skip this test exists to pin only applies to old rows.
      await sql`UPDATE trial_events SET occurred_at = NOW() - INTERVAL '2 hours'`;

      const second = message(reminderBody());
      await handleNotificationEmailQueue(batchOf(second), RESEND_ENV, db);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(second.ack).toHaveBeenCalledTimes(1);
      expect(second.retry).not.toHaveBeenCalled();
      expect(await trialEventIds()).toEqual([trialReminderSentEventId(ORG, TRIAL_END_ISO, 5)]);
    });

    it('re-sends under the same key when a young reservation was left behind by a failed release', async () => {
      await seedTrial(ORG);
      // Simulates a crash or failed delete after the send attempt: the marker
      // row exists with a current occurred_at, but the email may never have
      // landed. A redelivery inside the resend window must re-issue the send —
      // Resend replays under the reused Idempotency-Key if the original did
      // land — rather than suppressing the email as 'already-sent'.
      const eventId = trialReminderSentEventId(ORG, TRIAL_END_ISO, 5);
      await sql`
        INSERT INTO trial_events (id, organization_id, event_type)
        VALUES (${eventId}, ${ORG}, 'trial_reminder_sent')`;
      fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
      const msg = message(reminderBody());

      await handleNotificationEmailQueue(batchOf(msg), RESEND_ENV, db);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const headers = (sentEmailInit().headers ?? {}) as Record<string, string>;
      expect(headers['Idempotency-Key']).toBe(eventId);
      expect(msg.ack).toHaveBeenCalledTimes(1);
      expect(msg.retry).not.toHaveBeenCalled();
      // The delivery does not own the row — it stays put either way.
      expect(await trialEventIds()).toEqual([eventId]);
    });

    it('acks an old reservation as already-sent without emailing', async () => {
      await seedTrial(ORG);
      const eventId = trialReminderSentEventId(ORG, TRIAL_END_ISO, 5);
      await sql`
        INSERT INTO trial_events (id, organization_id, event_type, occurred_at)
        VALUES (${eventId}, ${ORG}, 'trial_reminder_sent', NOW() - INTERVAL '2 hours')`;
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const msg = message(reminderBody());

      await handleNotificationEmailQueue(batchOf(msg), RESEND_ENV, db);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(msg.ack).toHaveBeenCalledTimes(1);
      expect(msg.retry).not.toHaveBeenCalled();
      expect(
        logSpy.mock.calls.some((args) => String(args[0]).includes('"reason":"already-sent"')),
      ).toBe(true);
      logSpy.mockRestore();
    });

    it('retries a resend under the same key when the provider throws, keeping the row', async () => {
      await seedTrial(ORG);
      const eventId = trialReminderSentEventId(ORG, TRIAL_END_ISO, 5);
      await sql`
        INSERT INTO trial_events (id, organization_id, event_type)
        VALUES (${eventId}, ${ORG}, 'trial_reminder_sent')`;
      fetchMock.mockResolvedValue(new Response('provider exploded', { status: 500 }));
      const msg = message(reminderBody());

      await handleNotificationEmailQueue(batchOf(msg), RESEND_ENV, db);

      // The row is not ours to delete: the original send may have landed, so
      // the marker stays and the message retries for another attempt.
      expect(await trialEventIds()).toEqual([eventId]);
      expect(msg.retry).toHaveBeenCalledTimes(1);
      expect(msg.ack).not.toHaveBeenCalled();
      expect(sentryCalls.exceptions.length).toBeGreaterThanOrEqual(1);
    });

    it('acks a resend under the same key when Resend is unconfigured, keeping the row', async () => {
      await seedTrial(ORG);
      const eventId = trialReminderSentEventId(ORG, TRIAL_END_ISO, 5);
      await sql`
        INSERT INTO trial_events (id, organization_id, event_type)
        VALUES (${eventId}, ${ORG}, 'trial_reminder_sent')`;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const msg = message(reminderBody());
      const env = { NODE_ENV: 'test' } as unknown as Env;

      await handleNotificationEmailQueue(batchOf(msg), env, db);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(await trialEventIds()).toEqual([eventId]);
      expect(msg.ack).toHaveBeenCalledTimes(1);
      expect(msg.retry).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('releases the reservation and retries when the provider errors', async () => {
      await seedTrial(ORG);
      fetchMock.mockResolvedValue(new Response('provider exploded', { status: 500 }));
      const msg = message(reminderBody());

      await handleNotificationEmailQueue(batchOf(msg), RESEND_ENV, db);

      // The send never landed, so the marker must be gone — the redelivery
      // has to be allowed to try again rather than skip as already-sent.
      expect(await trialEventIds()).toEqual([]);
      expect(msg.retry).toHaveBeenCalledTimes(1);
      expect(msg.ack).not.toHaveBeenCalled();
      expect(sentryCalls.exceptions).toHaveLength(1);
    });

    it('releases the reservation and acks when Resend is unconfigured', async () => {
      await seedTrial(ORG);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const msg = message(reminderBody());
      const env = { NODE_ENV: 'test' } as unknown as Env;

      await handleNotificationEmailQueue(batchOf(msg), env, db);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(await trialEventIds()).toEqual([]);
      expect(msg.ack).toHaveBeenCalledTimes(1);
      expect(msg.retry).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it.each([
      ['a moved trial end', { trialEnd: '2030-06-20 12:00:00' }],
      ['a non-trialing subscription', { status: 'active' }],
      ['a blank contact email', { contactEmail: '  ' }],
    ])('acks a stale message (%s) without reserving or sending', async (_l, opts) => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await seedTrial(ORG, opts);
      const msg = message(reminderBody());

      await handleNotificationEmailQueue(batchOf(msg), RESEND_ENV, db);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(await trialEventIds()).toEqual([]);
      expect(msg.ack).toHaveBeenCalledTimes(1);
      expect(msg.retry).not.toHaveBeenCalled();
      expect(
        logSpy.mock.calls.some((args) => String(args[0]).includes('notification_email_skipped')),
      ).toBe(true);
      logSpy.mockRestore();
    });

    it('acks a message for a subscription that does not exist', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const msg = message(reminderBody());

      await handleNotificationEmailQueue(batchOf(msg), RESEND_ENV, db);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(msg.ack).toHaveBeenCalledTimes(1);
      logSpy.mockRestore();
    });

    it('renders a byte-identical payload on retry so the Idempotency-Key stays valid', async () => {
      // Resend answers 409 invalid_idempotent_request when a key is reused with
      // a different payload. The producing tick's `asOf` is 3h old by the time
      // this message is consumed — if daysRemaining were computed from the
      // consume-time clock, the retried send would carry different text under
      // the same key and loop all the way to the DLQ.
      const end = new Date(Date.now() + 22 * 60 * 60 * 1000);
      await seedTrial(ORG, { trialEnd: end.toISOString() });
      const body = {
        kind: 'trial-reminder',
        organizationId: ORG,
        trialEndDate: end.toISOString(),
        threshold: 2,
        asOf: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      };

      // First attempt: the provider throws — reservation released, retry.
      fetchMock.mockResolvedValue(new Response('provider exploded', { status: 500 }));
      const first = message(body);
      await handleNotificationEmailQueue(batchOf(first), RESEND_ENV, db);
      expect(first.retry).toHaveBeenCalledTimes(1);
      expect(await trialEventIds()).toEqual([]);
      const firstInit = fetchMock.mock.calls[0][1] as RequestInit;

      // Second consume of the SAME message body hours later in wall-clock
      // terms (asOf is 3h stale): identical request, identical key.
      fetchMock.mockClear();
      fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
      const second = message(body);
      await handleNotificationEmailQueue(batchOf(second), RESEND_ENV, db);

      const secondInit = fetchMock.mock.calls[0][1] as RequestInit;
      expect(secondInit.body).toEqual(firstInit.body);
      expect((secondInit.headers as Record<string, string>)['Idempotency-Key']).toBe(
        (firstInit.headers as Record<string, string>)['Idempotency-Key'],
      );
      // And the subject pins the mechanism: ceil((end − asOf)) = 2 days,
      // while ceil((end − now)) = 1 day — so this only holds when the message's
      // own asOf, not the consume-time clock, drives the rendering.
      expect(JSON.parse(String(secondInit.body)).subject).toBe('Your free trial ends in 2 days');
      expect(second.ack).toHaveBeenCalledTimes(1);
    });

    it('skips a reminder consumed after the trial already ended', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      // The stored end equals the message's (in the past), so the only skip
      // gate left is "reminder but now >= end".
      await seedTrial(ORG, { trialEnd: '2020-01-01 00:00:00' });
      const msg = message({
        kind: 'trial-reminder',
        organizationId: ORG,
        trialEndDate: '2020-01-01T00:00:00.000Z',
        threshold: 2,
        asOf: '2020-01-01T00:00:00.000Z',
      });

      await handleNotificationEmailQueue(batchOf(msg), RESEND_ENV, db);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(await trialEventIds()).toEqual([]);
      expect(msg.ack).toHaveBeenCalledTimes(1);
      logSpy.mockRestore();
    });
  });

  describe('trial-ended messages', () => {
    it('sends the ended email once the trial end has passed', async () => {
      await seedTrial(ORG, { trialEnd: '2020-06-15 12:00:00' });
      fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
      const endIso = '2020-06-15T12:00:00.000Z';
      const msg = message({ kind: 'trial-ended', organizationId: ORG, trialEndDate: endIso });

      await handleNotificationEmailQueue(batchOf(msg), RESEND_ENV, db);

      expect(await trialEventIds()).toEqual([trialEndedEmailSentEventId(ORG, endIso)]);
      const body = JSON.parse(String(sentEmailInit().body));
      expect(body.subject).toBe('Your free trial has ended');
      expect(msg.ack).toHaveBeenCalledTimes(1);
    });

    it('skips a trial-ended message consumed before the trial ends', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      await seedTrial(ORG); // ends 2030 — still running
      const msg = message({
        kind: 'trial-ended',
        organizationId: ORG,
        trialEndDate: TRIAL_END_ISO,
      });

      await handleNotificationEmailQueue(batchOf(msg), RESEND_ENV, db);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(await trialEventIds()).toEqual([]);
      expect(msg.ack).toHaveBeenCalledTimes(1);
      logSpy.mockRestore();
    });
  });

  describe('credit-claim-follow-up messages', () => {
    const followUpBody = (claimId: number) => ({
      kind: 'credit-claim-follow-up',
      organizationId: ORG,
      claimId,
    });

    it('emails the supplier, advances the schedule, and acks', async () => {
      const claimId = await seedDueClaim(ORG);
      fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
      const msg = message(followUpBody(claimId));

      await handleNotificationEmailQueue(batchOf(msg), RESEND_ENV, db);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String(sentEmailInit().body));
      expect(body.subject).toContain('Follow-up');
      expect(body.to).toEqual(['supplier@x.test']);
      const claim = (await sql`
        SELECT follow_up_count AS "count", next_follow_up_at::text AS "next"
        FROM credit_claims WHERE id = ${claimId}
      `) as Array<{ count: number; next: string | null }>;
      expect(claim[0].count).toBe(1);
      expect(claim[0].next).not.toBeNull();
      expect(msg.ack).toHaveBeenCalledTimes(1);
    });

    it('does not email twice when the same message is redelivered after the send', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const claimId = await seedDueClaim(ORG);
      fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

      await handleNotificationEmailQueue(batchOf(message(followUpBody(claimId))), RESEND_ENV, db);
      // The first send advanced next_follow_up_at ~7 days out, so the
      // redelivery arrives for a claim that is no longer due.
      const second = message(followUpBody(claimId));
      await handleNotificationEmailQueue(batchOf(second), RESEND_ENV, db);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const claim = (await sql`
        SELECT follow_up_count AS "count" FROM credit_claims WHERE id = ${claimId}
      `) as Array<{ count: number }>;
      expect(claim[0].count).toBe(1);
      expect(second.ack).toHaveBeenCalledTimes(1);
      expect(second.retry).not.toHaveBeenCalled();
      expect(
        logSpy.mock.calls.some((args) => String(args[0]).includes('notification_email_skipped')),
      ).toBe(true);
      logSpy.mockRestore();
    });

    it('retries on a provider throw and leaves the schedule restored', async () => {
      const claimId = await seedDueClaim(ORG);
      const before = (await sql`
        SELECT follow_up_count AS "count", next_follow_up_at::text AS "next"
        FROM credit_claims WHERE id = ${claimId}
      `) as Array<{ count: number; next: string | null }>;
      fetchMock.mockResolvedValue(new Response('provider exploded', { status: 500 }));
      const msg = message(followUpBody(claimId));

      await handleNotificationEmailQueue(batchOf(msg), RESEND_ENV, db);

      const after = (await sql`
        SELECT follow_up_count AS "count", next_follow_up_at::text AS "next"
        FROM credit_claims WHERE id = ${claimId}
      `) as Array<{ count: number; next: string | null }>;
      // The reservation rolled back to what was observed, so the retry (or the
      // next job tick) can still nudge this claim.
      expect(after[0]).toEqual(before[0]);
      expect(msg.retry).toHaveBeenCalledTimes(1);
      expect(msg.ack).not.toHaveBeenCalled();
      expect(sentryCalls.exceptions.length).toBeGreaterThanOrEqual(1);
    });

    it('acks without sending when the claim no longer exists', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const msg = message(followUpBody(999));

      await handleNotificationEmailQueue(batchOf(msg), RESEND_ENV, db);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(msg.ack).toHaveBeenCalledTimes(1);
      expect(msg.retry).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });
  });

  describe('message isolation', () => {
    it('acks a malformed body and still processes the next message', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await seedTrial(ORG);
      fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
      const bad = message({ nope: true });
      const good = message({
        kind: 'trial-reminder',
        organizationId: ORG,
        trialEndDate: TRIAL_END_ISO,
        threshold: 5,
        asOf: '2026-10-01T00:00:00.000Z',
      });

      await handleNotificationEmailQueue(batchOf(bad, good), RESEND_ENV, db);

      expect(bad.ack).toHaveBeenCalledTimes(1);
      expect(bad.retry).not.toHaveBeenCalled();
      expect(good.ack).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  });
});
