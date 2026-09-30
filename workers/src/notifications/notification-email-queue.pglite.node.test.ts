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

      const second = message(reminderBody());
      await handleNotificationEmailQueue(batchOf(second), RESEND_ENV, db);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(second.ack).toHaveBeenCalledTimes(1);
      expect(second.retry).not.toHaveBeenCalled();
      expect(await trialEventIds()).toEqual([trialReminderSentEventId(ORG, TRIAL_END_ISO, 5)]);
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
