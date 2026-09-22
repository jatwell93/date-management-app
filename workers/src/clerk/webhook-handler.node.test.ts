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

/** An `organizationMembership.created` payload — Clerk's own role-grant path. */
function membershipCreatedEvent(options: {
  clerkUserId: string;
  email: string;
  clerkOrgId: string;
  role: string;
}): Record<string, unknown> {
  return {
    type: 'organizationMembership.created',
    data: {
      role: options.role,
      public_user_data: { user_id: options.clerkUserId, identifier: options.email },
      organization: { id: options.clerkOrgId, name: 'Acme', slug: 'acme' },
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
    await sql`DELETE FROM org_audit_log`;
    await sql`DELETE FROM subscription_tiers`;
    await sql`DELETE FROM users`;
    await sql`DELETE FROM organizations`;
  });

  /**
   * Organization RBAC audit trail, webhook arm (migration 0013).
   *
   * Review caught that the trail's first cut audited three HTTP paths while
   * Clerk's own membership UI — which is how an org admin actually promotes
   * someone in a Clerk-managed org — reached the database through this webhook
   * and wrote a role with no entry at all.
   */
  describe('organization RBAC audit trail', () => {
    const audit = async () =>
      (await sql`
        SELECT actor_user_id, target_user_id, old_role, new_role, metadata
        FROM org_audit_log
        ORDER BY id`) as unknown as {
        actor_user_id: number | null;
        target_user_id: number | null;
        old_role: string | null;
        new_role: string | null;
        metadata: string | null;
      }[];

    it('records a role change arriving from Clerk membership', async () => {
      await deliver(
        'msg_seed',
        userCreatedEvent({
          clerkUserId: 'user_promote',
          email: 'p@acme.test',
          clerkOrgId: 'org_clerk_p',
          role: 'org:member',
        }),
      );
      await sql`DELETE FROM org_audit_log`;

      const response = await deliver(
        'msg_membership',
        membershipCreatedEvent({
          clerkUserId: 'user_promote',
          email: 'p@acme.test',
          clerkOrgId: 'org_clerk_p',
          role: 'org:admin',
        }),
      );
      expect(response.status).toBe(200);

      const rows = await audit();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        // Canonical, as of the #517 fix. This assertion previously read
        // `old_role: 'Team Member', new_role: 'Manager'` and was pinned to the
        // defect on purpose, so that fixing it could not land silently — the
        // webhook stored spellings no authorization gate accepted, while the
        // bootstrap path wrote 'admin' for the same org:admin. Both normalizers
        // now defer to `shared/domain/roles.ts`, so the trail records the value
        // an authorization gate will actually honour.
        old_role: 'team_member',
        new_role: 'admin',
        // No local actor: the grant was made inside Clerk by someone this
        // database has no user id for. NULL is the honest value, not a bug.
        actor_user_id: null,
      });
      expect(JSON.parse(String(rows[0].metadata))).toMatchObject({
        trigger: 'clerk-webhook',
        clerkOrganizationRole: 'org:admin',
      });
    });

    it('records the grant when membership arrives before the user exists', async () => {
      // Out-of-order delivery, and also the ordinary flow for someone added to
      // an organization in Clerk before they ever sign in: there is no users row
      // yet, so this delivery *creates* the member and grants the role. An
      // earlier cut updated first and created through a separate
      // `upsertClerkUser` fallback, leaving exactly this first grant unaudited.
      const response = await deliver(
        'msg_membership_first',
        membershipCreatedEvent({
          clerkUserId: 'user_unseen',
          email: 'unseen@acme.test',
          clerkOrgId: 'org_clerk_u',
          role: 'org:admin',
        }),
      );
      expect(response.status).toBe(200);

      const created = await sql`SELECT id, role FROM users WHERE clerk_user_id = 'user_unseen'`;
      expect(created).toHaveLength(1);

      const rows = await audit();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        target_user_id: Number(created[0].id),
        // No predecessor: the user did not exist. NULL here is what separates a
        // grant-on-create from a promotion, exactly as on the admin-create path.
        old_role: null,
        new_role: String(created[0].role),
        actor_user_id: null,
      });
      expect(JSON.parse(String(rows[0].metadata))).toMatchObject({
        trigger: 'clerk-webhook',
        clerkOrganizationRole: 'org:admin',
      });
    });

    it('names the user when the grant re-links an existing address', async () => {
      // Reaches `upsertClerkUser`'s 23505-on-email re-link, which happens when
      // the same address arrives under a new Clerk identity (deleted and
      // recreated in Clerk). This branch was structurally unreachable in tests
      // until `users_email_key` was added to the harness, which is why the gap
      // it contained survived two review rounds.
      // The foreign row is seeded FIRST, deliberately. An unscoped lookup
      // returns both rows and takes whichever the heap yields first, so a
      // foreign row created *after* the real one would still leave the
      // assertion passing by luck — the first version of this test did exactly
      // that and survived the mutation that removes the organization scope.
      // Seeding it first makes the wrong row the one an unscoped query reads.
      await sql`
        INSERT INTO organizations (id, name, slug, updated_at)
        VALUES ('org-foreign-relink', 'Foreign', 'foreign-relink', NOW())`;
      await sql`
        INSERT INTO users (organization_id, clerk_user_id, email, username, role, updated_at)
        VALUES ('org-foreign-relink', 'clerk_foreign', 'RELINK@acme.test', 'foreign', 'admin', NOW())`;

      await deliver(
        'msg_relink_seed',
        userCreatedEvent({
          clerkUserId: 'clerk_old_identity',
          email: 'relink@acme.test',
          clerkOrgId: 'org_clerk_relink',
          role: 'org:member',
        }),
      );
      const seeded = await sql`
        SELECT id, role, organization_id FROM users WHERE clerk_user_id = 'clerk_old_identity'`;
      expect(seeded).toHaveLength(1);
      // The two rows must genuinely disagree, or the scoping assertion proves
      // nothing regardless of ordering.
      expect(String(seeded[0].role)).not.toBe('admin');
      await sql`DELETE FROM org_audit_log`;

      const response = await deliver(
        'msg_relink',
        membershipCreatedEvent({
          clerkUserId: 'clerk_new_identity',
          email: 'relink@acme.test',
          clerkOrgId: 'org_clerk_relink',
          role: 'org:admin',
        }),
      );
      expect(response.status).toBe(200);

      const rows = await audit();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        // The whole point: the row names whose role changed. Omitting it left a
        // record that a role moved in some organization, for nobody in
        // particular.
        target_user_id: Number(seeded[0].id),
        // Read from the caller's own organization, not the foreign row that
        // shares the address and holds 'admin'.
        old_role: String(seeded[0].role),
        // Was 'Manager' before the #517 fix; org:admin now normalizes to the
        // canonical 'admin' on this path as it always did on the bootstrap one.
        new_role: 'admin',
      });
      expect(JSON.parse(String(rows[0].metadata))).toMatchObject({
        trigger: 'clerk-webhook',
        relinkedByEmail: true,
      });

      // The foreign row is untouched — assert identity, not just counts.
      const foreign = await sql`
        SELECT role, clerk_user_id FROM users WHERE organization_id = 'org-foreign-relink'`;
      expect(foreign[0]).toMatchObject({ role: 'admin', clerk_user_id: 'clerk_foreign' });
    });

    it('grants no role, and stays retryable, when the audit table is missing', async () => {
      await deliver(
        'msg_seed3',
        userCreatedEvent({
          clerkUserId: 'user_missing',
          email: 'm@acme.test',
          clerkOrgId: 'org_clerk_m',
          role: 'org:member',
        }),
      );
      const before = await sql`SELECT role FROM users WHERE clerk_user_id = 'user_missing'`;

      await sql`ALTER TABLE org_audit_log RENAME TO org_audit_log_hidden`;
      let response: Response;
      try {
        response = await deliver(
          'msg_membership_missing',
          membershipCreatedEvent({
            clerkUserId: 'user_missing',
            email: 'm@acme.test',
            clerkOrgId: 'org_clerk_m',
            role: 'org:admin',
          }),
        );
      } finally {
        await sql`ALTER TABLE org_audit_log_hidden RENAME TO org_audit_log`;
      }

      // Fail-closed, and it needs no status-code special case to get there: the
      // role UPDATE and the audit INSERT are one statement, so a missing table
      // means neither runs. Nothing is granted unaudited.
      const after = await sql`SELECT role FROM users WHERE clerk_user_id = 'user_missing'`;
      expect(after[0].role).toBe(before[0].role);

      // Non-2xx, so Svix retries — which is the *wanted* outcome here, unlike on
      // the HTTP paths. There is no human reading this response; the migration
      // gets applied and the retry then lands the grant together with its audit
      // row. Review proposed returning 503 instead for consistency, but 503 in
      // this handler already means "a sibling holds the claim, retry shortly"
      // (the in_flight branch), and Svix retries on any non-2xx regardless — so
      // the change would alter nothing except overload an existing signal.
      expect(response.status).toBeGreaterThanOrEqual(500);

      // The claim is released rather than stranded, so the retry re-drives
      // immediately instead of waiting out the staleness window.
      const marked = await sql`
        SELECT id FROM clerk_webhook_events WHERE id = 'msg_membership_missing'`;
      expect(marked).toHaveLength(0);
    });

    it('writes nothing when a membership delivery repeats the same role', async () => {
      await deliver(
        'msg_seed2',
        userCreatedEvent({
          clerkUserId: 'user_same',
          email: 's@acme.test',
          clerkOrgId: 'org_clerk_s',
          role: 'org:admin',
        }),
      );
      await sql`DELETE FROM org_audit_log`;

      await deliver(
        'msg_membership_same',
        membershipCreatedEvent({
          clerkUserId: 'user_same',
          email: 's@acme.test',
          clerkOrgId: 'org_clerk_s',
          role: 'org:admin',
        }),
      );

      // Clerk redelivers membership events on unrelated profile edits. Without
      // the no-op suppression the trail would fill with entries that record no
      // authorization change at all.
      expect(await audit()).toHaveLength(0);
    });
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
