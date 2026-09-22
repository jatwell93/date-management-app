/**
 * Route- and service-level tests for the credit-claim write surface on Workers.
 *
 * Two of these exist because `retire-express-unify-on-postgres` task 3.1.d read the
 * Express controller tests this migration retires and found two guarantees that live
 * *only* there — porting the routes without porting these would drop them silently:
 *
 *  1. **The claim creator comes from the verified token and never the request body.**
 *     Express passes `req.userId` into `buildClaim` as a separate argument from the
 *     body (`backend/src/controllers/credit-claim.controller.ts:44`, asserted at
 *     `backend/src/tests/controllers/credit-claim.controller.test.ts:65`). The test
 *     below proves a body-supplied `createdByUserId` is *ignored*, not merely absent —
 *     an assertion that the argument equals the token's id would still pass against a
 *     handler that also copied the body field into the input object.
 *  2. **A photo upload with no file is rejected before any work happens.** Express
 *     throws `ValidationError` on `!req.file` ahead of any call
 *     (`credit-claim.controller.ts:52-54`, asserted at the controller test's `:79`).
 *     The test asserts *ordering* — that neither R2 nor the database is touched — not
 *     just the status code, because a handler that uploads the bytes and then returns
 *     400 would pass a status-only check while leaving an orphan object in the bucket.
 *
 * The remainder cover the send/outcome preconditions and the refusal→status mapping,
 * which is the Worker's stand-in for Express's error middleware.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveMinimalApiRoute, type MinimalApiRoute } from './minimal-api-routes';
import * as minimalEntrypoint from './index-minimal';
import { authenticateClerkRequest } from './clerk/bootstrap-handler';
import { recordOutcome, sendClaim, sendFollowUp } from './credit-claim-service';
import type { CreditClaim, Database } from './database';
import type { Env } from './types/env';

vi.mock('./clerk/bootstrap-handler', () => ({
  authenticateClerkRequest: vi.fn(),
  getClerkAuthorizedParties: vi.fn(() => []),
  handleOrganizationBootstrap: vi.fn().mockResolvedValue(new Response('bootstrap')),
}));

const mockedAuthenticateClerkRequest = vi.mocked(authenticateClerkRequest);
const authenticatedClerkOrgContext = {
  clerkUserId: 'user_clerk_123',
  email: 'user@example.com',
  username: 'user',
  organizationId: 'org_123',
  organizationRole: 'org:admin',
};

/** The authenticated user resolved from the token — id 7, organization `org_123`. */
const TOKEN_USER_ID = 7;
const ORG = 'org_123';

function getMinimalRoutes(): MinimalApiRoute[] {
  return (
    minimalEntrypoint as typeof minimalEntrypoint & { MINIMAL_API_ROUTES?: MinimalApiRoute[] }
  ).MINIMAL_API_ROUTES!;
}

function createAuthenticatedDb(methodOverrides: Partial<Record<keyof Database, unknown>>) {
  return {
    ...methodOverrides,
    sql: vi.fn((strings: TemplateStringsArray) =>
      strings.join(' ').includes('FROM users')
        ? Promise.resolve([{ id: TOKEN_USER_ID, organizationId: ORG, role: 'admin' }])
        : Promise.resolve([]),
    ),
  } as unknown as Database;
}

