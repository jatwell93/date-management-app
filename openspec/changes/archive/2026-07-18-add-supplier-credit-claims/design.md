# Design: Supplier credit-claim recovery

## Context

Recovering supplier credits for written-off stock is a manual, unrecorded process today (see
`proposal.md`). This design turns it into a tracked claim lifecycle that consumes existing
`ExpiredItemTransaction` rows without changing how write-offs are recorded.

## Data model

Six new org-scoped tables + one nullable column on `Product`. Status columns are `String` paired with
a `shared/domain/credit-claim.ts` const-union, matching `shared/domain/disposition.ts`.

```
Product.supplierId ─▶ Supplier ─1:N─▶ CreditClaim ─1:N─▶ CreditClaimLine ─1:N─▶ CreditClaimPhoto
                                            │                    │
                                            └─1:N─▶ CreditClaimEvent   └─1:1─▶ ExpiredItemTransaction (unique)
```

- **Supplier** — `name`, `contactEmail?`, `creditPolicyNote` (free text — the PDF/Excel reality),
  optional `policyWriteOffQty` / `policyCreditQty` (structured ratio, e.g. 3 → 1), `followUpDays`
  (default 7). One policy per supplier in v1; unique `(organizationId, name)`.
- **CreditClaim** — `supplierId`, `createdByUserId?`, `status` (default `DRAFT`),
  `contactEmailSnapshot?`, `expectedCreditUnits?`, `expectedCreditValue?`, `creditedValue?`,
  `sentAt?`, `nextFollowUpAt?`, `followUpCount` (default 0), `settledAt?`. Indexed on
  `organizationId`, `supplierId`, `status`, and `nextFollowUpAt` (reminder-engine query).
- **CreditClaimLine** — `claimId`, **unique** `expiredItemTransactionId`, `batchNumber?`,
  `unitsClaimed`, `expectedCreditUnits?`, `expectedCreditValue?`. Cascade-deletes with the claim.
- **CreditClaimPhoto** — `claimLineId`, `storageKey` (R2), `fileName`, `sizeBytes`, `deleteAfter?`.
  Bytes in R2; only metadata here. Indexed on `deleteAfter` for the purge job.
- **CreditClaimEvent** — `claimId`, `userId?`, `type`, `note?`, `createdAt`. Append-only timeline.

## Claim status state machine

Stored on `CreditClaim.status` (String union). `FOLLOW_UP_DUE` is **derived** (`status = SENT AND
nextFollowUpAt <= now`), not stored, so the reminder cadence never fights the status column.

```
DRAFT ──send──▶ SENT ──ack──▶ ACKNOWLEDGED ──▶ CREDITED
  │               │                              │
  │               ├───────────────────────────▶ PARTIALLY_CREDITED
  │               └───────────────────────────▶ REJECTED
  └──cancel──▶ CANCELLED         (SENT/ACKNOWLEDGED may also ──cancel──▶ CANCELLED)
```

- **DRAFT → SENT** requires ≥1 line and a supplier `contactEmail`; sets `sentAt` and initial
  `nextFollowUpAt = sentAt + followUpDays` **only** after the transactional send succeeds.
- **CREDITED / PARTIALLY_CREDITED / REJECTED** set `settledAt`, which schedules photo purge
  (`deleteAfter = settledAt + retention`) and stops the reminder engine.
- Every transition writes a `CreditClaimEvent`.

## Key decisions & alternatives

1. **Consume, don't modify, `ExpiredItemTransaction`.** A claim line references a write-off by unique
   FK. *Alternative rejected:* adding claim fields onto `ExpiredItemTransaction` — would couple the
   loss ledger to claim state and risk the issue-#268 invariants.
2. **`Product.supplierId` nullable, self-building.** *Alternative rejected:* upfront supplier import —
   suppliers publish rules as vague PDFs/Excel with no clean SKU mapping; deriving the map through use
   is lower-friction and the null bucket is a usable triage state.
3. **App sends server-side (photos → R2 first).** *Alternative rejected:* `mailto:` + manual "mark
   sent" — cannot verify `sentAt` (the reminder engine's anchor) and leaves the audit trail in a
   personal inbox. A hybrid (send without retaining photos) was considered but loses the in-app
   evidence a store owner needs to prove a claim.
4. **Snapshot expected/credited values.** Mirrors `financialLoss`; a raised claim must remember what
   it expected even if policy or `costPrice` later changes.
5. **Status as `String` + shared union, not Prisma enum.** Matches every existing status column and
   avoids a second source of truth + enum-migration churn across the triplicated schema.
6. **Policy folded onto `Supplier`.** *Deferred:* a `SupplierCreditPolicy` table for category-scoped /
   multi-policy suppliers — speculative until a real multi-policy supplier appears.

## Dual-backend parity (golden rules 5 & 6)

- `shared/domain/credit-claim.ts` holds the status/event unions and the pure `expectedCredit(policy,
  unitsClaimed)` and `nextFollowUp(sentAt, followUpDays, count)` resolvers used by both backends.
- The claimable-pool rollup (write-offs grouped by supplier with expected totals) is derived by a
  single shared resolver; a conformance test compares Postgres/pglite vs SQLite output including row
  order.
- Schema lands in Prisma (base + production), Neon SQL `0005` (+ rollback), SQLite migration `008`,
  and the pglite harness — kept in sync.

## Risks / open questions

- **Transactional email provider** (Resend / SendGrid / Cloudflare Email) is undecided; the service
  wraps it behind an interface so the choice is swappable and testable.
- **Photo retention window** after `settledAt` needs a concrete default (proposed: 90 days).
- **Line-level partial credits** are deferred; if suppliers routinely part-credit, `creditedValue`
  moves from claim to line in v1.1.
