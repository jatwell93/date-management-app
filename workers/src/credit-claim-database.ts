// Credit-claim reads and writes for the Workers/Neon runtime, mirroring the Express
// backend's CreditClaimRepository. Split out of database.ts the way
// supplier-credit-database.ts is: claims carry four tables and the file was already
// the largest in the package.
//
// Two constraints shape everything here:
//
//  1. The Neon HTTP driver has no interactive transactions, so anything the backend
//     does inside `prisma.$transaction` becomes a single statement with CTEs.
//  2. A CTE makes a write atomic, not isolated. The one-write-off-per-claim rule is
//     therefore closed by the `credit_claim_lines.expired_item_transaction_id UNIQUE`
//     constraint (migration 0005), not by the pre-flight check — the check only buys
//     the friendly error message; the constraint is what makes a concurrent build
//     lose.

import type { NeonQueryFunction } from '@neondatabase/serverless';
import {
  CHASEABLE_CLAIM_STATUSES,
  expectedCredit,
  type CreditPolicyRatio,
} from '../../shared/domain/credit-claim';
import type {
  CreditClaim,
  CreditClaimEvent,
  CreditClaimLine,
  CreditClaimPhoto,
  Database,
  Supplier,
} from './database';

type CreditClaimDatabase = Pick<
  Database,
  | 'listCreditClaims'
  | 'findCreditClaim'
  | 'buildCreditClaim'
  | 'addCreditClaimPhoto'
  | 'reserveClaimForSending'
  | 'finalizeSentClaim'
  | 'revertClaimToDraft'
  | 'reserveFollowUp'
  | 'restoreFollowUpSchedule'
  | 'recordClaimOutcome'
  | 'addCreditClaimEvent'
  | 'listClaimPhotoKeys'
>;

export interface ClaimLineInput {
  expiredItemTransactionId: number;
  batchNumber?: string | null;
  unitsClaimed?: number;
}

export interface BuildClaimInput {
  supplierId: number;
  lines: ClaimLineInput[];
}

export type ClaimOutcome = 'CREDITED' | 'PARTIALLY_CREDITED' | 'REJECTED';

/**
 * Worker-side stand-in for the backend's thrown NotFoundError/ValidationError. The
 * Worker has no error middleware, so failures travel back as data and the route
 * handler maps `code` to a status.
 */
export type ClaimWriteResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'NOT_FOUND' | 'VALIDATION' | 'CONFLICT'; message: string };

/**
 * The statuses that still accept an outcome: the chaseable ones, plus
 * `PARTIALLY_CREDITED`, which is deliberately left open so a later top-up can carry it
 * to `CREDITED`. Named once because it is asserted twice — as the service's
 * precondition (which produces the specific refusal messages) and as the predicate on
 * the settling UPDATE (which is what actually closes the race).
 */
export const OUTCOME_RECORDABLE_STATUSES = [
  ...CHASEABLE_CLAIM_STATUSES,
  'PARTIALLY_CREDITED',
] as const;

export interface ClaimPhotoRow {
  id: number;
  claimLineId: number;
  storageKey: string;
  fileName: string;
  sizeBytes: number;
}

/** One validated claim line, with its expected credit already snapshotted. */
interface PreparedClaimLine {
  expiredItemTransactionId: number;
  batchNumber: string | null;
  unitsClaimed: number;
  expectedCreditUnits: number | null;
  expectedCreditValue: number | null;
}

/**
 * Validate one requested line against the write-off it claims and compute its expected
 * credit. Extracted so the per-line guards sit in one small unit that can be read
 * beside its opposite number, `prepareClaimLine` in
 * backend/src/services/credit-claim.service.ts — these guards are the thing the two
 * runtimes most need to agree on, and they are easiest to diff when they have the same
 * shape and the same name.
 */
