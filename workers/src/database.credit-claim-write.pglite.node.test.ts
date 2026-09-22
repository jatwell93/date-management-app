/**
 * Real-SQL (pglite) coverage for the credit-claim **write** path on the Workers
 * runtime — `buildCreditClaim`, photo metadata, the send/follow-up reservations, and
 * outcome settlement.
 *
 * The read side (`getClaimablePool`) is already proven against the Express backend by
 * `database.credit-claim.conformance.node.test.ts`. This file covers what that one
 * explicitly deferred: the writes, which are the part that can corrupt data rather
 * than merely display it wrongly.
 *
 * Three properties get deliberate attention, because each is a place where a test can
 * look green without being evidence:
 *
 *  - **Atomicity.** The Neon HTTP driver has no transactions, so build-a-claim is one
 *    statement with CTEs. A test that only checks the happy path would pass against a
 *    version that inserts the header and then fails on the lines, leaving a headless
 *    claim. The "rolls the whole build back" test forces the line insert to fail and
 *    asserts no header survives.
 *  - **Isolation.** Every cross-tenant test seeds a foreign row that WOULD be returned
 *    or mutated if scoping regressed, then asserts identity — not count — plus the
 *    victim's row being untouched. (See the tenant-isolation files for the pattern.)
 *  - **The reservations.** `reserveClaimForSending` and `reserveFollowUp` are
 *    single-row CAS updates. pglite serialises, so "run them concurrently" would prove
 *    nothing; the tests instead call them twice in sequence from the same observed
 *    state, which is exactly what the CAS is there to refuse.
 *
 * Runs under `vitest.node.config.mts` (`*.node.test.ts`, `npm run test:db`) because
 * pglite is WASM and needs a Node runtime.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeonQueryFunction } from '@neondatabase/serverless';
import type { Env } from './types/env';
import { createPgliteHarness, createTaggedSql, type PgliteHarness } from './__tests__/pglite-db';
import { expectedCredit } from '../../shared/domain/credit-claim';
import { parseDbTimestamp } from './credit-claim-service';

const sqlHolder = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlHolder.current),
}));

import { createWorkersDatabase } from './database';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';

function makeDb() {
  return createWorkersDatabase({ NEON_CONNECTION_STRING: 'postgres://test' } as Env);
}

describe('Workers credit-claim writes (real SQL)', () => {
  let harness: PgliteHarness;
  let sql: NeonQueryFunction<false, false>;
  let db: ReturnType<typeof makeDb>;

  // Captured per test: SERIAL keeps counting across truncations, so literal ids
  // would drift as tests are added or reordered.
  let supplierId: number;
  let foreignSupplierId: number;
  let productId: number;
  let writeOffIds: number[];
  let foreignWriteOffId: number;

  beforeAll(async () => {
    harness = await createPgliteHarness();
    sql = createTaggedSql(harness.pg);
    sqlHolder.current = sql;
    db = makeDb();

    await sql`
      INSERT INTO organizations (id, name, slug)
      VALUES (${ORG}, 'Org A', 'org-a'), (${OTHER_ORG}, 'Org B', 'org-b')
      ON CONFLICT (id) DO NOTHING`;
  });

  afterAll(async () => {
    await harness.close();
  });

  /**
   * Seed one supplier with a 3-for-1 policy and two expired write-offs of 6 units at
   * £10 cost, plus a mirror fixture in the other organization. 6 units at 3→1 is two
   * credit units, so every expected-credit assertion below has a value that is wrong
   * under the two obvious mistakes (ratio ignored, or ratio applied per-unit).
   */
  beforeEach(async () => {
    await sql`DELETE FROM credit_claim_events`;
    await sql`DELETE FROM credit_claim_photos`;
    await sql`DELETE FROM credit_claim_lines`;
    await sql`DELETE FROM credit_claims`;
    await sql`DELETE FROM expired_item_transactions`;
    await sql`DELETE FROM inventory_items`;
    await sql`DELETE FROM products`;
    await sql`DELETE FROM suppliers`;

    const supplier = await sql`
      INSERT INTO suppliers (organization_id, name, contact_email, policy_write_off_qty,
                             policy_credit_qty, follow_up_days)
      VALUES (${ORG}, 'Acme Wholesale', 'claims@acme.test', 3, 1, 7)
      RETURNING id`;
    supplierId = Number(supplier[0].id);

    const foreignSupplier = await sql`
      INSERT INTO suppliers (organization_id, name, contact_email, policy_write_off_qty,
                             policy_credit_qty, follow_up_days)
      VALUES (${OTHER_ORG}, 'Other Wholesale', 'claims@other.test', 3, 1, 7)
      RETURNING id`;
    foreignSupplierId = Number(foreignSupplier[0].id);

    const product = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, supplier_id)
      VALUES (${ORG}, 'BAR-A', 'SKU-A', 'Widget', 10, ${supplierId})
      RETURNING id`;
    productId = Number(product[0].id);

    const foreignProduct = await sql`
      INSERT INTO products (organization_id, barcode, sku, name, cost_price, supplier_id)
      VALUES (${OTHER_ORG}, 'BAR-B', 'SKU-B', 'Foreign Widget', 10, ${foreignSupplierId})
      RETURNING id`;
    const foreignProductId = Number(foreignProduct[0].id);

    writeOffIds = [];
    for (let i = 0; i < 2; i += 1) {
      const item = await sql`
        INSERT INTO inventory_items (organization_id, product_id, expiry_date)
        VALUES (${ORG}, ${productId}, NOW())
        RETURNING id`;
      const transaction = await sql`
        INSERT INTO expired_item_transactions (organization_id, inventory_item_id, action,
                                               units_discarded)
        VALUES (${ORG}, ${Number(item[0].id)}, 'expired', 6)
        RETURNING id`;
      writeOffIds.push(Number(transaction[0].id));
    }

    const foreignItem = await sql`
      INSERT INTO inventory_items (organization_id, product_id, expiry_date)
      VALUES (${OTHER_ORG}, ${foreignProductId}, NOW())
      RETURNING id`;
    const foreignTransaction = await sql`
      INSERT INTO expired_item_transactions (organization_id, inventory_item_id, action,
                                             units_discarded)
      VALUES (${OTHER_ORG}, ${Number(foreignItem[0].id)}, 'expired', 6)
      RETURNING id`;
    foreignWriteOffId = Number(foreignTransaction[0].id);
  });

  const buildOneLine = (userId: number | null = 42) =>
    db.buildCreditClaim(
      ORG,
      { supplierId, lines: [{ expiredItemTransactionId: writeOffIds[0] }] },
      userId,
    );

  describe('buildCreditClaim', () => {
    it('creates the claim, its lines and its CREATED event in one write', async () => {
      const result = await db.buildCreditClaim(
        ORG,
        {
          supplierId,
          lines: [
            { expiredItemTransactionId: writeOffIds[0], batchNumber: '  B-1  ' },
            { expiredItemTransactionId: writeOffIds[1] },
          ],
        },
        42,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const claim = result.value;

      expect(claim.status).toBe('DRAFT');
      expect(claim.supplierId).toBe(supplierId);
      expect(claim.contactEmailSnapshot).toBe('claims@acme.test');
      expect(claim.lines.map((l) => l.expiredItemTransactionId)).toEqual(writeOffIds);
      // Batch numbers are trimmed, matching the backend's `batchNumber?.trim() || null`.
      expect(claim.lines[0].batchNumber).toBe('B-1');
      expect(claim.lines[1].batchNumber).toBeNull();
      expect(claim.events.map((e) => e.type)).toEqual(['CREATED']);
    });

    it('snapshots the expected credit the shared resolver computes, not a re-derivation', async () => {
      const result = await buildOneLine();
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // 6 units at a 3-for-1 ratio and £10 cost: 2 units, £20. Asserted against the
      // shared resolver so this test tracks the domain module rather than restating a
      // literal that could drift away from it.
      const expected = expectedCredit({ writeOffQty: 3, creditQty: 1 }, 6, 10);
      expect(expected).toEqual({ units: 2, value: 20 });
      expect(result.value.lines[0].expectedCreditUnits).toBe(expected.units);
      expect(result.value.lines[0].expectedCreditValue).toBe(expected.value);
      // The header carries the aggregate, so a later policy or price change cannot
      // rewrite an already-built claim.
      expect(result.value.expectedCreditUnits).toBe(2);
      expect(result.value.expectedCreditValue).toBe(20);
    });

    it('records the creator passed by the caller, on the claim and its event', async () => {
      const result = await buildOneLine(42);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const rows = await sql`
        SELECT cc.created_by_user_id AS claim_user, e.user_id AS event_user
        FROM credit_claims cc
        JOIN credit_claim_events e ON e.claim_id = cc.id
        WHERE cc.id = ${result.value.id}`;
      expect(Number(rows[0].claim_user)).toBe(42);
      expect(Number(rows[0].event_user)).toBe(42);
    });

    it('accepts a null creator without inventing one', async () => {
      const result = await buildOneLine(null);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const rows = await sql`
        SELECT created_by_user_id FROM credit_claims WHERE id = ${result.value.id}`;
      expect(rows[0].created_by_user_id).toBeNull();
    });

    it('honours an explicit unitsClaimed below the write-off quantity', async () => {
      const result = await db.buildCreditClaim(
        ORG,
        { supplierId, lines: [{ expiredItemTransactionId: writeOffIds[0], unitsClaimed: 3 }] },
        42,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.lines[0].unitsClaimed).toBe(3);
      // 3 units at 3-for-1 is one credit unit, distinguishing this from the 6-unit default.
      expect(result.value.lines[0].expectedCreditUnits).toBe(1);
      expect(result.value.lines[0].expectedCreditValue).toBe(10);
    });

    it('reports unknown, not zero, expected credit when the supplier has no ratio', async () => {
      await sql`
        UPDATE suppliers SET policy_write_off_qty = NULL, policy_credit_qty = NULL
        WHERE id = ${supplierId}`;

      const result = await buildOneLine();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.lines[0].expectedCreditUnits).toBeNull();
      expect(result.value.lines[0].expectedCreditValue).toBeNull();
      expect(result.value.expectedCreditUnits).toBeNull();
      expect(result.value.expectedCreditValue).toBeNull();
    });

    it.each([
      ['an empty line list', () => ({ supplierId, lines: [] }), 'at least one line'],
      [
        'the same write-off twice',
        () => ({
          supplierId,
          lines: [
            { expiredItemTransactionId: writeOffIds[0] },
            { expiredItemTransactionId: writeOffIds[0] },
          ],
        }),
        'only appear once',
      ],
    ])('refuses %s', async (_label, input, fragment) => {
      const result = await db.buildCreditClaim(ORG, input(), 42);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('VALIDATION');
      expect(result.message).toContain(fragment);
      // Nothing may be written on a refusal.
      expect(await sql`SELECT id FROM credit_claims`).toHaveLength(0);
    });

    it('refuses a write-off that is not an expired-stock write-off', async () => {
      await sql`
        UPDATE expired_item_transactions SET action = 'markdown' WHERE id = ${writeOffIds[0]}`;

      const result = await buildOneLine();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('VALIDATION');
      expect(result.message).toContain('not an expired-stock write-off');
    });

    it('refuses a write-off already attached to a claim', async () => {
      const first = await buildOneLine();
      expect(first.ok).toBe(true);

      const second = await buildOneLine();
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.code).toBe('VALIDATION');
      expect(second.message).toContain('already on a claim');
      // The first claim is the only one, i.e. the refusal wrote nothing.
      expect(await sql`SELECT id FROM credit_claims`).toHaveLength(1);
    });

    it('refuses a write-off whose product belongs to a different supplier', async () => {
      const otherSupplier = await sql`
        INSERT INTO suppliers (organization_id, name, policy_write_off_qty, policy_credit_qty)
        VALUES (${ORG}, 'Beta Supplies', 3, 1) RETURNING id`;

      const result = await db.buildCreditClaim(
        ORG,
        {
          supplierId: Number(otherSupplier[0].id),
          lines: [{ expiredItemTransactionId: writeOffIds[0] }],
        },
        42,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('VALIDATION');
      expect(result.message).toContain('not assigned to this supplier');
    });

    it('refuses a write-off with no units to claim', async () => {
      await sql`
        UPDATE expired_item_transactions SET units_discarded = 0 WHERE id = ${writeOffIds[0]}`;

      const result = await buildOneLine();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toContain('no units to claim');
    });

    it('reports a missing supplier as not-found, distinctly from a validation refusal', async () => {
      const result = await db.buildCreditClaim(
        ORG,
        { supplierId: supplierId + 9999, lines: [{ expiredItemTransactionId: writeOffIds[0] }] },
        42,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('NOT_FOUND');
    });

    /**
     * The atomicity guarantee. A temporary CHECK constraint makes the *line* insert
     * fail after the header insert has already been evaluated in the same statement —
     * the exact shape of failure that a header-then-lines implementation would leave
     * half-applied. Without CTE atomicity this test finds an orphaned claim row.
     */
    it('rolls the whole build back when the line insert fails', async () => {
      await sql`
        ALTER TABLE credit_claim_lines
        ADD CONSTRAINT tmp_units_ceiling CHECK (units_claimed < 1000)`;
      try {
        await expect(
          db.buildCreditClaim(
            ORG,
            {
              supplierId,
              lines: [{ expiredItemTransactionId: writeOffIds[0], unitsClaimed: 5000 }],
            },
            42,
          ),
        ).rejects.toThrow();

        expect(await sql`SELECT id FROM credit_claims`).toHaveLength(0);
        expect(await sql`SELECT id FROM credit_claim_lines`).toHaveLength(0);
        expect(await sql`SELECT id FROM credit_claim_events`).toHaveLength(0);
      } finally {
        await sql`ALTER TABLE credit_claim_lines DROP CONSTRAINT tmp_units_ceiling`;
      }
    });

    it("cannot claim another organization's write-off", async () => {
      const result = await db.buildCreditClaim(
        ORG,
        { supplierId, lines: [{ expiredItemTransactionId: foreignWriteOffId }] },
        42,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('NOT_FOUND');
      // And the victim's write-off is still unclaimed.
      const lines = await sql`
        SELECT id FROM credit_claim_lines
        WHERE expired_item_transaction_id = ${foreignWriteOffId}`;
      expect(lines).toHaveLength(0);
    });

    it("cannot claim against another organization's supplier", async () => {
      const result = await db.buildCreditClaim(
        ORG,
        { supplierId: foreignSupplierId, lines: [{ expiredItemTransactionId: writeOffIds[0] }] },
        42,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('NOT_FOUND');
    });
  });

  describe('findCreditClaim / listCreditClaims', () => {
    it("does not return another organization's claim by id", async () => {
      const mine = await buildOneLine();
      expect(mine.ok).toBe(true);
      if (!mine.ok) return;

      // Identity, not count: the foreign reader must get null for this exact id.
      expect(await db.findCreditClaim(OTHER_ORG, mine.value.id)).toBeNull();
      expect((await db.findCreditClaim(ORG, mine.value.id))?.id).toBe(mine.value.id);
    });

    it('filters the list by the status partition it is given', async () => {
      const built = await buildOneLine();
      expect(built.ok).toBe(true);
      if (!built.ok) return;

      expect((await db.listCreditClaims(ORG, ['DRAFT'])).map((c) => c.id)).toEqual([
        built.value.id,
      ]);
      expect(await db.listCreditClaims(ORG, ['CREDITED'])).toHaveLength(0);
      expect((await db.listCreditClaims(ORG)).map((c) => c.id)).toEqual([built.value.id]);
    });
  });

  describe('addCreditClaimPhoto', () => {
    let claimId: number;
    let lineId: number;

    beforeEach(async () => {
      const built = await buildOneLine();
      if (!built.ok) throw new Error('fixture claim failed to build');
      claimId = built.value.id;
      lineId = built.value.lines[0].id;
    });

    const photo = { storageKey: 'credit-claims/k', fileName: 'lot.jpg', sizeBytes: 1234 };

    it('records the metadata against the line', async () => {
      const result = await db.addCreditClaimPhoto(ORG, claimId, lineId, photo);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toMatchObject({ fileName: 'lot.jpg', sizeBytes: 1234 });

      const claim = await db.findCreditClaim(ORG, claimId);
      expect(claim?.lines[0].photos.map((p) => p.fileName)).toEqual(['lot.jpg']);
    });

    it('refuses a claim that is no longer a draft', async () => {
      await sql`UPDATE credit_claims SET status = 'SENT' WHERE id = ${claimId}`;

      const result = await db.addCreditClaimPhoto(ORG, claimId, lineId, photo);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('VALIDATION');
      expect(result.message).toContain('draft claims');
      expect(await sql`SELECT id FROM credit_claim_photos`).toHaveLength(0);
    });

    it('reports a line that does not exist as not-found', async () => {
      const result = await db.addCreditClaimPhoto(ORG, claimId, lineId + 9999, photo);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('NOT_FOUND');
    });

    it("cannot attach a photo to another organization's claim line", async () => {
      const result = await db.addCreditClaimPhoto(OTHER_ORG, claimId, lineId, photo);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('NOT_FOUND');
      // The victim's line gained nothing.
      const rows = await sql`SELECT id FROM credit_claim_photos WHERE claim_line_id = ${lineId}`;
      expect(rows).toHaveLength(0);
    });

    it('refuses a line id that belongs to a different claim', async () => {
      const other = await db.buildCreditClaim(
        ORG,
        { supplierId, lines: [{ expiredItemTransactionId: writeOffIds[1] }] },
        42,
      );
      if (!other.ok) throw new Error('second claim failed to build');

      const result = await db.addCreditClaimPhoto(ORG, claimId, other.value.lines[0].id, photo);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('NOT_FOUND');
    });
  });

  describe('send and follow-up reservations', () => {
    let claimId: number;

    beforeEach(async () => {
      const built = await buildOneLine();
      if (!built.ok) throw new Error('fixture claim failed to build');
      claimId = built.value.id;
    });

    it('lets exactly one caller take a draft claim for sending', async () => {
      expect(await db.reserveClaimForSending(ORG, claimId)).toBe(true);
      // The second caller observed the same DRAFT and must lose — this is the guard
      // that stops a supplier being emailed twice.
      expect(await db.reserveClaimForSending(ORG, claimId)).toBe(false);

      const rows = await sql`SELECT status FROM credit_claims WHERE id = ${claimId}`;
      expect(rows[0].status).toBe('SENDING');
    });

    it("cannot reserve another organization's claim", async () => {
      expect(await db.reserveClaimForSending(OTHER_ORG, claimId)).toBe(false);
      const rows = await sql`SELECT status FROM credit_claims WHERE id = ${claimId}`;
      expect(rows[0].status).toBe('DRAFT');
    });

    it('finalizes a sent claim and appends the SENT event in one write', async () => {
      await db.reserveClaimForSending(ORG, claimId);
      const sentAt = new Date('2026-09-22T10:00:00.000Z');
      const nextAt = new Date('2026-09-29T10:00:00.000Z');

      await db.finalizeSentClaim(ORG, claimId, {
        contactEmail: 'claims@acme.test',
        sentAt,
        nextFollowUpAt: nextAt,
      });

      const claim = await db.findCreditClaim(ORG, claimId);
      expect(claim?.status).toBe('SENT');
      expect(claim?.contactEmailSnapshot).toBe('claims@acme.test');
      expect(parseDbTimestamp(claim!.sentAt!).toISOString()).toBe(sentAt.toISOString());
      expect(parseDbTimestamp(claim!.nextFollowUpAt!).toISOString()).toBe(nextAt.toISOString());
      expect(claim?.events.map((e) => e.type)).toEqual(['CREATED', 'SENT']);
      expect(claim?.events[1].note).toBe('Sent to claims@acme.test');
    });

    it('is a no-op when finalized a second time, so the retry cannot double-write', async () => {
      // The send path retries the finalize when it fails after the supplier was
      // emailed. A statement can time out *after* the server committed it (issue
      // #487), so that retry is only safe if a second application changes nothing.
      // Without the `status = 'SENDING'` predicate the claim's timeline would show
      // "Sent to ..." twice.
      await db.reserveClaimForSending(ORG, claimId);
      const first = {
        contactEmail: 'claims@acme.test',
        sentAt: new Date('2026-09-22T10:00:00.000Z'),
        nextFollowUpAt: new Date('2026-09-29T10:00:00.000Z'),
      };
      await db.finalizeSentClaim(ORG, claimId, first);
      await db.finalizeSentClaim(ORG, claimId, {
        contactEmail: 'someone-else@acme.test',
        sentAt: new Date('2026-10-01T10:00:00.000Z'),
        nextFollowUpAt: new Date('2026-10-08T10:00:00.000Z'),
      });

      const claim = await db.findCreditClaim(ORG, claimId);
      expect(claim?.events.map((e) => e.type)).toEqual(['CREATED', 'SENT']);
      // The first send's facts stand: the retry must not move sentAt or rewrite the
      // address the claim was actually sent to.
      expect(parseDbTimestamp(claim!.sentAt!).toISOString()).toBe(first.sentAt.toISOString());
      expect(claim?.contactEmailSnapshot).toBe('claims@acme.test');
    });

    it("does not finalize another organization's claim", async () => {
      await db.reserveClaimForSending(ORG, claimId);
      await db.finalizeSentClaim(OTHER_ORG, claimId, {
        contactEmail: 'attacker@evil.test',
        sentAt: new Date(),
        nextFollowUpAt: new Date(),
      });

      const claim = await db.findCreditClaim(ORG, claimId);
      expect(claim?.status).toBe('SENDING');
      expect(claim?.contactEmailSnapshot).toBe('claims@acme.test');
      expect(claim?.events.map((e) => e.type)).toEqual(['CREATED']);
    });

    it('returns a stuck SENDING claim to draft', async () => {
      await db.reserveClaimForSending(ORG, claimId);
      await db.revertClaimToDraft(ORG, claimId);

      const rows = await sql`SELECT status FROM credit_claims WHERE id = ${claimId}`;
      expect(rows[0].status).toBe('DRAFT');
      // And it is takeable again, which is the whole point of the revert.
      expect(await db.reserveClaimForSending(ORG, claimId)).toBe(true);
    });

    it('will not revert a claim that already finished sending', async () => {
      await sql`UPDATE credit_claims SET status = 'SENT' WHERE id = ${claimId}`;
      await db.revertClaimToDraft(ORG, claimId);

      const rows = await sql`SELECT status FROM credit_claims WHERE id = ${claimId}`;
      expect(rows[0].status).toBe('SENT');
    });

    it('advances the follow-up counter only from the value the caller observed', async () => {
      // A follow-up only applies to a claim that was actually sent; the reservation
      // now refuses anything else, so the fixture has to be in a chaseable state for
      // this test to be exercising the counter rather than the status.
      await sql`UPDATE credit_claims SET status = 'SENT' WHERE id = ${claimId}`;
      const nextAt = new Date('2026-10-06T10:00:00.000Z');
      expect(
        await db.reserveFollowUp(ORG, claimId, 0, { followUpCount: 1, nextFollowUpAt: nextAt }),
      ).toBe(true);
      // A second caller that also observed 0 must lose: the counter is the CAS key, so
      // it re-arms for each nudge instead of latching like a status flag would.
      expect(
        await db.reserveFollowUp(ORG, claimId, 0, { followUpCount: 1, nextFollowUpAt: nextAt }),
      ).toBe(false);
      // A caller that observed the new value wins.
      expect(
        await db.reserveFollowUp(ORG, claimId, 1, { followUpCount: 2, nextFollowUpAt: nextAt }),
      ).toBe(true);

      const rows = await sql`SELECT follow_up_count FROM credit_claims WHERE id = ${claimId}`;
      expect(Number(rows[0].follow_up_count)).toBe(2);
    });

    it('will not reserve a follow-up on a claim that settled since it was read', async () => {
      // The caller checks the status against a row it read earlier. If an outcome
      // lands in between, only the status in this predicate stops the Worker emailing
      // a supplier about a closed claim -- and stops it writing a nextFollowUpAt that
      // recordClaimOutcome had just cleared, which would re-arm the reminder engine
      // against a settled claim for good.
      await sql`UPDATE credit_claims SET status = 'CREDITED' WHERE id = ${claimId}`;

      expect(
        await db.reserveFollowUp(ORG, claimId, 0, {
          followUpCount: 1,
          nextFollowUpAt: new Date('2026-10-06T10:00:00.000Z'),
        }),
      ).toBe(false);

      const rows = await sql`
        SELECT follow_up_count, next_follow_up_at FROM credit_claims WHERE id = ${claimId}`;
      expect(Number(rows[0].follow_up_count)).toBe(0);
      expect(rows[0].next_follow_up_at).toBeNull();
    });

    it.each(['SENT', 'ACKNOWLEDGED'])('reserves a follow-up on a %s claim', async (status) => {
      // The other half of the predicate: it must not be so tight that it refuses the
      // statuses follow-ups exist for.
      await sql`UPDATE credit_claims SET status = ${status} WHERE id = ${claimId}`;

      expect(
        await db.reserveFollowUp(ORG, claimId, 0, {
          followUpCount: 1,
          nextFollowUpAt: new Date('2026-10-06T10:00:00.000Z'),
        }),
      ).toBe(true);
    });

    it('will not restore a follow-up schedule onto a claim that has settled', async () => {
      // The compensation for a failed send. If the claim settled while the send was
      // failing, putting the old schedule back would resurrect next_follow_up_at on a
      // settled claim.
      await sql`UPDATE credit_claims SET status = 'CREDITED' WHERE id = ${claimId}`;

      await db.restoreFollowUpSchedule(ORG, claimId, {
        followUpCount: 3,
        nextFollowUpAt: '2026-10-06 10:00:00',
      });

      const rows = await sql`
        SELECT follow_up_count, next_follow_up_at FROM credit_claims WHERE id = ${claimId}`;
      expect(Number(rows[0].follow_up_count)).toBe(0);
      expect(rows[0].next_follow_up_at).toBeNull();
    });

    it("cannot advance another organization's follow-up", async () => {
      // Chaseable on purpose: otherwise this would pass because of the status guard
      // and prove nothing about organization scoping.
      await sql`UPDATE credit_claims SET status = 'SENT' WHERE id = ${claimId}`;
      expect(
        await db.reserveFollowUp(OTHER_ORG, claimId, 0, {
          followUpCount: 1,
          nextFollowUpAt: new Date(),
        }),
      ).toBe(false);
      const rows = await sql`SELECT follow_up_count FROM credit_claims WHERE id = ${claimId}`;
      expect(Number(rows[0].follow_up_count)).toBe(0);
    });

    it('restores the schedule a failed send advanced', async () => {
      await sql`UPDATE credit_claims SET status = 'SENT' WHERE id = ${claimId}`;
      const nextAt = new Date('2026-10-06T10:00:00.000Z');
      await db.reserveFollowUp(ORG, claimId, 0, { followUpCount: 1, nextFollowUpAt: nextAt });
      await db.restoreFollowUpSchedule(ORG, claimId, { followUpCount: 0, nextFollowUpAt: null });

      const rows = await sql`
        SELECT follow_up_count, next_follow_up_at FROM credit_claims WHERE id = ${claimId}`;
      expect(Number(rows[0].follow_up_count)).toBe(0);
      expect(rows[0].next_follow_up_at).toBeNull();
    });
  });

  describe('recordClaimOutcome', () => {
    let claimId: number;
    let lineId: number;
    const settledAt = new Date('2026-09-22T10:00:00.000Z');
    const deleteAfter = new Date('2026-12-21T10:00:00.000Z');

    beforeEach(async () => {
      const built = await buildOneLine();
      if (!built.ok) throw new Error('fixture claim failed to build');
      claimId = built.value.id;
      lineId = built.value.lines[0].id;
      await sql`
        INSERT INTO credit_claim_photos (organization_id, claim_line_id, storage_key,
                                         file_name, size_bytes)
        VALUES (${ORG}, ${lineId}, 'credit-claims/k', 'lot.jpg', 10)`;
      await sql`
        UPDATE credit_claims
        SET status = 'SENT', sent_at = NOW(), next_follow_up_at = NOW()
        WHERE id = ${claimId}`;
    });

    it('settles a credited claim, stops follow-ups, and schedules the photo purge', async () => {
      await db.recordClaimOutcome(
        ORG,
        claimId,
        'CREDITED',
        18.5,
        'paid in full',
        settledAt,
        deleteAfter,
      );

      const claim = await db.findCreditClaim(ORG, claimId);
      expect(claim?.status).toBe('CREDITED');
      expect(claim?.creditedValue).toBe(18.5);
      expect(parseDbTimestamp(claim!.settledAt!).toISOString()).toBe(settledAt.toISOString());
      // Follow-ups must stop, or the reminder engine chases a settled claim forever.
      expect(claim?.nextFollowUpAt).toBeNull();
      expect(claim?.events.map((e) => e.type)).toEqual(['CREATED', 'CREDITED']);
      expect(claim?.events[1].note).toBe('paid in full');

      const photos = await sql`
        SELECT delete_after::text AS delete_after FROM credit_claim_photos
        WHERE claim_line_id = ${lineId}`;
      expect(parseDbTimestamp(String(photos[0].delete_after)).toISOString()).toBe(
        deleteAfter.toISOString(),
      );
    });

    it('stores no credited value for a rejection', async () => {
      // The caller may pass a value through; a rejection must still null it, or the
      // recovery report counts money that was never received.
      await db.recordClaimOutcome(ORG, claimId, 'REJECTED', 18.5, null, settledAt, deleteAfter);

      const claim = await db.findCreditClaim(ORG, claimId);
      expect(claim?.status).toBe('REJECTED');
      expect(claim?.creditedValue).toBeNull();
    });

    it("does not settle another organization's claim", async () => {
      await db.recordClaimOutcome(
        OTHER_ORG,
        claimId,
        'CREDITED',
        999,
        'stolen',
        settledAt,
        deleteAfter,
      );

      const claim = await db.findCreditClaim(ORG, claimId);
      expect(claim?.status).toBe('SENT');
      expect(claim?.creditedValue).toBeNull();
      expect(claim?.settledAt).toBeNull();
      expect(claim?.events.map((e) => e.type)).toEqual(['CREATED']);
      const photos = await sql`
        SELECT delete_after FROM credit_claim_photos WHERE claim_line_id = ${lineId}`;
      expect(photos[0].delete_after).toBeNull();
    });
  });

  describe('addCreditClaimEvent and listClaimPhotoKeys', () => {
    let claimId: number;
    let lineId: number;

    beforeEach(async () => {
      const built = await buildOneLine();
      if (!built.ok) throw new Error('fixture claim failed to build');
      claimId = built.value.id;
      lineId = built.value.lines[0].id;
    });

    it('appends an event to a claim in the caller organization', async () => {
      await db.addCreditClaimEvent(ORG, claimId, 'FOLLOW_UP_SENT', 'nudge 1');
      const claim = await db.findCreditClaim(ORG, claimId);
      expect(claim?.events.map((e) => e.type)).toEqual(['CREATED', 'FOLLOW_UP_SENT']);
    });

    it("appends nothing to another organization's claim", async () => {
      await db.addCreditClaimEvent(OTHER_ORG, claimId, 'FOLLOW_UP_SENT', 'nudge 1');
      const claim = await db.findCreditClaim(ORG, claimId);
      expect(claim?.events.map((e) => e.type)).toEqual(['CREATED']);
      // Nor is an orphan row written under the attacker's organization.
      const rows =
        await sql`SELECT id FROM credit_claim_events WHERE organization_id = ${OTHER_ORG}`;
      expect(rows).toHaveLength(0);
    });

    it('returns the storage keys for a claim, and none for a foreign reader', async () => {
      await sql`
        INSERT INTO credit_claim_photos (organization_id, claim_line_id, storage_key,
                                         file_name, size_bytes)
        VALUES (${ORG}, ${lineId}, 'credit-claims/org-a/k1', 'lot.jpg', 10)`;

      const keys = await db.listClaimPhotoKeys(ORG, claimId);
      expect(keys.map((k) => k.storageKey)).toEqual(['credit-claims/org-a/k1']);
      expect(await db.listClaimPhotoKeys(OTHER_ORG, claimId)).toHaveLength(0);
    });
  });
});