/** An R2 bucket whose every method records the call and nothing else. */
function createBucket() {
  return {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

function envWith(bucket: ReturnType<typeof createBucket>, extra: Partial<Env> = {}): Env {
  return { CSV_UPLOADS: bucket, ...extra } as unknown as Env;
}

function dispatch(
  method: string,
  pathname: string,
  db: Database,
  env: Env,
  init: RequestInit = {},
) {
  return resolveMinimalApiRoute(getMinimalRoutes(), {
    request: new Request(`https://example.com${pathname}`, { method, ...init }),
    pathname,
    method,
    db,
    env,
  });
}

function jsonPost(pathname: string, body: unknown, db: Database, env: Env) {
  return dispatch('POST', pathname, db, env, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A minimal DRAFT claim with one line, enough for the send preconditions. */
function draftClaim(overrides: Partial<CreditClaim> = {}): CreditClaim {
  return {
    id: 1,
    supplierId: 10,
    status: 'DRAFT',
    contactEmailSnapshot: 'claims@acme.test',
    expectedCreditUnits: 2,
    expectedCreditValue: 20,
    creditedValue: null,
    sentAt: null,
    nextFollowUpAt: null,
    followUpCount: 0,
    settledAt: null,
    supplier: {
      id: 10,
      name: 'Acme Wholesale',
      creditType: 'FULL_CREDIT',
      contactEmail: 'claims@acme.test',
      contactPhone: null,
      creditPolicyNote: '',
      policyWriteOffQty: 3,
      policyCreditQty: 1,
      followUpDays: 7,
      representativeName: null,
      representativeEmail: null,
      policyUpdatedAt: null,
    },
    lines: [
      {
        id: 100,
        expiredItemTransactionId: 500,
        batchNumber: null,
        unitsClaimed: 6,
        expectedCreditUnits: 2,
        expectedCreditValue: 20,
        photos: [],
      },
    ],
    events: [],
    ...overrides,
  } as CreditClaim;
}

describe('credit-claim write routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAuthenticateClerkRequest.mockResolvedValue(authenticatedClerkOrgContext);
  });

  describe('POST /api/supplier-credits/claims', () => {
    it('takes the creator from the verified token and ignores a body-supplied one', async () => {
      const buildCreditClaim = vi.fn().mockResolvedValue({ ok: true, value: draftClaim() });
      const db = createAuthenticatedDb({ buildCreditClaim });

      const response = await jsonPost(
        '/api/supplier-credits/claims',
        {
          supplierId: 10,
          lines: [{ expiredItemTransactionId: 500 }],
          // The attack: attribute the claim to someone else.
          createdByUserId: 999,
          userId: 999,
        },
        db,
        envWith(createBucket()),
      );

      expect(response?.status).toBe(201);
      expect(buildCreditClaim).toHaveBeenCalledTimes(1);
      const [organizationId, input, createdByUserId] = buildCreditClaim.mock.calls[0];
      expect(organizationId).toBe(ORG);
      expect(createdByUserId).toBe(TOKEN_USER_ID);
      // Ignored, not merely overridden: the body's fields must not reach the input at
      // all, or a future change that reads `input.createdByUserId` would resurrect the
      // hole without this test noticing.
      expect(Object.keys(input).sort()).toEqual(['lines', 'supplierId']);
    });

    it('scopes the build to the organization on the token, not one in the body', async () => {
      const buildCreditClaim = vi.fn().mockResolvedValue({ ok: true, value: draftClaim() });
      const db = createAuthenticatedDb({ buildCreditClaim });

      await jsonPost(
        '/api/supplier-credits/claims',
        { supplierId: 10, lines: [{ expiredItemTransactionId: 500 }], organizationId: 'org_evil' },
        db,
        envWith(createBucket()),
      );

      expect(buildCreditClaim.mock.calls[0][0]).toBe(ORG);
    });

    it('passes a per-line unitsClaimed through and defaults it to undefined otherwise', async () => {
      const buildCreditClaim = vi.fn().mockResolvedValue({ ok: true, value: draftClaim() });
      const db = createAuthenticatedDb({ buildCreditClaim });

      await jsonPost(
        '/api/supplier-credits/claims',
        {
          supplierId: 10,
          lines: [
            { expiredItemTransactionId: 500, unitsClaimed: 3, batchNumber: 'B-1' },
            { expiredItemTransactionId: 501 },
          ],
        },
        db,
        envWith(createBucket()),
      );

      expect(buildCreditClaim.mock.calls[0][1].lines).toEqual([
        { expiredItemTransactionId: 500, batchNumber: 'B-1', unitsClaimed: 3 },
        { expiredItemTransactionId: 501, batchNumber: null, unitsClaimed: undefined },
      ]);
    });

    it.each([
      ['a missing supplier id', { lines: [{ expiredItemTransactionId: 1 }] }],
      ['a missing line list', { supplierId: 10 }],
      ['a line with no transaction id', { supplierId: 10, lines: [{}] }],
      [
        'a non-positive unitsClaimed',
        { supplierId: 10, lines: [{ expiredItemTransactionId: 1, unitsClaimed: 0 }] },
      ],
    ])('rejects %s without calling the database', async (_label, body) => {
      const buildCreditClaim = vi.fn();
      const db = createAuthenticatedDb({ buildCreditClaim });

      const response = await jsonPost(
        '/api/supplier-credits/claims',
        body,
        db,
        envWith(createBucket()),
      );

      expect(response?.status).toBe(400);
      expect(buildCreditClaim).not.toHaveBeenCalled();
    });

    it.each([
      ['NOT_FOUND', 404],
      ['VALIDATION', 400],
      ['CONFLICT', 409],
    ])('maps a %s refusal to %i', async (code, status) => {
      const db = createAuthenticatedDb({
        buildCreditClaim: vi.fn().mockResolvedValue({ ok: false, code, message: 'nope' }),
      });

      const response = await jsonPost(
        '/api/supplier-credits/claims',
        { supplierId: 10, lines: [{ expiredItemTransactionId: 500 }] },
        db,
        envWith(createBucket()),
      );

      expect(response?.status).toBe(status);
    });
  });

  describe('POST /api/supplier-credits/claims/:id/lines/:lineId/photos', () => {
    it('rejects an upload with no file before touching R2 or the database', async () => {
      const addCreditClaimPhoto = vi.fn();
      const db = createAuthenticatedDb({ addCreditClaimPhoto });
      const bucket = createBucket();

      const response = await dispatch(
        'POST',
        '/api/supplier-credits/claims/1/lines/100/photos',
        db,
        envWith(bucket),
        { body: new FormData() },
      );

      expect(response?.status).toBe(400);
      // Ordering, not just the status: nothing may have been written anywhere.
      expect(bucket.put).not.toHaveBeenCalled();
      expect(addCreditClaimPhoto).not.toHaveBeenCalled();
    });

    it('rejects a non-file "file" field before touching R2 or the database', async () => {
      const addCreditClaimPhoto = vi.fn();
      const db = createAuthenticatedDb({ addCreditClaimPhoto });
      const bucket = createBucket();
      const form = new FormData();
      form.set('file', 'not-a-file');

      const response = await dispatch(
        'POST',
        '/api/supplier-credits/claims/1/lines/100/photos',
        db,
        envWith(bucket),
        { body: form },
      );

      expect(response?.status).toBe(400);
      expect(bucket.put).not.toHaveBeenCalled();
      expect(addCreditClaimPhoto).not.toHaveBeenCalled();
    });

    it('stores an image under a key scoped to the organization, claim and line', async () => {
      const addCreditClaimPhoto = vi.fn().mockResolvedValue({
        ok: true,
        value: { id: 1, fileName: 'lot.jpg', sizeBytes: 3 },
      });
      const db = createAuthenticatedDb({ addCreditClaimPhoto });
      const bucket = createBucket();
      const form = new FormData();
      form.set('file', new File(['abc'], 'lot.jpg', { type: 'image/jpeg' }));

      const response = await dispatch(
        'POST',
        '/api/supplier-credits/claims/1/lines/100/photos',
        db,
        envWith(bucket),
        { body: form },
      );

      expect(response?.status).toBe(201);
      const [key] = bucket.put.mock.calls[0];
      expect(key).toMatch(new RegExp(`^credit-claims/${ORG}/1/100/[0-9a-f-]{36}-lot\\.jpg$`));
      expect(addCreditClaimPhoto).toHaveBeenCalledWith(ORG, 1, 100, {
        storageKey: key,
        fileName: 'lot.jpg',
        sizeBytes: 3,
      });
    });

    it('strips path segments out of a crafted filename so the key cannot escape its prefix', async () => {
      const db = createAuthenticatedDb({
        addCreditClaimPhoto: vi
          .fn()
          .mockResolvedValue({ ok: true, value: { id: 1, fileName: 'x', sizeBytes: 3 } }),
      });
      const bucket = createBucket();
      const form = new FormData();
      form.set('file', new File(['abc'], '../../etc/passwd', { type: 'image/png' }));

      await dispatch(
        'POST',
        '/api/supplier-credits/claims/1/lines/100/photos',
        db,
        envWith(bucket),
        {
          body: form,
        },
      );

      const [key] = bucket.put.mock.calls[0];
      expect(key).toContain(`credit-claims/${ORG}/1/100/`);
      expect(key).not.toContain('..');
      expect(key.endsWith('-passwd')).toBe(true);
    });

    it('refuses a non-image upload before writing to R2', async () => {
      const addCreditClaimPhoto = vi.fn();
      const db = createAuthenticatedDb({ addCreditClaimPhoto });
      const bucket = createBucket();
      const form = new FormData();
      form.set('file', new File(['x'], 'payload.pdf', { type: 'application/pdf' }));

      const response = await dispatch(
        'POST',
        '/api/supplier-credits/claims/1/lines/100/photos',
        db,
        envWith(bucket),
        { body: form },
      );

      expect(response?.status).toBe(400);
      expect(bucket.put).not.toHaveBeenCalled();
      expect(addCreditClaimPhoto).not.toHaveBeenCalled();
    });

    it('deletes the uploaded object when the row is refused, leaving no orphan', async () => {
      const db = createAuthenticatedDb({
        addCreditClaimPhoto: vi
          .fn()
          .mockResolvedValue({ ok: false, code: 'VALIDATION', message: 'not a draft' }),
      });
      const bucket = createBucket();
      const form = new FormData();
      form.set('file', new File(['abc'], 'lot.jpg', { type: 'image/jpeg' }));

      const response = await dispatch(
        'POST',
        '/api/supplier-credits/claims/1/lines/100/photos',
        db,
        envWith(bucket),
        { body: form },
      );

      expect(response?.status).toBe(400);
      const [key] = bucket.put.mock.calls[0];
      expect(bucket.delete).toHaveBeenCalledWith(key);
    });
  });

  describe('sendClaim preconditions', () => {
    const bucket = createBucket();

    it('refuses a claim with no lines, without reserving it', async () => {
      const reserveClaimForSending = vi.fn();
      const db = createAuthenticatedDb({
        findCreditClaim: vi.fn().mockResolvedValue(draftClaim({ lines: [] })),
        reserveClaimForSending,
      });

      const result = await sendClaim(db, envWith(bucket), ORG, 1);

      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
      expect(reserveClaimForSending).not.toHaveBeenCalled();
    });

    it('refuses a supplier with no contact email, without reserving it', async () => {
      const reserveClaimForSending = vi.fn();
      const claim = draftClaim({ contactEmailSnapshot: null });
      claim.supplier.contactEmail = null;
      const db = createAuthenticatedDb({
        findCreditClaim: vi.fn().mockResolvedValue(claim),
        reserveClaimForSending,
      });

      const result = await sendClaim(db, envWith(bucket), ORG, 1);

      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
      expect(result.ok === false && result.message).toContain('no contact email');
      expect(reserveClaimForSending).not.toHaveBeenCalled();
    });

    it('refuses a claim that is not a draft', async () => {
      const db = createAuthenticatedDb({
        findCreditClaim: vi.fn().mockResolvedValue(draftClaim({ status: 'SENT' })),
        reserveClaimForSending: vi.fn(),
      });

      const result = await sendClaim(db, envWith(bucket), ORG, 1);
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    });

    it('reports a lost reservation as a conflict rather than sending twice', async () => {
      const finalizeSentClaim = vi.fn();
      const db = createAuthenticatedDb({
        findCreditClaim: vi.fn().mockResolvedValue(draftClaim()),
        reserveClaimForSending: vi.fn().mockResolvedValue(false),
        finalizeSentClaim,
      });

      const result = await sendClaim(db, envWith(bucket), ORG, 1);

      expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
      expect(finalizeSentClaim).not.toHaveBeenCalled();
    });

    it('returns the claim to draft when the email provider is unconfigured', async () => {
      const revertClaimToDraft = vi.fn();
      const finalizeSentClaim = vi.fn();
      const db = createAuthenticatedDb({
        findCreditClaim: vi.fn().mockResolvedValue(draftClaim()),
        reserveClaimForSending: vi.fn().mockResolvedValue(true),
        listClaimPhotoKeys: vi.fn().mockResolvedValue([]),
        revertClaimToDraft,
        finalizeSentClaim,
      });

      // No RESEND_API_KEY in the env: the send must degrade to a refusal, and must not
      // leave the claim stuck in SENDING where nothing can retry it.
      const result = await sendClaim(db, envWith(bucket), ORG, 1);

      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
      expect(revertClaimToDraft).toHaveBeenCalledWith(ORG, 1);
      expect(finalizeSentClaim).not.toHaveBeenCalled();
    });

    it('sends, then records sentAt and the first follow-up from the supplier cadence', async () => {
      const finalizeSentClaim = vi.fn();
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));
      const db = createAuthenticatedDb({
        findCreditClaim: vi
          .fn()
          .mockResolvedValueOnce(draftClaim())
          .mockResolvedValue(draftClaim({ status: 'SENT' })),
        reserveClaimForSending: vi.fn().mockResolvedValue(true),
        listClaimPhotoKeys: vi.fn().mockResolvedValue([]),
        finalizeSentClaim,
      });

      const sentAt = new Date('2026-09-22T10:00:00.000Z');
      const result = await sendClaim(
        db,
        envWith(bucket, { RESEND_API_KEY: 'test-key' }),
        ORG,
        1,
        () => sentAt,
      );

      expect(result.ok).toBe(true);
      expect(finalizeSentClaim).toHaveBeenCalledWith(ORG, 1, {
        contactEmail: 'claims@acme.test',
        sentAt,
        // 7-day cadence, first nudge: sentAt + 7 days, deterministic from the send
        // time rather than from whenever the reminder job happens to run.
        nextFollowUpAt: new Date('2026-09-29T10:00:00.000Z'),
      });
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({ method: 'POST' }),
      );
      fetchSpy.mockRestore();
    });
  });

  describe('sendFollowUp preconditions', () => {
    const bucket = createBucket();

    it.each([
      ['a draft claim', draftClaim()],
      ['a settled claim', draftClaim({ status: 'CREDITED', sentAt: '2026-09-22 10:00:00' })],
      ['a claim never actually sent', draftClaim({ status: 'SENT', sentAt: null })],
    ])('refuses %s without reserving a slot', async (_label, claim) => {
      const reserveFollowUp = vi.fn();
      const db = createAuthenticatedDb({
        findCreditClaim: vi.fn().mockResolvedValue(claim),
        reserveFollowUp,
      });

      const result = await sendFollowUp(db, envWith(bucket), ORG, 1);

      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
      expect(reserveFollowUp).not.toHaveBeenCalled();
    });

    it('schedules the next nudge from the send time, not from now', async () => {
      const reserveFollowUp = vi.fn().mockResolvedValue(true);
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));
      const db = createAuthenticatedDb({
        findCreditClaim: vi.fn().mockResolvedValue(
          // A timezone-naive string, exactly as `sent_at::text` returns it from a
          // `timestamp(3)` column — it must be read as UTC regardless of the runtime.
          draftClaim({ status: 'SENT', sentAt: '2026-09-22 10:00:00', followUpCount: 1 }),
        ),
        reserveFollowUp,
        listClaimPhotoKeys: vi.fn().mockResolvedValue([]),
        addCreditClaimEvent: vi.fn(),
      });

      await sendFollowUp(db, envWith(bucket, { RESEND_API_KEY: 'test-key' }), ORG, 1);

      // The schedule is derived from the send time, never from `now`: with a 7-day
      // cadence the slot is `sentAt + followUpDays * (nextCount + 1)`, so advancing
      // from count 1 to 2 lands 21 days after the send. Byte-identical to the backend
      // (`credit-claim.service.ts` passes the *incremented* count into nextFollowUp).
      expect(reserveFollowUp).toHaveBeenCalledWith(ORG, 1, 1, {
        followUpCount: 2,
        nextFollowUpAt: new Date('2026-10-13T10:00:00.000Z'),
      });
      fetchSpy.mockRestore();
    });

    it('restores the schedule when the send fails after the slot was reserved', async () => {
      const restoreFollowUpSchedule = vi.fn().mockResolvedValue(undefined);
      const addCreditClaimEvent = vi.fn();
      const db = createAuthenticatedDb({
        findCreditClaim: vi
          .fn()
          .mockResolvedValue(
            draftClaim({
              status: 'SENT',
              sentAt: '2026-09-22 10:00:00',
              nextFollowUpAt: '2026-09-29 10:00:00',
            }),
          ),
        reserveFollowUp: vi.fn().mockResolvedValue(true),
        listClaimPhotoKeys: vi.fn().mockResolvedValue([]),
        restoreFollowUpSchedule,
        addCreditClaimEvent,
      });

      // Unconfigured provider: the reservation must be rolled back to what was
      // observed, or the reminder engine skips this claim forever.
      const result = await sendFollowUp(db, envWith(bucket), ORG, 1);

      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
      expect(restoreFollowUpSchedule).toHaveBeenCalledWith(ORG, 1, {
        followUpCount: 0,
        nextFollowUpAt: '2026-09-29 10:00:00',
      });
      expect(addCreditClaimEvent).not.toHaveBeenCalled();
    });
  });

  describe('recordOutcome preconditions', () => {
    it('refuses an outcome for a claim that was never sent', async () => {
      const recordClaimOutcome = vi.fn();
      const db = createAuthenticatedDb({
        findCreditClaim: vi.fn().mockResolvedValue(draftClaim()),
        recordClaimOutcome,
      });

      const result = await recordOutcome(db, ORG, 1, 'CREDITED', 10, null);

      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
      expect(recordClaimOutcome).not.toHaveBeenCalled();
    });

    it.each(['CREDITED', 'REJECTED', 'CANCELLED'])(
      'refuses a second outcome for a claim already settled as %s',
      async (status) => {
        const recordClaimOutcome = vi.fn();
        const db = createAuthenticatedDb({
          findCreditClaim: vi.fn().mockResolvedValue(draftClaim({ status })),
          recordClaimOutcome,
        });

        const result = await recordOutcome(db, ORG, 1, 'CREDITED', 10, null);

        expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
        expect(result.ok === false && result.message).toContain('final');
        expect(recordClaimOutcome).not.toHaveBeenCalled();
      },
    );

    it('accepts a top-up outcome on a partially credited claim', async () => {
      // The one settled status that stays open, so a later top-up can progress it to
      // CREDITED. Pinned because the "already settled" guard above would otherwise be
      // the obvious place to accidentally exclude it.
      const recordClaimOutcome = vi.fn();
      const db = createAuthenticatedDb({
        findCreditClaim: vi.fn().mockResolvedValue(draftClaim({ status: 'PARTIALLY_CREDITED' })),
        recordClaimOutcome,
      });

      const result = await recordOutcome(db, ORG, 1, 'CREDITED', 25, 'topped up');

      expect(result.ok).toBe(true);
      expect(recordClaimOutcome).toHaveBeenCalledTimes(1);
    });

    it('schedules the photo purge for the retention window after settlement', async () => {
      const recordClaimOutcome = vi.fn();
      const db = createAuthenticatedDb({
        findCreditClaim: vi.fn().mockResolvedValue(draftClaim({ status: 'SENT' })),
        recordClaimOutcome,
      });
      const settledAt = new Date('2026-09-22T10:00:00.000Z');

      await recordOutcome(db, ORG, 1, 'CREDITED', 20, null, () => settledAt);

      const [, , , , , actualSettledAt, deleteAfter] = recordClaimOutcome.mock.calls[0];
      expect(actualSettledAt).toEqual(settledAt);
      // 90 days of retention, counted from settlement.
      expect(deleteAfter).toEqual(new Date('2026-12-21T10:00:00.000Z'));
    });

    it('rejects an outcome outside the accepted vocabulary at the route', async () => {
      const recordClaimOutcome = vi.fn();
      const findCreditClaim = vi.fn();
      const db = createAuthenticatedDb({ findCreditClaim, recordClaimOutcome });

      const response = await jsonPost(
        '/api/supplier-credits/claims/1/outcome',
        { outcome: 'ACKNOWLEDGED' },
        db,
        envWith(createBucket()),
      );

      expect(response?.status).toBe(400);
      expect(findCreditClaim).not.toHaveBeenCalled();
      expect(recordClaimOutcome).not.toHaveBeenCalled();
    });
  });

  describe('route table', () => {
    it.each([
      ['POST', '/api/supplier-credits/claims'],
      ['GET', '/api/supplier-credits/claims/1'],
      ['POST', '/api/supplier-credits/claims/1/lines/2/photos'],
      ['POST', '/api/supplier-credits/claims/1/send'],
      ['POST', '/api/supplier-credits/claims/1/follow-up'],
      ['POST', '/api/supplier-credits/claims/1/outcome'],
    ])('routes %s %s to a handler', (method, pathname) => {
      const matched = getMinimalRoutes().some(
        ([routeMethod, match]) =>
          routeMethod === method &&
          (typeof match === 'string' ? match === pathname : match.test(pathname)),
      );
      expect(matched).toBe(true);
    });

    it('does not let the claim-detail route swallow the sub-resource paths', async () => {
      // `/claims/1/send` must not match the detail regex, or a send would return the
      // claim as a 200 and never actually send.
      const detail = getMinimalRoutes().find(
        ([method, match]) =>
          method === 'GET' &&
          match instanceof RegExp &&
          match.test('/api/supplier-credits/claims/1'),
      );
      const match = detail?.[1] as RegExp;
      expect(match.test('/api/supplier-credits/claims/1/send')).toBe(false);
      expect(match.test('/api/supplier-credits/claims/1/lines/2/photos')).toBe(false);
    });
  });
});
