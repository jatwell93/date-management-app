/**
 * Real-SQL (pglite) coverage for the scheduled-jobs surface — task 3.3a.
 *
 * What is asserted here is the part that only SQL can be: the lease INSERT's
 * `ON CONFLICT ... WHERE lease_expires_at <= asOf` guard actually refusing a
 * held job, the token-scoped release, the markdown UPDATE's CASE bands over
 * real timestamps, the cross-org purge queries, `webhook_metrics` upsert, and
 * the monitoring job's aggregates. Dispatcher control flow (isJobDue, isolation,
 * kill switch) is unit-covered in `dispatcher.test.ts` against a fake client.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../types/env';
import {
  createPgliteHarness,
  createTaggedSql,
  seedOrganization,
  type PgliteHarness,
} from '../__tests__/pglite-db';

const sentryCalls = vi.hoisted(() => ({ messages: [] as unknown[], exceptions: [] as unknown[] }));

vi.mock('@sentry/cloudflare', () => ({
  withSentry: <T>(_options: unknown, handler: T) => handler,
  captureException: (error: unknown, context?: unknown) => {
    sentryCalls.exceptions.push([error, context]);
  },
  captureMessage: (message: unknown, context?: unknown) => {
    sentryCalls.messages.push([message, context]);
  },
}));

import { acquireJobLease, releaseJobLease } from './dispatcher';
import { markdownRecalculationJob } from './jobs/markdown-recalculation';
import { webhookMonitoringJob } from './jobs/webhook-monitoring';
import { deletePhotoRowById, listPhotosDueForPurgeAcrossOrgs } from '../credit-claim-database';
import { recordWebhookOutcome } from '../webhook-metrics';
import type { ScheduledJob } from './schedule';

const ORG = 'org_sched_1';
const OTHER_ORG = 'org_sched_2';
const AS_OF = new Date('2026-10-01T00:00:00.000Z');
const AS_OF_ISO = AS_OF.toISOString();

const ENV = { NODE_ENV: 'test' } as unknown as Env;

const LEASE_JOB: ScheduledJob = {
  name: 'lease-probe',
  cadence: { kind: 'hourly' },
  leaseSeconds: 300,
  run: async () => ({ summary: {} }),
};

describe('scheduled jobs (pglite)', () => {
  let harness: PgliteHarness;
  let sql: ReturnType<typeof createTaggedSql>;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    sentryCalls.messages.length = 0;
    sentryCalls.exceptions.length = 0;
    await sql`DELETE FROM scheduled_job_runs`;
    await sql`DELETE FROM webhook_metrics`;
    await sql`DELETE FROM processed_webhook_events`;
    await sql`DELETE FROM credit_claim_photos`;
    await sql`DELETE FROM credit_claim_lines`;
    await sql`DELETE FROM credit_claims`;
    await sql`DELETE FROM expired_item_transactions`;
    await sql`DELETE FROM inventory_items`;
    await sql`DELETE FROM products`;
    await sql`DELETE FROM suppliers`;
    await sql`DELETE FROM store_areas`;
    await sql`DELETE FROM organizations`;
  });

  describe('job lease (scheduled_job_runs)', () => {
    it('first acquire creates the row; a second acquire at the same tick loses', async () => {
      expect(await acquireJobLease(sql, LEASE_JOB, 'tok-a', AS_OF_ISO)).toBe(true);
      // Same tick, different token: the lease is live until asOf + 300s.
      expect(await acquireJobLease(sql, LEASE_JOB, 'tok-b', AS_OF_ISO)).toBe(false);

      const rows =
        (await sql`SELECT * FROM scheduled_job_runs WHERE job_name = 'lease-probe'`) as Array<{
          lease_token: string;
          last_status: string;
        }>;
      expect(rows).toHaveLength(1);
      expect(rows[0].lease_token).toBe('tok-a');
      expect(rows[0].last_status).toBe('running');
    });

    it('a new tick takes over once the lease has expired', async () => {
      await acquireJobLease(sql, LEASE_JOB, 'tok-a', AS_OF_ISO);
      const later = new Date(AS_OF.getTime() + 301 * 1000).toISOString();
      expect(await acquireJobLease(sql, LEASE_JOB, 'tok-b', later)).toBe(true);
      const rows =
        (await sql`SELECT lease_token FROM scheduled_job_runs WHERE job_name = 'lease-probe'`) as Array<{
          lease_token: string;
        }>;
      expect(rows[0].lease_token).toBe('tok-b');
    });

    it('release with a stale token is a no-op; the right token records success', async () => {
      await acquireJobLease(sql, LEASE_JOB, 'tok-a', AS_OF_ISO);

      // An older tick's release arrives after a newer tick claimed the job.
      await releaseJobLease(sql, 'lease-probe', 'stale-token', AS_OF_ISO, true, null);
      const held =
        (await sql`SELECT lease_token, last_status FROM scheduled_job_runs WHERE job_name = 'lease-probe'`) as Array<{
          lease_token: string | null;
          last_status: string;
        }>;
      expect(held[0].lease_token).toBe('tok-a');
      expect(held[0].last_status).toBe('running');

      await releaseJobLease(sql, 'lease-probe', 'tok-a', AS_OF_ISO, true, null);
      const row = (await sql`
        SELECT lease_token, last_status, last_succeeded_at::text AS "lastSucceededAt"
        FROM scheduled_job_runs WHERE job_name = 'lease-probe'
      `) as Array<{
        lease_token: string | null;
        last_status: string;
        lastSucceededAt: string | null;
      }>;
      expect(row[0].lease_token).toBeNull();
      expect(row[0].last_status).toBe('succeeded');
      // last_succeeded_at stores the tick's scheduled time, not wall-clock.
      expect(row[0].lastSucceededAt).toContain('2026-10-01 00:00');
    });

    it('a failed release does not advance last_succeeded_at, so the slot stays owed', async () => {
      await acquireJobLease(sql, LEASE_JOB, 'tok-a', AS_OF_ISO);
      await releaseJobLease(sql, 'lease-probe', 'tok-a', AS_OF_ISO, false, 'boom');
      const row = (await sql`
        SELECT last_status, last_succeeded_at, last_error
        FROM scheduled_job_runs WHERE job_name = 'lease-probe'
      `) as Array<{
        last_status: string;
        last_succeeded_at: string | null;
        last_error: string | null;
      }>;
      expect(row[0].last_status).toBe('failed');
      expect(row[0].last_succeeded_at).toBeNull();
      expect(row[0].last_error).toBe('boom');
    });

    it('truncates last_error to 2000 characters', async () => {
      await acquireJobLease(sql, LEASE_JOB, 'tok-a', AS_OF_ISO);
      await releaseJobLease(sql, 'lease-probe', 'tok-a', AS_OF_ISO, false, 'x'.repeat(5000));
      const row = (await sql`
        SELECT LENGTH(last_error) AS len FROM scheduled_job_runs WHERE job_name = 'lease-probe'
      `) as Array<{ len: number }>;
      expect(row[0].len).toBe(2000);
    });
  });

  describe('markdown-recalculation', () => {
    let seedCounter = 0;
    async function seedItem(status: string, daysFromAsOf: number): Promise<number> {
      seedCounter += 1;
      const n = seedCounter;
      const product = await sql`
        INSERT INTO products (organization_id, barcode, sku, name, cost_price, updated_at)
        VALUES (${ORG}, 'B' || ${n}, 'S' || ${n}, 'P', 10, NOW())
        RETURNING id`;
      const area = await sql`
        INSERT INTO store_areas (organization_id, name, updated_at)
        VALUES (${ORG}, 'Aisle', NOW())
        RETURNING id`;
      // expiry = asOf + N days exactly => CEIL days = N (deterministic band edges).
      const rows = await sql`
        INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, status, updated_at)
        VALUES (${ORG}, ${Number(product[0].id)}, ${Number(area[0].id)},
                ${AS_OF_ISO}::timestamp + make_interval(days => ${daysFromAsOf}), ${status}, NOW())
        RETURNING id`;
      return Number(rows[0].id);
    }

    it('classifies boundary days into the right markdown bands', async () => {
      await seedOrganization(harness.pg, ORG);
      const boundaries: Array<[number, string]> = [
        [-1, 'Expired'],
        [0, 'Expired'],
        [1, 'Markdown 3'],
        [30, 'Markdown 3'],
        [31, 'Markdown 2'],
        [60, 'Markdown 2'],
        [61, 'Markdown 1'],
        [90, 'Markdown 1'],
        [91, 'Normal'],
      ];
      for (const [days] of boundaries) {
        await seedItem('Normal', days);
      }

      const result = await markdownRecalculationJob.run({ env: ENV, sql, asOf: AS_OF });
      expect(result.summary.updated).toBe(8); // all but the day-91 'Normal' row

      const rows = (await sql`
        SELECT CEIL(EXTRACT(EPOCH FROM (expiry_date - ${AS_OF_ISO}::timestamp)) / 86400)::int AS days,
               status
        FROM inventory_items ORDER BY days
      `) as Array<{ days: number; status: string }>;
      expect(rows.map((r) => [r.days, r.status])).toEqual(boundaries);
    });

    it('never touches dispositioned/terminal statuses', async () => {
      await seedOrganization(harness.pg, ORG);
      for (const status of ['Processed', 'Sold Through']) {
        const id = await seedItem(status, 1); // would be 'Markdown 3' if it ran
        const rows = await sql`SELECT status FROM inventory_items WHERE id = ${id}`;
        expect((rows as Array<{ status: string }>)[0].status).toBe(status);
      }

      const result = await markdownRecalculationJob.run({ env: ENV, sql, asOf: AS_OF });
      expect(result.summary.updated).toBe(0);
      const statuses = (await sql`SELECT DISTINCT status FROM inventory_items`) as Array<{
        status: string;
      }>;
      expect(statuses.map((s) => s.status).sort()).toEqual(['Processed', 'Sold Through']);
    });

    it('is a no-op on a second run (updated_at only changes on real changes)', async () => {
      await seedOrganization(harness.pg, ORG);
      await seedItem('Normal', 10);
      await markdownRecalculationJob.run({ env: ENV, sql, asOf: AS_OF });
      const first =
        (await sql`SELECT status, updated_at::text AS u FROM inventory_items`) as Array<{
          status: string;
          u: string;
        }>;
      const second = await markdownRecalculationJob.run({ env: ENV, sql, asOf: AS_OF });
      expect(second.summary.updated).toBe(0);
      const after =
        (await sql`SELECT status, updated_at::text AS u FROM inventory_items`) as Array<{
          status: string;
          u: string;
        }>;
      expect(after).toEqual(first);
    });
  });

  describe('credit-claim-photo-purge queries', () => {
    let photoIdDue: number;
    let foreignPhotoIdDue: number;

    async function seedPhoto(
      org: string,
      storageKey: string,
      deleteAfter: string | null,
    ): Promise<number> {
      const supplier = await sql`
        INSERT INTO suppliers (organization_id, name, follow_up_days)
        VALUES (${org}, ${'Supplier ' + storageKey}, 7)
        RETURNING id`;
      const product = await sql`
        INSERT INTO products (organization_id, barcode, sku, name, cost_price, supplier_id, updated_at)
        VALUES (${org}, 'B' || ${storageKey}, 'S' || ${storageKey}, 'P', 10, ${Number(supplier[0].id)}, NOW())
        RETURNING id`;
      const area = await sql`
        INSERT INTO store_areas (organization_id, name, updated_at)
        VALUES (${org}, 'A' || ${storageKey}, NOW())
        RETURNING id`;
      const item = await sql`
        INSERT INTO inventory_items (organization_id, product_id, location_id, expiry_date, updated_at)
        VALUES (${org}, ${Number(product[0].id)}, ${Number(area[0].id)}, NOW(), NOW())
        RETURNING id`;
      const writeOff = await sql`
        INSERT INTO expired_item_transactions (organization_id, inventory_item_id, action, units_discarded, updated_at)
        VALUES (${org}, ${Number(item[0].id)}, 'expired', 1, NOW())
        RETURNING id`;
      const claim = await sql`
        INSERT INTO credit_claims (organization_id, supplier_id)
        VALUES (${org}, ${Number(supplier[0].id)})
        RETURNING id`;
      const line = await sql`
        INSERT INTO credit_claim_lines (organization_id, claim_id, expired_item_transaction_id, units_claimed)
        VALUES (${org}, ${Number(claim[0].id)}, ${Number(writeOff[0].id)}, 1)
        RETURNING id`;
      const photo = await sql`
        INSERT INTO credit_claim_photos (organization_id, claim_line_id, storage_key, file_name, size_bytes, delete_after)
        VALUES (${org}, ${Number(line[0].id)}, ${storageKey}, ${storageKey + '.jpg'}, 100,
                ${deleteAfter === null ? null : deleteAfter}::timestamp)
        RETURNING id`;
      return Number(photo[0].id);
    }

    beforeEach(async () => {
      await seedOrganization(harness.pg, ORG);
      await seedOrganization(harness.pg, OTHER_ORG);
      photoIdDue = await seedPhoto(ORG, 'org1/due', '2026-09-01T00:00:00Z');
      await seedPhoto(ORG, 'org1/not-due', '2027-01-01T00:00:00Z');
      await seedPhoto(ORG, 'org1/unsettled', null);
      foreignPhotoIdDue = await seedPhoto(OTHER_ORG, 'org2/due', '2026-09-01T00:00:00Z');
    });

    it('lists due photos across organizations, skipping not-due and NULL rows', async () => {
      const due = await listPhotosDueForPurgeAcrossOrgs(sql, AS_OF);
      expect(due.map((p) => p.id).sort()).toEqual([photoIdDue, foreignPhotoIdDue].sort());
      expect(due.map((p) => p.organizationId).sort()).toEqual([ORG, OTHER_ORG].sort());
    });

    it('honours the batch limit', async () => {
      const due = await listPhotosDueForPurgeAcrossOrgs(sql, AS_OF, 1);
      expect(due).toHaveLength(1);
    });

    it('deletePhotoRowById removes exactly that row', async () => {
      await deletePhotoRowById(sql, photoIdDue);
      const remaining = await sql`SELECT id FROM credit_claim_photos`;
      expect((remaining as Array<{ id: number }>).map((r) => r.id)).not.toContain(photoIdDue);
      expect((remaining as Array<{ id: number }>).map((r) => r.id)).toContain(foreignPhotoIdDue);
    });
  });

  describe('recordWebhookOutcome', () => {
    it('upserts totals per event type per UTC day', async () => {
      const day = new Date('2026-10-01T12:00:00.000Z');
      await recordWebhookOutcome(sql, 'customer.subscription.created', true, day);
      await recordWebhookOutcome(sql, 'customer.subscription.created', true, day);
      await recordWebhookOutcome(sql, 'customer.subscription.created', false, day);

      const rows = (await sql`SELECT total_count, failure_count FROM webhook_metrics`) as Array<{
        total_count: number;
        failure_count: number;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ total_count: 3, failure_count: 1 });
    });

    it('writes a separate row for the next day', async () => {
      await recordWebhookOutcome(sql, 'user.created', true, new Date('2026-10-01T23:59:00Z'));
      await recordWebhookOutcome(sql, 'user.created', true, new Date('2026-10-02T00:01:00Z'));
      const rows = (await sql`
        SELECT date::text AS d FROM webhook_metrics ORDER BY date
      `) as Array<{ d: string }>;
      expect(rows).toHaveLength(2);
      expect(rows[0].d.startsWith('2026-10-01')).toBe(true);
      expect(rows[1].d.startsWith('2026-10-02')).toBe(true);
    });
  });

  describe('webhook-monitoring', () => {
    it('stays quiet below every threshold', async () => {
      await sql`
        INSERT INTO webhook_metrics (event_type, date, total_count, failure_count)
        VALUES ('t', date_trunc('day', ${AS_OF_ISO}::timestamp), 200, 1)`;
      const result = await webhookMonitoringJob.run({ env: ENV, sql, asOf: AS_OF });
      expect(result.summary.alerted).toEqual([]);
      expect(sentryCalls.messages).toHaveLength(0);
    });

    it('alerts on failure rate above 5%', async () => {
      await sql`
        INSERT INTO webhook_metrics (event_type, date, total_count, failure_count)
        VALUES ('t', date_trunc('day', ${AS_OF_ISO}::timestamp), 10, 1)`;
      const result = await webhookMonitoringJob.run({ env: ENV, sql, asOf: AS_OF });
      expect(result.summary.failureRatePercent).toBe(10);
      expect(result.summary.alerted).toContain('failure_rate');
      const call = sentryCalls.messages[0] as [string, { fingerprint: string[] }];
      expect(call[1].fingerprint).toEqual(['webhook_monitoring', 'failure_rate']);
    });

    it('alerts on daily error count even when the rate is fine', async () => {
      await sql`
        INSERT INTO webhook_metrics (event_type, date, total_count, failure_count)
        VALUES ('t', date_trunc('day', ${AS_OF_ISO}::timestamp), 1000, 2)`;
      const result = await webhookMonitoringJob.run({ env: ENV, sql, asOf: AS_OF });
      expect(result.summary.alerted).toEqual(['daily_error_count']);
    });

    it('flags replay growth > 5x, treating a zero baseline as a volume spike rule', async () => {
      // Previous hour: 10 processed; current hour: 60 => growth 6.
      for (let i = 0; i < 10; i += 1) {
        await sql`
          INSERT INTO processed_webhook_events (id, event_type, processed_at)
          VALUES (${'prev' + i}, 't', ${AS_OF_ISO}::timestamp - make_interval(mins => 90))`;
      }
      for (let i = 0; i < 60; i += 1) {
        await sql`
          INSERT INTO processed_webhook_events (id, event_type, processed_at)
          VALUES (${'cur' + i}, 't', ${AS_OF_ISO}::timestamp - make_interval(mins => 30))`;
      }
      const result = await webhookMonitoringJob.run({ env: ENV, sql, asOf: AS_OF });
      expect(result.summary.replayGrowth).toBe(6);
      expect(result.summary.alerted).toContain('replay_attack_suspected');
    });

    it('zero-baseline growth stays quiet at <=100 events and fires above', async () => {
      // No rows in the previous hour; 50 in the current hour => growth 1, quiet.
      for (let i = 0; i < 50; i += 1) {
        await sql`
          INSERT INTO processed_webhook_events (id, event_type, processed_at)
          VALUES (${'cur' + i}, 't', ${AS_OF_ISO}::timestamp - make_interval(mins => 30))`;
      }
      const quiet = await webhookMonitoringJob.run({ env: ENV, sql, asOf: AS_OF });
      expect(quiet.summary.replayGrowth).toBe(1);
      expect(quiet.summary.alerted).toEqual([]);

      await sql`DELETE FROM processed_webhook_events`;
      for (let i = 0; i < 150; i += 1) {
        await sql`
          INSERT INTO processed_webhook_events (id, event_type, processed_at)
          VALUES (${'spike' + i}, 't', ${AS_OF_ISO}::timestamp - make_interval(mins => 30))`;
      }
      const spike = await webhookMonitoringJob.run({ env: ENV, sql, asOf: AS_OF });
      expect(spike.summary.replayGrowth).toBe(10);
      expect(spike.summary.alerted).toContain('replay_attack_suspected');
    });
  });
});
