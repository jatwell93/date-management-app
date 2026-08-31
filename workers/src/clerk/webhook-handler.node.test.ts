/**
 * Real-SQL (pglite) coverage for Clerk webhook idempotency — task 3.1.b, issue #472.
 *
 * The mechanism under test is a single `INSERT ... ON CONFLICT (id) DO UPDATE ...
 * RETURNING id` that claims an event id before the side effects run. Its whole
 * value is in what Postgres does with a unique index, so mocking `db.sql` would
 * test nothing: these run against an in-process Postgres, under
 * `vitest.node.config.mts` (`npm run test:db`).
 *
 * There is deliberately **no** `Promise.all` "concurrent deliveries" test. pglite
 * is a single connection and serializes statements, so such a test passes whether
 * or not the code is correct — it would be a green light the harness cannot turn
 * red. What is testable here is the decision table the claim implements, and the
 * fact that a replay performs no work; the atomicity of the conflict branch is a
 * property of the unique index, and the index is asserted to exist (a duplicate
 * `subscription_tiers` insert is rejected) rather than assumed.
 *
 * Signatures are real HMACs over the real body, not mocked, so the handler runs
 * its full path.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { neon } from '@neondatabase/serverless';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { Env } from '../types/env';
import { createPgliteHarness, createTaggedSql, type PgliteHarness } from '../__tests__/pglite-db';

const sqlHolder = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlHolder.current),
}));

import { handleClerkWebhook } from './webhook-handler';

const WEBHOOK_SECRET = 'local-test-secret';

const ENV = {
  NODE_ENV: 'test',
  NEON_CONNECTION_STRING: 'postgres://test',
  CLERK_WEBHOOK_SECRET: WEBHOOK_SECRET,
} as unknown as Env;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

async function signClerkWebhook(id: string, timestamp: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
  );

  return `v1,${toBase64(signature)}`;
}

/** A `user.created` payload carrying one admin membership of `clerkOrgId`. */
function userCreatedEvent(options: {
  clerkUserId: string;
  email: string;
  clerkOrgId: string;
  role?: string;
}): Record<string, unknown> {
  return {
    type: 'user.created',
    data: {
      id: options.clerkUserId,
      username: options.clerkUserId,
      primary_email_address_id: 'idn_primary',
      email_addresses: [{ id: 'idn_primary', email_address: options.email }],
      organization_memberships: [
        {
          role: options.role ?? 'org:admin',
          organization: { id: options.clerkOrgId, name: 'Acme', slug: 'acme' },
        },
      ],
    },
  };
}

/** Build the signed request a Svix delivery of `event` under `eventId` produces. */
async function deliver(eventId: string, event: Record<string, unknown>): Promise<Response> {
  const rawBody = JSON.stringify(event);
  const timestamp = String(Math.floor(Date.now() / 1000));

  return handleClerkWebhook(
    new Request('https://api.test/api/webhooks/clerk', {
      method: 'POST',
      headers: {
        'svix-id': eventId,
        'svix-timestamp': timestamp,
        'svix-signature': await signClerkWebhook(eventId, timestamp, rawBody),
        'Content-Type': 'application/json',
      },
      body: rawBody,
    }),
    ENV,
    'https://app.test',
  );
}

