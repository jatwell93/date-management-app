/**
 * Queue-routing coverage for `queue()` in index-minimal.ts: the batch's queue
 * NAME picks the handler. Both assertions run a body that is valid for one
 * handler and malformed for the other, so a misroute is observable — a body
 * routed to the wrong consumer either throws into `retry()` or calls the
 * database, while the right consumer acks it immediately.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { default as worker } from '../index-minimal';
import type { Env } from '../types/env';

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
  createClerkClient: vi.fn(() => ({
    users: { getUser: vi.fn() },
  })),
}));

// `createWorkersDatabase` runs inside the consumer's default `db` parameter;
// the stubbed `neon` makes it constructible without a live connection. The
// bodies below are malformed for the handler under test, so `db.sql` is never
// invoked — only a *misroute* would reach it.
vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => vi.fn()),
}));

const ENV = {
  NODE_ENV: 'test',
  NEON_CONNECTION_STRING: 'postgres://example',
} as unknown as Env;

// The ExportedHandler `queue` type takes (batch, env), but the Sentry wrapper
// reads ctx.waitUntil at runtime — pass a real-ish ctx past the 2-arg type.
const invokeQueue = worker.queue as unknown as (
  batch: MessageBatch<unknown>,
  env: Env,
  ctx: ExecutionContext,
) => Promise<void>;

const CTX = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as ExecutionContext;

function batch(queueName: string, bodies: unknown[]): MessageBatch<unknown> {
  return {
    queue: queueName,
    messages: bodies.map((body) => ({ body, attempts: 1, ack: vi.fn(), retry: vi.fn() })),
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<unknown>;
}

function messages(b: MessageBatch<unknown>) {
  return b.messages as unknown as Array<{
    ack: ReturnType<typeof vi.fn>;
    retry: ReturnType<typeof vi.fn>;
  }>;
}

describe('queue() routing by batch.queue name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes notification-emails-* batches to the notification consumer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // `{ uploadId }` is a valid catalogue-import body but not a notification
    // message — the notification consumer must warn + ack it. If it reached
    // the catalogue handler it would run the import job instead.
    const b = batch('notification-emails-dev', [{ uploadId: 42 }]);
    await invokeQueue(b, ENV, CTX);

    expect(messages(b)[0].ack).toHaveBeenCalledTimes(1);
    expect(messages(b)[0].retry).not.toHaveBeenCalled();
    expect(
      warn.mock.calls.some((args) => String(args[0]).includes('notification_email_invalid')),
    ).toBe(true);
    warn.mockRestore();
  });

  it('routes every notification-emails-* queue name, including prod', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const b = batch('notification-emails-prod', [{}]);
    await invokeQueue(b, ENV, CTX);

    expect(messages(b)[0].ack).toHaveBeenCalledTimes(1);
    expect(messages(b)[0].retry).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps routing other queues to the catalogue-import consumer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A valid notification body is malformed for the catalogue consumer — it
    // must ack silently. Misrouted into the notification consumer it would
    // parse, reach sendFollowUp, throw against the stubbed sql, and retry.
    const b = batch('catalogue-imports-dev', [
      { kind: 'credit-claim-follow-up', organizationId: 'org_1', claimId: 1 },
    ]);
    await invokeQueue(b, ENV, CTX);

    expect(messages(b)[0].ack).toHaveBeenCalledTimes(1);
    expect(messages(b)[0].retry).not.toHaveBeenCalled();
    expect(
      warn.mock.calls.some((args) => String(args[0]).includes('notification_email_invalid')),
    ).toBe(false);
    warn.mockRestore();
  });
});
