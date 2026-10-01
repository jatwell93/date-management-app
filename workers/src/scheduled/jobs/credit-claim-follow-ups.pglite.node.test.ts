/**
 * Real-SQL (pglite) coverage for the `credit-claim-follow-ups` scheduled job —
 * task 3.3b. The candidate scan selects chaseable claims whose
 * `next_follow_up_at` has arrived, across organizations; the job enqueues one
 * queue message per claim and leaves the due-ness re-check to the consumer.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../types/env';
import {
  createPgliteHarness,
  createTaggedSql,
  seedOrganization,
  type PgliteHarness,
} from '../../__tests__/pglite-db';
import type { NotificationEmailMessage } from '../../notifications/messages';
import { creditClaimFollowUpsJob } from './credit-claim-follow-ups';
import type { SqlClient } from '../schedule';

const AS_OF = new Date('2026-10-01T00:00:00.000Z');
const ORG = 'org_fu_1';
const OTHER_ORG = 'org_fu_2';

let seedCounter = 0;

function envWith(queue: { sendBatch: ReturnType<typeof vi.fn> }): Env {
  return {
    NODE_ENV: 'test',
    RESEND_API_KEY: 'test-key',
    RESEND_FROM_EMAIL: 'claims@example.test',
    NOTIFICATION_EMAIL_QUEUE: queue,
  } as unknown as Env;
}

describe('credit-claim-follow-ups job (pglite)', () => {
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
    await sql`DELETE FROM credit_claim_events`;
    await sql`DELETE FROM credit_claim_lines`;
    await sql`DELETE FROM credit_claims`;
    await sql`DELETE FROM suppliers`;
    await sql`DELETE FROM organizations`;
    await seedOrganization(harness.pg, ORG);
    await seedOrganization(harness.pg, OTHER_ORG);
  });

  async function seedClaim(
    orgId: string,
    opts: { status: string; nextFollowUpAt: string | null },
  ): Promise<number> {
    const supplier = await sql`
      INSERT INTO suppliers (organization_id, name, contact_email, follow_up_days)
      VALUES (${orgId}, 'Supplier ' || ${(seedCounter += 1)}, 'supplier@x.test', 7)
      RETURNING id`;
    const rows = await sql`
      INSERT INTO credit_claims (organization_id, supplier_id, status, sent_at, next_follow_up_at)
      VALUES (${orgId}, ${Number(supplier[0].id)}, ${opts.status}, NOW(),
              ${opts.nextFollowUpAt}::timestamp)
      RETURNING id`;
    return Number(rows[0].id);
  }

  it('enqueues one message per due claim across organizations', async () => {
    const dueA = await seedClaim(ORG, { status: 'SENT', nextFollowUpAt: '2026-09-30 10:00:00' });
    const dueB = await seedClaim(OTHER_ORG, {
      status: 'ACKNOWLEDGED',
      nextFollowUpAt: '2026-10-01 00:00:00',
    });
    await seedClaim(ORG, { status: 'SENT', nextFollowUpAt: '2026-10-02 00:00:00' }); // future
    await seedClaim(ORG, { status: 'CREDITED', nextFollowUpAt: '2026-09-30 10:00:00' });
    await seedClaim(ORG, { status: 'SENT', nextFollowUpAt: null });

    const result = await creditClaimFollowUpsJob.run({
      env: envWith({ sendBatch }),
      sql,
      asOf: AS_OF,
    });

    expect(result.summary).toEqual({ enqueued: 2, hitBatchLimit: false });
    expect(sendBatch).toHaveBeenCalledTimes(1);
    const bodies = (sendBatch.mock.calls[0][0] as Array<{ body: NotificationEmailMessage }>).map(
      (entry) => entry.body,
    );
    expect(bodies).toEqual([
      { kind: 'credit-claim-follow-up', organizationId: ORG, claimId: dueA },
      { kind: 'credit-claim-follow-up', organizationId: OTHER_ORG, claimId: dueB },
    ]);
  });

  it('skips quietly when Resend is not configured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const env = { NODE_ENV: 'test', NOTIFICATION_EMAIL_QUEUE: { sendBatch } } as unknown as Env;

    const result = await creditClaimFollowUpsJob.run({ env, sql, asOf: AS_OF });

    expect(result.summary).toEqual({ skipped: 'resend-not-configured' });
    expect(result.failed).not.toBe(true);
    expect(sendBatch).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('throws when the queue binding is missing', async () => {
    const env = {
      NODE_ENV: 'test',
      RESEND_API_KEY: 'test-key',
      RESEND_FROM_EMAIL: 'claims@example.test',
    } as unknown as Env;

    await expect(creditClaimFollowUpsJob.run({ env, sql, asOf: AS_OF })).rejects.toThrow(
      /NOTIFICATION_EMAIL_QUEUE/,
    );
  });
});