describe('handleClerkWebhook idempotency (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    vi.mocked(neon).mockClear();
    await sql`DELETE FROM clerk_webhook_events`;
    await sql`DELETE FROM subscription_tiers`;
    await sql`DELETE FROM users`;
    await sql`DELETE FROM organizations`;
  });

  const countUsers = async (clerkUserId: string): Promise<number> => {
    const rows =
      await sql`SELECT count(*)::int AS n FROM users WHERE clerk_user_id = ${clerkUserId}`;
    return Number(rows[0].n);
  };

  const countSubscriptions = async (): Promise<number> => {
    const rows = await sql`SELECT count(*)::int AS n FROM subscription_tiers`;
    return Number(rows[0].n);
  };

  const marker = async (
    eventId: string,
  ): Promise<{ event_type: string; completed_at: string | null } | undefined> => {
    const rows = await sql`
      SELECT event_type, completed_at
      FROM clerk_webhook_events
      WHERE id = ${eventId}`;
    return rows[0] as { event_type: string; completed_at: string | null } | undefined;
  };

  it('claims, processes and completes a first delivery', async () => {
    const response = await deliver(
      'msg_first',
      userCreatedEvent({ clerkUserId: 'user_1', email: 'a@acme.test', clerkOrgId: 'org_clerk_1' }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });

    expect(await countUsers('user_1')).toBe(1);
    expect(await countSubscriptions()).toBe(1);

    const row = await marker('msg_first');
    expect(row?.event_type).toBe('user.created');
    // Completed, not merely claimed — the row is the receipt once the work is done.
    expect(row?.completed_at).not.toBeNull();
  });

  it('performs no work when the same event id is delivered again', async () => {
    const event = userCreatedEvent({
      clerkUserId: 'user_1',
      email: 'a@acme.test',
      clerkOrgId: 'org_clerk_1',
    });
    await deliver('msg_replay', event);

    // Mark the row so a re-run of the side effects is visible: the upsert would
    // reset role and username from the payload.
    await sql`UPDATE users SET role = ${'Sentinel'} WHERE clerk_user_id = ${'user_1'}`;
    const completedAtBefore = (await marker('msg_replay'))?.completed_at;

    const response = await deliver('msg_replay', event);

    expect(response.status).toBe(200);
    const rows = await sql`SELECT role FROM users WHERE clerk_user_id = ${'user_1'}`;
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('Sentinel');
    expect(await countSubscriptions()).toBe(1);
    // The replay did not re-stamp the marker either.
    expect((await marker('msg_replay'))?.completed_at).toEqual(completedAtBefore);
  });

  it('asks for a retry, without doing work, while a sibling holds the claim', async () => {
    // A claim in flight: the marker row exists with no completion.
    await sql`
      INSERT INTO clerk_webhook_events (id, event_type, processed_at, completed_at)
      VALUES (${'msg_inflight'}, ${'user.created'}, NOW(), NULL)`;

    const response = await deliver(
      'msg_inflight',
      userCreatedEvent({ clerkUserId: 'user_1', email: 'a@acme.test', clerkOrgId: 'org_clerk_1' }),
    );

    // Not 200. A 200 would acknowledge the delivery and end its retry chain; if
    // the claim holder died without releasing, this delivery is the only thing
    // that can re-drive the event once the staleness window expires.
    expect(response.status).toBe(503);
    expect(await countUsers('user_1')).toBe(0);
    expect(await countSubscriptions()).toBe(0);
    // The sibling still owns it; this delivery must not have completed it.
    expect((await marker('msg_inflight'))?.completed_at).toBeNull();
  });

  it('acknowledges once the sibling that held the claim has completed', async () => {
    await sql`
      INSERT INTO clerk_webhook_events (id, event_type, processed_at, completed_at)
      VALUES (${'msg_handoff'}, ${'user.created'}, NOW(), NULL)`;
    const event = userCreatedEvent({
      clerkUserId: 'user_1',
      email: 'a@acme.test',
      clerkOrgId: 'org_clerk_1',
    });

    expect((await deliver('msg_handoff', event)).status).toBe(503);

    // The sibling finishes.
    await sql`UPDATE clerk_webhook_events SET completed_at = NOW() WHERE id = ${'msg_handoff'}`;

    // The retry Svix kept alive now settles the delivery instead of looping.
    const retry = await deliver('msg_handoff', event);
    expect(retry.status).toBe(200);
    expect(await countUsers('user_1')).toBe(0);
  });

  it('treats a marker written without completed_at as finished work', async () => {
    // What the *old* Worker writes during the deploy gap: it inserts its marker
    // after processing and never names completed_at. The column default has to
    // make that row read as completed, or a redelivery arriving after the
    // staleness window would re-run side effects that already happened.
    await sql`
      INSERT INTO clerk_webhook_events (id, event_type, processed_at)
      VALUES (${'msg_deploy_gap'}, ${'user.created'}, NOW() - INTERVAL '10 minutes')`;

    const response = await deliver(
      'msg_deploy_gap',
      userCreatedEvent({ clerkUserId: 'user_1', email: 'a@acme.test', clerkOrgId: 'org_clerk_1' }),
    );

    expect(response.status).toBe(200);
    expect(await countUsers('user_1')).toBe(0);
    expect(await countSubscriptions()).toBe(0);
  });

  it('takes over a claim abandoned longer ago than the staleness window', async () => {
    // What an isolate that died mid-handler leaves behind.
    await sql`
      INSERT INTO clerk_webhook_events (id, event_type, processed_at, completed_at)
      VALUES (${'msg_stale'}, ${'user.created'}, NOW() - INTERVAL '10 minutes', NULL)`;

    const response = await deliver(
      'msg_stale',
      userCreatedEvent({ clerkUserId: 'user_1', email: 'a@acme.test', clerkOrgId: 'org_clerk_1' }),
    );

    expect(response.status).toBe(200);
    expect(await countUsers('user_1')).toBe(1);
    expect((await marker('msg_stale'))?.completed_at).not.toBeNull();
  });

  it('releases the claim when processing fails, so the retry re-drives the event', async () => {
    // Break the user write only. The organization insert ahead of it still
    // succeeds — there is no transaction around the handler — which is exactly
    // why the claim has to be handed back rather than left to expire.
    await harness.pg.exec('ALTER TABLE users RENAME TO users_quarantined');

    let response: Response;
    try {
      response = await deliver(
        'msg_failure',
        userCreatedEvent({
          clerkUserId: 'user_1',
          email: 'a@acme.test',
          clerkOrgId: 'org_clerk_1',
        }),
      );
    } finally {
      await harness.pg.exec('ALTER TABLE users_quarantined RENAME TO users');
    }

    expect(response.status).toBe(500);
    // No marker row at all: the next delivery is a fresh claim, not a duplicate.
    expect(await marker('msg_failure')).toBeUndefined();

    const retry = await deliver(
      'msg_failure',
      userCreatedEvent({ clerkUserId: 'user_1', email: 'a@acme.test', clerkOrgId: 'org_clerk_1' }),
    );
    expect(retry.status).toBe(200);
    expect(await countUsers('user_1')).toBe(1);
  });

  it('gives an organization one trial subscription across distinct events', async () => {
    // Two different event ids for the same organization both reach
    // ensureTrialSubscription — the claim cannot dedupe these, so the unique
    // constraint has to.
    await deliver(
      'msg_org_a',
      userCreatedEvent({ clerkUserId: 'user_1', email: 'a@acme.test', clerkOrgId: 'org_clerk_1' }),
    );
    const second = await deliver(
      'msg_org_b',
      userCreatedEvent({ clerkUserId: 'user_2', email: 'b@acme.test', clerkOrgId: 'org_clerk_1' }),
    );

    expect(second.status).toBe(200);
    expect(await countSubscriptions()).toBe(1);
  });

  it('rejects a second subscription row for one organization', async () => {
    // Guards the assumption the test above rests on: the unique constraint from
    // migration 0012 is present in this harness, so a green idempotency result
    // means the constraint held, not that nothing tried to insert.
    await deliver(
      'msg_constraint',
      userCreatedEvent({ clerkUserId: 'user_1', email: 'a@acme.test', clerkOrgId: 'org_clerk_1' }),
    );
    const rows = await sql`SELECT organization_id FROM subscription_tiers`;
    const organizationId = String(rows[0].organization_id);

    await expect(
      sql`
        INSERT INTO subscription_tiers (organization_id, tier_level, status, updated_at)
        VALUES (${organizationId}, ${'professional'}, ${'trialing'}, NOW())`,
    ).rejects.toThrow(/unique|duplicate key/i);
  });
});
