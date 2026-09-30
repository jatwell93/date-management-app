/**
 * Real-SQL (pglite) coverage for the `trial-emails` scheduled job — task 3.3b.
 *
 * Asserted here because only SQL can prove it: the reminder/ended candidate
 * windows over `subscription_tiers` + `organizations.contact_email`, the
 * threshold bucketing (smallest covering threshold wins, so a missed day still
 * sends exactly one reminder), the `trial_events` dedupe via
 * `id = ANY($ids)` (the TEXT PK doubles as the reservation id), the
 * Resend-unconfigured skip vs missing-binding throw, and `sendBatch` chunking.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../types/env';
import {
  createPgliteHarness,
  createTaggedSql,
  type PgliteHarness,
} from '../../__tests__/pglite-db';
import {
  trialReminderSentEventId,
  type TrialReminderThreshold,
} from '../../notifications/trial-email-database';
import type { NotificationEmailMessage } from '../../notifications/messages';
import { trialEmailsJob } from './trial-emails';
import type { SqlClient } from '../schedule';

const AS_OF = new Date('2026-10-01T00:00:00.000Z');
const AS_OF_ISO = AS_OF.toISOString();
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isoDaysFromAsOf(days: number): string {
  return new Date(AS_OF.getTime() + days * MS_PER_DAY).toISOString();
}

function envWith(queue: { sendBatch: ReturnType<typeof vi.fn> }): Env {
  return {
    NODE_ENV: 'test',
    RESEND_API_KEY: 'test-key',
    RESEND_FROM_EMAIL: 'billing@example.test',
    NOTIFICATION_EMAIL_QUEUE: queue,
  } as unknown as Env;
}

describe('trial-emails job (pglite)', () => {
  let harness: PgliteHarness;
  let sql: SqlClient;
  let sendBatch: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    sendBatch = vi.fn().mockResolvedValue({});
    await sql`DELETE FROM trial_events`;
    await sql`DELETE FROM subscription_tiers`;
    await sql`DELETE FROM organizations`;
  });

  async function seedOrg(
    orgId: string,
    opts: {
      contactEmail?: string | null;
      status?: string;
      trialEndDays?: number | null;
    } = {},
  ): Promise<void> {
    const end =
      opts.trialEndDays === undefined || opts.trialEndDays === null
        ? null
        : isoDaysFromAsOf(opts.trialEndDays);
    await sql`
      INSERT INTO organizations (id, name, slug, contact_email, updated_at)
      VALUES (${orgId}, ${'Org ' + orgId}, ${orgId.replace(/_/g, '-')}, ${
        opts.contactEmail === undefined ? 'billing@example.test' : opts.contactEmail
      }, NOW())`;
    await sql`
      INSERT INTO subscription_tiers (organization_id, tier_level, status, trial_end_date, updated_at)
      VALUES (${orgId}, 'professional', ${opts.status ?? 'trialing'},
              ${end}::timestamp, NOW())`;
  }

  /** Every message body the fake queue was handed, flattened across chunks. */
  function enqueuedBodies(): NotificationEmailMessage[] {
    return sendBatch.mock.calls.flatMap((call) =>
      (call[0] as Array<{ body: NotificationEmailMessage }>).map((entry) => entry.body),
    );
  }

  it('enqueues one reminder at the smallest covering threshold and one ended notice', async () => {
    await seedOrg('org_10d', { trialEndDays: 9.5 }); // -> threshold 10
    await seedOrg('org_5d', { trialEndDays: 4 }); // -> threshold 5
    await seedOrg('org_2d', { trialEndDays: 1.5 }); // -> threshold 2
    await seedOrg('org_11d', { trialEndDays: 11 }); // outside the window
    await seedOrg('org_ended1', { trialEndDays: -1 }); // ended inside lookback
    await seedOrg('org_ended5', { trialEndDays: -5 }); // ended, outside lookback
    await seedOrg('org_active', { status: 'active', trialEndDays: 3 });
    await seedOrg('org_no_email', { contactEmail: null, trialEndDays: 3 });
    await seedOrg('org_blank_email', { contactEmail: '   ', trialEndDays: 3 });

    const result = await trialEmailsJob.run({ env: envWith({ sendBatch }), sql, asOf: AS_OF });

    expect(result.summary).toEqual({
      remindersEnqueued: 3,
      endedEnqueued: 1,
      alreadySent: 0,
    });
    expect(sendBatch).toHaveBeenCalledTimes(1);

    const bodies = enqueuedBodies();
    const reminders = bodies.filter((b) => b.kind === 'trial-reminder');
    const ended = bodies.filter((b) => b.kind === 'trial-ended');

    const reminderByOrg = new Map(
      reminders.map((r) => [
        r.organizationId,
        { trialEndDate: r.trialEndDate, threshold: (r as { threshold: number }).threshold },
      ]),
    );
    expect(reminderByOrg.get('org_10d')).toEqual({
      trialEndDate: isoDaysFromAsOf(9.5),
      threshold: 10,
    });
    expect(reminderByOrg.get('org_5d')).toEqual({
      trialEndDate: isoDaysFromAsOf(4),
      threshold: 5,
    });
    expect(reminderByOrg.get('org_2d')).toEqual({
      trialEndDate: isoDaysFromAsOf(1.5),
      threshold: 2,
    });
    expect(ended).toEqual([
      {
        kind: 'trial-ended',
        organizationId: 'org_ended1',
        trialEndDate: isoDaysFromAsOf(-1),
      },
    ]);
    // Excluded: out-of-window, stale-ended, non-trialing and unaddressable orgs.
    for (const orgId of [
      'org_11d',
      'org_ended5',
      'org_active',
      'org_no_email',
      'org_blank_email',
    ]) {
      expect(bodies.some((b) => b.organizationId === orgId)).toBe(false);
    }
  });

  it('drops candidates whose dedupe id already exists in trial_events', async () => {
    const endIso = isoDaysFromAsOf(9.5);
    await seedOrg('org_sent', { trialEndDays: 9.5 });
    await seedOrg('org_fresh', { trialEndDays: 9.5 });
    await sql`
      INSERT INTO trial_events (id, organization_id, event_type)
      VALUES (${trialReminderSentEventId('org_sent', endIso, 10 as TrialReminderThreshold)},
              'org_sent', 'trial_reminder_sent')`;

    const result = await trialEmailsJob.run({ env: envWith({ sendBatch }), sql, asOf: AS_OF });

    expect(result.summary).toEqual({
      remindersEnqueued: 1,
      endedEnqueued: 0,
      alreadySent: 1,
    });
    const bodies = enqueuedBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].organizationId).toBe('org_fresh');
  });

  it('skips quietly when Resend is not configured, without enqueueing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await seedOrg('org_2d', { trialEndDays: 1.5 });
    const env = { NODE_ENV: 'test', NOTIFICATION_EMAIL_QUEUE: { sendBatch } } as unknown as Env;

    const result = await trialEmailsJob.run({ env, sql, asOf: AS_OF });

    expect(result.summary).toEqual({ skipped: 'resend-not-configured' });
    expect(result.failed).not.toBe(true);
    expect(sendBatch).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('throws when the queue binding is missing even though Resend is configured', async () => {
    const env = {
      NODE_ENV: 'test',
      RESEND_API_KEY: 'test-key',
      RESEND_FROM_EMAIL: 'billing@example.test',
    } as unknown as Env;

    await expect(trialEmailsJob.run({ env, sql, asOf: AS_OF })).rejects.toThrow(
      /NOTIFICATION_EMAIL_QUEUE/,
    );
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('chunks sendBatch calls at 100 messages', async () => {
    // 105 reminder candidates => chunks of 100 + 5. Seeded set-wise so the
    // test stays fast; the per-candidate path is covered by the tests above.
    const count = 105;
    await sql`
      INSERT INTO organizations (id, name, slug, contact_email, updated_at)
      SELECT 'org_bulk_' || g, 'Bulk ' || g, 'bulk-' || g, 'bulk' || g || '@x.test', NOW()
      FROM generate_series(1, ${count}) g`;
    await sql`
      INSERT INTO subscription_tiers (organization_id, tier_level, status, trial_end_date, updated_at)
      SELECT 'org_bulk_' || g, 'professional', 'trialing',
             ${isoDaysFromAsOf(5)}::timestamp, NOW()
      FROM generate_series(1, ${count}) g`;

    const result = await trialEmailsJob.run({ env: envWith({ sendBatch }), sql, asOf: AS_OF });

    expect(result.summary.remindersEnqueued).toBe(count);
    expect(sendBatch).toHaveBeenCalledTimes(2);
    const chunkSizes = sendBatch.mock.calls.map(
      (call) => (call[0] as Array<{ body: unknown }>).length,
    );
    expect(chunkSizes).toEqual([100, 5]);
  });
});