function prepareClaimLine(
  line: ClaimLineInput,
  writeOff: Record<string, unknown> | undefined,
  supplierId: number,
  policy: CreditPolicyRatio,
): ClaimWriteResult<PreparedClaimLine> {
  if (!writeOff) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: `Write-off ${line.expiredItemTransactionId} not found`,
    };
  }
  const id = Number(writeOff.id);
  const refuse = (message: string): ClaimWriteResult<PreparedClaimLine> => ({
    ok: false,
    code: 'VALIDATION',
    message,
  });

  if (writeOff.action !== 'expired') {
    return refuse(`Write-off ${id} is not an expired-stock write-off.`);
  }
  if (writeOff.alreadyClaimed) {
    return refuse(`Write-off ${id} is already on a claim.`);
  }
  if (Number(writeOff.productSupplierId) !== supplierId) {
    return refuse(`Write-off ${id} is for a product not assigned to this supplier.`);
  }

  const unitsClaimed = line.unitsClaimed ?? Number(writeOff.unitsDiscarded) ?? 0;
  if (unitsClaimed <= 0) {
    return refuse(`Write-off ${id} has no units to claim.`);
  }

  const credit = expectedCredit(policy, unitsClaimed, Number(writeOff.costPrice));
  return {
    ok: true,
    value: {
      expiredItemTransactionId: id,
      batchNumber: line.batchNumber?.trim() || null,
      unitsClaimed,
      expectedCreditUnits: credit.units,
      expectedCreditValue: credit.value,
    },
  };
}

/** Postgres unique-violation, i.e. another claim took one of these write-offs first. */
function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === '23505' || /duplicate key value/i.test(String(error));
}

/**
 * Sum the non-null values, returning null only when no value was present. Mirrors
 * `sumOrNull` in the backend service: an absent ratio is *unknown*, never zero.
 */
function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

/** ISO string for a `timestamp(3)` column (the trailing Z is dropped by the cast). */
function toTimestamp(value: Date): string {
  return value.toISOString();
}

function toSupplierFromPrefixedRow(row: Record<string, unknown>): Supplier {
  return {
    id: Number(row.supplier_id),
    name: String(row.supplier_name),
    creditType: row.supplier_credit_type === 'FULL_CREDIT' ? 'FULL_CREDIT' : 'NONE',
    contactEmail: (row.supplier_contact_email as string | null) ?? null,
    contactPhone: (row.supplier_contact_phone as string | null) ?? null,
    creditPolicyNote: String(row.supplier_credit_policy_note ?? ''),
    policyWriteOffQty:
      row.supplier_policy_write_off_qty == null ? null : Number(row.supplier_policy_write_off_qty),
    policyCreditQty:
      row.supplier_policy_credit_qty == null ? null : Number(row.supplier_policy_credit_qty),
    followUpDays: row.supplier_follow_up_days == null ? 7 : Number(row.supplier_follow_up_days),
    representativeName: (row.supplier_representative_name as string | null) ?? null,
    representativeEmail: (row.supplier_representative_email as string | null) ?? null,
    policyUpdatedAt: (row.supplier_policy_updated_at as string | null) ?? null,
  };
}

