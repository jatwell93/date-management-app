/**
 * Unit coverage for the `stripe-reconciliation` scheduled job — pagination,
 * divergence logging, the canceled→deleted mapping and failure isolation —
 * with `fetch` stubbed for the Stripe API and a fake SqlClient for the local
 * reads. `processSubscriptionEvent` is mocked so the assertions are on what
 * the job hands to the existing webhook path, not on that path itself (which
 * has its own real-SQL suite).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../types/env';
import type { SqlClient } from '../schedule';

const processSubscriptionEvent = vi.hoisted(() =>
  vi.fn(async (_sql: unknown, _eventType: unknown, _eventId: unknown, _sub: unknown) => {}),
);

vi.mock('../../stripe/subscription-events', () => ({
  processSubscriptionEvent,
}));

import { stripeReconciliationJob } from './stripe-reconciliation';

const ENV = {
  NODE_ENV: 'test',
  STRIPE_SECRET_KEY: 'sk_test_local',
} as unknown as Env;

const AS_OF = new Date('2026-10-01T01:00:00.000Z');

/** Fake SqlClient returning canned `subscription_tiers` rows for the job's SELECT. */
function fakeSql(localRows: unknown[]) {
  const sql = (async (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join('?');
    if (/FROM subscription_tiers/.test(text)) return localRows;
    throw new Error(`unexpected query: ${text}`);
  }) as unknown as SqlClient;
  return sql;
}

function stripePage(data: unknown[], hasMore = false) {
  return new Response(JSON.stringify({ data, has_more: hasMore }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stripeSub(id: string, status: string) {
  return {
    id,
    status,
    customer: 'cus_x',
    metadata: {},
    items: { data: [{ price: { metadata: { tier: 'pro' }, recurring: { interval: 'month' } } }] },
  };
}

describe('stripe-reconciliation job', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    processSubscriptionEvent.mockReset().mockResolvedValue(undefined);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips cleanly when Stripe is not configured', async () => {
    const result = await stripeReconciliationJob.run({
      env: { NODE_ENV: 'test' } as Env,
      sql: fakeSql([]),
      asOf: AS_OF,
    });
    expect(result.summary.skipped).toBe('stripe-not-configured');
    expect(result.failed).not.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pages through subscriptions via starting_after', async () => {
    fetchMock
      .mockResolvedValueOnce(stripePage([stripeSub('sub_1', 'active')], true))
      .mockResolvedValueOnce(stripePage([stripeSub('sub_2', 'active')]));
    const sql = fakeSql([]);

    const result = await stripeReconciliationJob.run({ env: ENV, sql, asOf: AS_OF });

    expect(result.summary.stripeSubscriptions).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = String((fetchMock.mock.calls[1] as unknown[])[0]);
    expect(secondUrl).toContain('starting_after=sub_1');
    expect(secondUrl).toContain('status=all');
  });

  it('maps canceled Stripe subscriptions onto the deleted event path', async () => {
    fetchMock.mockResolvedValue(stripePage([stripeSub('sub_gone', 'canceled')]));
    const sql = fakeSql([
      { organizationId: 'org_1', stripeSubscriptionId: 'sub_gone', status: 'active' },
    ]);

    const result = await stripeReconciliationJob.run({ env: ENV, sql, asOf: AS_OF });

    expect(processSubscriptionEvent).toHaveBeenCalledTimes(1);
    const [, eventType, eventId, sub] = processSubscriptionEvent.mock.calls[0] as unknown as [
      unknown,
      string,
      string,
      { id: string },
    ];
    expect(eventType).toBe('customer.subscription.deleted');
    expect(eventId).toBe('reconcile:2026-10-01:sub_gone');
    expect(sub.id).toBe('sub_gone');
    expect(result.summary.applied).toBe(1);
    expect(result.summary.divergences).toBe(1); // local 'active' vs stripe 'canceled'
  });

  it('warns about a local row missing from Stripe but writes nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue(stripePage([stripeSub('sub_other', 'active')]));
    const sql = fakeSql([
      { organizationId: 'org_1', stripeSubscriptionId: 'sub_missing', status: 'active' },
    ]);

    const result = await stripeReconciliationJob.run({ env: ENV, sql, asOf: AS_OF });

    expect(processSubscriptionEvent).not.toHaveBeenCalled();
    expect(result.summary.missingInStripe).toBe(1);
    expect(result.failed).not.toBe(true);
    const line = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(line).toContain('missing-in-stripe');
    warn.mockRestore();
  });

  it('a rejected apply does not stop the others and marks the run failed', async () => {
    fetchMock.mockResolvedValue(
      stripePage([stripeSub('sub_bad', 'active'), stripeSub('sub_ok', 'active')]),
    );
    processSubscriptionEvent.mockImplementation(async (_sql, _t, _id, sub) => {
      if ((sub as { id: string }).id === 'sub_bad') throw new Error('apply exploded');
    });
    const sql = fakeSql([
      { organizationId: 'org_1', stripeSubscriptionId: 'sub_bad', status: 'active' },
      { organizationId: 'org_2', stripeSubscriptionId: 'sub_ok', status: 'active' },
    ]);

    const result = await stripeReconciliationJob.run({ env: ENV, sql, asOf: AS_OF });

    expect(processSubscriptionEvent).toHaveBeenCalledTimes(2);
    expect(result.summary.applied).toBe(1);
    expect(result.summary.failures).toBe(1);
    expect(result.failed).toBe(true);
  });

  it('propagates a pagination error so the run fails and retries next tick', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500 }),
    );
    await expect(
      stripeReconciliationJob.run({ env: ENV, sql: fakeSql([]), asOf: AS_OF }),
    ).rejects.toThrow('boom');
  });
});