export function createCreditClaimDatabase(
  sql: NeonQueryFunction<false, false>,
): CreditClaimDatabase {
  /**
   * Hydrate whole claims (header + supplier + lines + photos + events) for either a
   * status filter or an explicit id. One loader so the list and detail views can
   * never disagree about a claim's shape.
   */
  async function loadClaims(
    organizationId: string,
    filter: { statuses?: string[]; id?: number },
  ): Promise<CreditClaim[]> {
    const statuses = filter.statuses;
    const id = filter.id ?? null;
    const claimRows = (await sql`
      SELECT cc.id,
             cc.supplier_id AS "supplierId",
             cc.status,
             cc.contact_email_snapshot AS "contactEmailSnapshot",
             cc.expected_credit_units AS "expectedCreditUnits",
             cc.expected_credit_value AS "expectedCreditValue",
             cc.credited_value AS "creditedValue",
             cc.sent_at::text AS "sentAt",
             cc.next_follow_up_at::text AS "nextFollowUpAt",
             cc.follow_up_count AS "followUpCount",
             cc.settled_at::text AS "settledAt",
             s.id AS "supplier_id",
             s.name AS "supplier_name",
             s.credit_type AS "supplier_credit_type",
             s.contact_email AS "supplier_contact_email",
             s.contact_phone AS "supplier_contact_phone",
             s.credit_policy_note AS "supplier_credit_policy_note",
             s.policy_write_off_qty AS "supplier_policy_write_off_qty",
             s.policy_credit_qty AS "supplier_policy_credit_qty",
             s.follow_up_days AS "supplier_follow_up_days",
             s.representative_name AS "supplier_representative_name",
             s.representative_email AS "supplier_representative_email",
             s.policy_updated_at::text AS "supplier_policy_updated_at"
      FROM credit_claims cc
      JOIN suppliers s ON s.id = cc.supplier_id
      WHERE cc.organization_id = ${organizationId}
        AND (${statuses == null} OR cc.status = ANY(${statuses ?? []}))
        AND (${id}::integer IS NULL OR cc.id = ${id}::integer)
      ORDER BY cc.id DESC
    `) as Array<Record<string, unknown>>;

    if (claimRows.length === 0) {
      return [];
    }

    const claimIds = claimRows.map((row) => Number(row.id));
    const [lineRows, photoRows, eventRows] = await Promise.all([
      sql`
        SELECT id,
               claim_id AS "claimId",
               expired_item_transaction_id AS "expiredItemTransactionId",
               batch_number AS "batchNumber",
               units_claimed AS "unitsClaimed",
               expected_credit_units AS "expectedCreditUnits",
               expected_credit_value AS "expectedCreditValue"
        FROM credit_claim_lines
        WHERE organization_id = ${organizationId}
          AND claim_id = ANY(${claimIds})
        ORDER BY id ASC
      `,
      sql`
        SELECT ccp.id,
               ccl.claim_id AS "claimId",
               ccp.claim_line_id AS "claimLineId",
               ccp.file_name AS "fileName",
               ccp.size_bytes AS "sizeBytes"
        FROM credit_claim_photos ccp
        JOIN credit_claim_lines ccl ON ccl.id = ccp.claim_line_id
        WHERE ccp.organization_id = ${organizationId}
          AND ccl.claim_id = ANY(${claimIds})
        ORDER BY ccp.id ASC
      `,
      sql`
        SELECT id,
               claim_id AS "claimId",
               type,
               note,
               created_at::text AS "createdAt"
        FROM credit_claim_events
        WHERE organization_id = ${organizationId}
          AND claim_id = ANY(${claimIds})
        ORDER BY id ASC
      `,
    ]);

    const photosByLine = new Map<number, CreditClaimPhoto[]>();
    for (const row of photoRows as Array<Record<string, unknown>>) {
      const lineId = Number(row.claimLineId);
      const photos = photosByLine.get(lineId) ?? [];
      photos.push({
        id: Number(row.id),
        fileName: String(row.fileName),
        sizeBytes: Number(row.sizeBytes),
      });
      photosByLine.set(lineId, photos);
    }

    const linesByClaim = new Map<number, CreditClaimLine[]>();
    for (const row of lineRows as Array<Record<string, unknown>>) {
      const claimId = Number(row.claimId);
      const lineId = Number(row.id);
      const lines = linesByClaim.get(claimId) ?? [];
      lines.push({
        id: lineId,
        expiredItemTransactionId: Number(row.expiredItemTransactionId),
        batchNumber: (row.batchNumber as string | null) ?? null,
        unitsClaimed: Number(row.unitsClaimed),
        expectedCreditUnits:
          row.expectedCreditUnits == null ? null : Number(row.expectedCreditUnits),
        expectedCreditValue:
          row.expectedCreditValue == null ? null : Number(row.expectedCreditValue),
        photos: photosByLine.get(lineId) ?? [],
      });
      linesByClaim.set(claimId, lines);
    }

    const eventsByClaim = new Map<number, CreditClaimEvent[]>();
    for (const row of eventRows as Array<Record<string, unknown>>) {
      const claimId = Number(row.claimId);
      const events = eventsByClaim.get(claimId) ?? [];
      events.push({
        id: Number(row.id),
        type: String(row.type),
        note: (row.note as string | null) ?? null,
        createdAt: String(row.createdAt),
      });
      eventsByClaim.set(claimId, events);
    }

    return claimRows.map((row) => {
      const claimId = Number(row.id);
      return {
        id: claimId,
        supplierId: Number(row.supplierId),
        status: String(row.status),
        contactEmailSnapshot: (row.contactEmailSnapshot as string | null) ?? null,
        expectedCreditUnits:
          row.expectedCreditUnits == null ? null : Number(row.expectedCreditUnits),
        expectedCreditValue:
          row.expectedCreditValue == null ? null : Number(row.expectedCreditValue),
        creditedValue: row.creditedValue == null ? null : Number(row.creditedValue),
        sentAt: (row.sentAt as string | null) ?? null,
        nextFollowUpAt: (row.nextFollowUpAt as string | null) ?? null,
        followUpCount: row.followUpCount == null ? 0 : Number(row.followUpCount),
        settledAt: (row.settledAt as string | null) ?? null,
        supplier: toSupplierFromPrefixedRow(row),
        lines: linesByClaim.get(claimId) ?? [],
        events: eventsByClaim.get(claimId) ?? [],
      } satisfies CreditClaim;
    });
  }

  return {
    async listCreditClaims(organizationId, statuses) {
      return loadClaims(organizationId, { statuses });
    },

    async findCreditClaim(organizationId, id) {
      const claims = await loadClaims(organizationId, { id });
      return claims[0] ?? null;
    },

    /**
     * Build a draft claim from a set of write-offs. Validation and the expected-credit
     * maths run in TypeScript against the shared resolver so the Worker and the backend
     * snapshot identical numbers; the write is then one statement so a claim can never
     * exist without its lines or its CREATED event.
     *
     * `createdByUserId` is a separate argument, never read from `input` — the caller
     * must pass the id from the verified token, matching the Express controller.
     */
    async buildCreditClaim(organizationId, input, createdByUserId) {
      if (input.lines.length === 0) {
        return { ok: false, code: 'VALIDATION', message: 'A claim needs at least one line.' };
      }
      const ids = input.lines.map((l) => l.expiredItemTransactionId);
      if (new Set(ids).size !== ids.length) {
        return {
          ok: false,
          code: 'VALIDATION',
          message: 'A write-off can only appear once in a claim.',
        };
      }

      const supplierRows = (await sql`
        SELECT id,
               contact_email AS "contactEmail",
               policy_write_off_qty AS "policyWriteOffQty",
               policy_credit_qty AS "policyCreditQty"
        FROM suppliers
        WHERE organization_id = ${organizationId} AND id = ${input.supplierId}
        LIMIT 1
      `) as Array<Record<string, unknown>>;
      const supplier = supplierRows[0];
      if (!supplier) {
        return {
          ok: false,
          code: 'NOT_FOUND',
          message: `Supplier ${input.supplierId} not found`,
        };
      }

      const writeOffRows = (await sql`
        SELECT eit.id,
               eit.action,
               COALESCE(eit.units_discarded, 0) AS "unitsDiscarded",
               p.supplier_id AS "productSupplierId",
               COALESCE(p.cost_price, 0) AS "costPrice",
               (ccl.id IS NOT NULL) AS "alreadyClaimed"
        FROM expired_item_transactions eit
        JOIN inventory_items ii
          ON ii.id = eit.inventory_item_id AND ii.organization_id = eit.organization_id
        JOIN products p
          ON p.id = ii.product_id AND p.organization_id = ii.organization_id
        LEFT JOIN credit_claim_lines ccl ON ccl.expired_item_transaction_id = eit.id
        WHERE eit.organization_id = ${organizationId} AND eit.id = ANY(${ids})
      `) as Array<Record<string, unknown>>;
      const byId = new Map(writeOffRows.map((row) => [Number(row.id), row]));

      const policy = {
        writeOffQty: supplier.policyWriteOffQty == null ? null : Number(supplier.policyWriteOffQty),
        creditQty: supplier.policyCreditQty == null ? null : Number(supplier.policyCreditQty),
      };

      const lines: PreparedClaimLine[] = [];
      for (const line of input.lines) {
        const prepared = prepareClaimLine(
          line,
          byId.get(line.expiredItemTransactionId),
          Number(supplier.id),
          policy,
        );
        if (!prepared.ok) return prepared;
        lines.push(prepared.value);
      }

      const totalUnits = sumOrNull(lines.map((l) => l.expectedCreditUnits));
      const totalValue = sumOrNull(lines.map((l) => l.expectedCreditValue));

      let claimId: number;
      try {
        const created = (await sql`
          WITH new_claim AS (
            INSERT INTO credit_claims (
              organization_id, supplier_id, created_by_user_id, status,
              contact_email_snapshot, expected_credit_units, expected_credit_value,
              follow_up_count, created_at, updated_at
            ) VALUES (
              ${organizationId}, ${input.supplierId}, ${createdByUserId}, 'DRAFT',
              ${(supplier.contactEmail as string | null) ?? null},
              ${totalUnits}, ${totalValue}, 0, NOW(), NOW()
            )
            RETURNING id
          ), new_lines AS (
            INSERT INTO credit_claim_lines (
              organization_id, claim_id, expired_item_transaction_id, batch_number,
              units_claimed, expected_credit_units, expected_credit_value,
              created_at, updated_at
            )
            SELECT ${organizationId}, (SELECT id FROM new_claim),
                   l."expiredItemTransactionId", l."batchNumber", l."unitsClaimed",
                   l."expectedCreditUnits", l."expectedCreditValue", NOW(), NOW()
            FROM jsonb_to_recordset(${JSON.stringify(lines)}::jsonb) AS l(
              "expiredItemTransactionId" integer,
              "batchNumber" text,
              "unitsClaimed" integer,
              "expectedCreditUnits" integer,
              "expectedCreditValue" double precision
            )
            RETURNING id
          ), new_event AS (
            INSERT INTO credit_claim_events (
              organization_id, claim_id, user_id, type, note, created_at
            )
            SELECT ${organizationId}, (SELECT id FROM new_claim), ${createdByUserId},
                   'CREATED', NULL, NOW()
            RETURNING id
          )
          SELECT id FROM new_claim
        `) as Array<{ id: number }>;
        claimId = Number(created[0]?.id);
      } catch (error) {
        // The pre-flight `alreadyClaimed` check above is advisory; this is the guard
        // that actually holds when two builds race for the same write-off.
        if (isUniqueViolation(error)) {
          return {
            ok: false,
            code: 'CONFLICT',
            message: 'One of these write-offs was just added to another claim.',
          };
        }
        throw error;
      }

      const claim = await loadClaims(organizationId, { id: claimId });
      if (!claim[0]) {
        return { ok: false, code: 'NOT_FOUND', message: `Claim ${claimId} not found` };
      }
      return { ok: true, value: claim[0] };
    },

    /**
     * Record an uploaded photo against a draft claim's line. The bytes are already in
     * R2 by the time this runs; only metadata and the lifecycle deletion time live in
     * the DB. Org scope and the DRAFT precondition are re-checked in SQL so a stale
     * read cannot attach a photo to someone else's claim.
     */
    async addCreditClaimPhoto(organizationId, claimId, lineId, file) {
      const rows = (await sql`
        WITH target AS (
          SELECT ccl.id AS line_id, cc.status
          FROM credit_claim_lines ccl
          JOIN credit_claims cc
            ON cc.id = ccl.claim_id AND cc.organization_id = ccl.organization_id
          WHERE ccl.organization_id = ${organizationId}
            AND ccl.claim_id = ${claimId}
            AND ccl.id = ${lineId}
        ), inserted AS (
          INSERT INTO credit_claim_photos (
            organization_id, claim_line_id, storage_key, file_name, size_bytes, created_at
          )
          SELECT ${organizationId}, t.line_id, ${file.storageKey}, ${file.fileName},
                 ${file.sizeBytes}, NOW()
          FROM target t WHERE t.status = 'DRAFT'
          RETURNING id, file_name AS "fileName", size_bytes AS "sizeBytes"
        )
        SELECT (SELECT COUNT(*) FROM target)::int AS found,
               (SELECT status FROM target) AS status,
               i.id, i."fileName", i."sizeBytes"
        FROM (SELECT 1) one
        LEFT JOIN inserted i ON true
      `) as Array<Record<string, unknown>>;

      const row = rows[0];
      if (!row || Number(row.found) === 0) {
        return { ok: false, code: 'NOT_FOUND', message: `Claim line ${lineId} not found` };
      }
      if (row.id == null) {
        return {
          ok: false,
          code: 'VALIDATION',
          message: 'Photos can only be added to draft claims.',
        };
      }
      return {
        ok: true,
        value: {
          id: Number(row.id),
          fileName: String(row.fileName),
          sizeBytes: Number(row.sizeBytes),
        },
      };
    },

    /**
     * Move a DRAFT claim to SENDING, returning whether this caller won. Exactly one
     * concurrent sender can flip the row, so the supplier is never emailed twice —
     * the single-row CAS the backend's `claimDraftForSending` relies on.
     */
    async reserveClaimForSending(organizationId, id) {
      const rows = (await sql`
        UPDATE credit_claims
        SET status = 'SENDING', updated_at = NOW()
        WHERE organization_id = ${organizationId} AND id = ${id} AND status = 'DRAFT'
        RETURNING id
      `) as Array<{ id: number }>;
      return rows.length === 1;
    },

    /**
     * Complete a send: flip SENDING→SENT and append the SENT event together.
     *
     * The `status = 'SENDING'` predicate makes this **idempotent**, which is what lets
     * the caller retry it after the supplier has already been emailed. A statement can
     * time out *after* the server committed it (issue #487), and a blind retry of the
     * old unconditional form would have appended a second SENT event to the claim's
     * timeline. With the predicate, a retry that follows a committed attempt matches no
     * row, so `updated` is empty and the event insert selects nothing — while a retry
     * after a genuinely failed attempt still finds SENDING and applies.
     */
    async finalizeSentClaim(organizationId, id, data) {
      await sql`
        WITH updated AS (
          UPDATE credit_claims
          SET status = 'SENT',
              contact_email_snapshot = ${data.contactEmail},
              sent_at = ${toTimestamp(data.sentAt)}::timestamp,
              next_follow_up_at = ${toTimestamp(data.nextFollowUpAt)}::timestamp,
              updated_at = NOW()
          WHERE organization_id = ${organizationId} AND id = ${id}
            AND status = 'SENDING'
          RETURNING id
        )
        INSERT INTO credit_claim_events (organization_id, claim_id, user_id, type, note, created_at)
        SELECT ${organizationId}, u.id, NULL, 'SENT', ${`Sent to ${data.contactEmail}`}, NOW()
        FROM updated u
      `;
    },

    async revertClaimToDraft(organizationId, id) {
      await sql`
        UPDATE credit_claims
        SET status = 'DRAFT', updated_at = NOW()
        WHERE organization_id = ${organizationId} AND id = ${id} AND status = 'SENDING'
      `;
    },

    /**
     * Reserve the next follow-up slot by advancing the counter from the value the
     * caller observed. Keyed on the counter so it re-arms for each nudge — an
     * overlapping cron tick and a manual nudge cannot both email.
     *
     * The status is in the predicate too, and that part is not redundant: the caller
     * checks `isChaseableClaimStatus` against a row it read earlier, so an outcome
     * recorded in between would leave that check passing against a claim that is now
     * settled. Without the status here the CAS would still match on the counter,
     * email the supplier about a closed claim, and write a `next_follow_up_at` onto
     * the settled row that `recordClaimOutcome` had just cleared — re-arming the
     * reminder engine against it forever. A stale read is only safe when everything
     * the decision rested on is re-checked in the write.
     */
    async reserveFollowUp(organizationId, id, expectedCount, next) {
      const rows = (await sql`
        UPDATE credit_claims
        SET follow_up_count = ${next.followUpCount},
            next_follow_up_at = ${toTimestamp(next.nextFollowUpAt)}::timestamp,
            updated_at = NOW()
        WHERE organization_id = ${organizationId}
          AND id = ${id}
          AND follow_up_count = ${expectedCount}
          AND status = ANY(${[...CHASEABLE_CLAIM_STATUSES]})
        RETURNING id
      `) as Array<{ id: number }>;
      return rows.length === 1;
    },

    /**
     * Put a reservation back after a follow-up that never went out. Also gated on a
     * chaseable status: if the claim settled while the send was failing, the schedule
     * it is being restored to no longer applies, and writing it back would resurrect
     * `next_follow_up_at` on a settled claim.
     */
    async restoreFollowUpSchedule(organizationId, id, previous) {
      await sql`
        UPDATE credit_claims
        SET follow_up_count = ${previous.followUpCount},
            next_follow_up_at = ${
              previous.nextFollowUpAt == null ? null : previous.nextFollowUpAt
            }::timestamp,
            updated_at = NOW()
        WHERE organization_id = ${organizationId} AND id = ${id}
          AND status = ANY(${[...CHASEABLE_CLAIM_STATUSES]})
      `;
    },

    /**
     * Settle a claim: status, credited value, settled time, stop follow-ups, and set
     * the photo retention deadline. One statement so a settled claim can never be left
     * with photos that are never purged.
     *
     * The status predicate is what makes the outcome final. The caller's preconditions
     * are checked against a row it read earlier, so two outcomes recorded concurrently
     * would both pass them and both write — the second silently replacing the first,
     * which for a `REJECTED` landing on top of a `CREDITED` also discards
     * `credited_value` and the money it represents. Returns whether this caller won,
     * so a loser can be told rather than assume it settled the claim.
     */
    async recordClaimOutcome(
      organizationId,
      id,
      outcome,
      creditedValue,
      note,
      settledAt,
      deleteAfter,
    ) {
      const rows = (await sql`
        WITH updated AS (
          UPDATE credit_claims
          SET status = ${outcome},
              credited_value = ${outcome === 'REJECTED' ? null : creditedValue},
              settled_at = ${toTimestamp(settledAt)}::timestamp,
              next_follow_up_at = NULL,
              updated_at = NOW()
          WHERE organization_id = ${organizationId} AND id = ${id}
            AND status = ANY(${[...OUTCOME_RECORDABLE_STATUSES]})
          RETURNING id
        ), photos AS (
          UPDATE credit_claim_photos ccp
          SET delete_after = ${toTimestamp(deleteAfter)}::timestamp
          FROM credit_claim_lines ccl
          WHERE ccp.claim_line_id = ccl.id
            AND ccp.organization_id = ${organizationId}
            AND ccl.organization_id = ${organizationId}
            AND ccl.claim_id = (SELECT id FROM updated)
          RETURNING ccp.id
        )
        INSERT INTO credit_claim_events (organization_id, claim_id, user_id, type, note, created_at)
        SELECT ${organizationId}, u.id, NULL, ${outcome}, ${note}, NOW()
        FROM updated u
        RETURNING id
      `) as Array<{ id: number }>;
      return rows.length > 0;
    },

    async addCreditClaimEvent(organizationId, claimId, type, note) {
      await sql`
        INSERT INTO credit_claim_events (organization_id, claim_id, user_id, type, note, created_at)
        SELECT ${organizationId}, ${claimId}, NULL, ${type}, ${note}, NOW()
        WHERE EXISTS (
          SELECT 1 FROM credit_claims
          WHERE id = ${claimId} AND organization_id = ${organizationId}
        )
      `;
    },

    /** Storage keys for a claim's photos, for building email attachments. */
    async listClaimPhotoKeys(organizationId, claimId) {
      const rows = (await sql`
        SELECT ccp.id,
               ccp.claim_line_id AS "claimLineId",
               ccp.storage_key AS "storageKey",
               ccp.file_name AS "fileName",
               ccp.size_bytes AS "sizeBytes"
        FROM credit_claim_photos ccp
        JOIN credit_claim_lines ccl ON ccl.id = ccp.claim_line_id
        WHERE ccp.organization_id = ${organizationId}
          AND ccl.organization_id = ${organizationId}
          AND ccl.claim_id = ${claimId}
        ORDER BY ccp.id ASC
      `) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: Number(row.id),
        claimLineId: Number(row.claimLineId),
        storageKey: String(row.storageKey),
        fileName: String(row.fileName),
        sizeBytes: Number(row.sizeBytes),
      }));
    },
  };
}
