# Proposal: Supplier credit-claim recovery

## Why

When stock is written off in-store, many suppliers owe the store a credit or replacement — e.g.
Blackmores' "3-for-1" (write off 3 units, get 1 back). Recovering that credit is today a manual,
leaky process: after a write-off the staff member quarantines the stock, looks up the supplier's
returns document (a PDF on WorkJam for Priceline, a vague Excel for IPA), photographs the products,
and emails the supplier the SKU, expiry, batch number and unit count. Suppliers are slow to respond
and often will not action a return unless chased — **if you do not follow up, you do not get the
credit.** There is no system of record: the "claim" lives in a staff member's sent-mail, the chase
lives in someone's memory, and money owed to the store is silently written off.

This is one of the highest-value gaps in the app: it turns recorded losses back into recovered cash.

The data model is *most* of the way there. `ExpiredItemTransaction`
(`backend/prisma/schema.prisma:381`) already records the write-off event — `unitsDiscarded`,
`financialLoss`, `userId`, and a link back to the `InventoryItem` → `Product`. A credit claim is
essentially a **lifecycle wrapper around one or more of those write-off transactions**. What is
missing is: (a) any notion of a **supplier** (`Product` has no supplier link — `schema.prisma:143`),
(b) the **batch number** required by every claim, and (c) the **claim itself** with a status, an
expected value, and a follow-up schedule.

## What changes

Add a **supplier credit-claim** capability that consumes existing write-offs without altering how
they are recorded. The write-off (scan → markdown → expire) path is untouched (golden-rule-safe re:
issue #268); claims are a pure read-consumer of `ExpiredItemTransaction`.

Decisions locked with the product owner:

- **Batch captured at claim time, not scan time.** Batch numbers and photos are entered only for the
  items actually being claimed, keeping the high-volume scan/write-off flow frictionless.
- **All write-offs auto-flow into a claimable pool; triage happens later.** The "Mark Expired"
  dialog (`frontend/src/pages/ExpiredItemsPage.tsx:239`) is unchanged. Every expired write-off appears
  in a new Supplier Credits workspace grouped by supplier; non-claimable ones are dismissed there.
- **Claims are batched per supplier** (decision #4): one claim = one supplier + many write-off lines,
  matching how suppliers want to receive them (one email, a table of SKUs).
- **The app sends the claim server-side** via a transactional email service, uploading the photos to
  R2 first. This gives a **verified `sentAt`** (which the reminder engine depends on) and a real
  in-app audit trail, rather than a claim buried in a staff member's personal sent-mail.
- **Policy-as-data, self-building supplier map.** `Product.supplierId` is nullable; the first time a
  SKU is claimed the user assigns its supplier, and the mapping persists for that SKU forever. The
  supplier map builds itself through normal use instead of a large upfront data-entry project.
- **Supplier portal is out of scope** (a two-sided product with a cold-start problem). The schema is
  designed so a future portal is an additive read/write surface onto the same tables.

## Scope (v1)

- **`Supplier`** — org-scoped: `name`, `contactEmail`, free-text `creditPolicyNote`, optional
  structured ratio (`policyWriteOffQty` / `policyCreditQty`, e.g. 3 → 1) that powers the expected-
  credit calculation, and a `followUpDays` reminder cadence. Policy folded onto the supplier row for
  v1 (single policy per supplier).
- **`Product.supplierId`** — nullable self-building supplier link; null = the "Needs supplier" triage
  bucket.
- **`CreditClaim`** — the claim header: `supplierId`, `status` (String + shared union), snapshotted
  `expectedCreditUnits`/`expectedCreditValue`, `creditedValue`, verified `sentAt`, `nextFollowUpAt`
  + `followUpCount` (reminder engine), `settledAt` (photo lifecycle trigger).
- **`CreditClaimLine`** — one per claimed write-off: unique link to an `ExpiredItemTransaction`,
  `batchNumber`, `unitsClaimed`, snapshotted expected credit. The `@unique` link enforces "one
  write-off is claimed at most once."
- **`CreditClaimPhoto`** — R2 object refs (`storageKey`, `fileName`, `sizeBytes`) with a `deleteAfter`
  lifecycle column so photos are purged after a claim settles.
- **`CreditClaimEvent`** — the timeline/audit log (`CREATED`, `SENT`, `FOLLOW_UP_SENT`,
  `ACKNOWLEDGED`, `CREDITED`, `REJECTED`, `NOTE`) that powers the claim-detail view.
- **Endpoints (workers + backend parity):** supplier CRUD + policy; assign supplier to a product;
  list the claimable pool grouped by supplier; build/send a claim (upload photos, generate + send
  email); record claim outcome; and the reminder-due read.
- **Reminder engine** on the worker/cron layer: find `SENT` claims where `nextFollowUpAt <= now`,
  send follow-up #N, bump `followUpCount`, advance `nextFollowUpAt` by `supplier.followUpDays`.
- **Frontend Supplier Credits workspace:** triage board (To Claim grouped by supplier / Open Claims /
  Settled), the claim builder (per-line batch + photo, live expected-credit total, preview + send),
  the claim-detail timeline with follow-up + outcome controls, and a recovery summary panel
  (outstanding credit $, recovery rate per supplier, "money left on the table").

## Analysis

**Where the write-off event lives today.**
- `ExpiredItemTransaction` (`backend/prisma/schema.prisma:381-403`) — the write-off record the claim
  wraps; `financialLoss` already snapshots cost at write-off time, the pattern we mirror for expected
  credit.
- `Product` (`schema.prisma:143-164`) and `InventoryItem` (`schema.prisma:166-188`) — carry SKU,
  name, `costPrice`, `expiryDate`; the source of a claim line's display + valuation.
- Write-off is produced by `processExpiredItem` — frontend `ExpiredItemsPage.tsx:239` /
  `frontend/src/services/expiredItemService.ts`; backend `backend/src/services/expired-item.service.ts`;
  workers `workers/src/database.ts` (+ routes in `workers/src/index.ts`).
- Status-as-`String` + shared const-union is the established convention
  (`shared/domain/disposition.ts`, `ExpiredItemTransaction.action`); claim statuses follow it.
- R2 object storage is already an adopted capability (`use-cloudflare-r2-and-a-serverless-database`);
  claim photos reuse it rather than introducing new storage.

**Config / event home.** Per the multi-tenant golden rules, suppliers, claims, lines, photos and
events are new org-scoped tables (not JSON blobs), with `organizationId` derived from auth only
(rule 1) and cascade delete on every FK (rule 3). Defaults preserve current behavior: with no
suppliers configured, every write-off simply sits in the "Needs supplier" bucket and nothing about
the existing Expired Items page changes.

## Reuse Strategy

- **Consume `ExpiredItemTransaction`, do not modify it.** A claim line references a write-off by a
  unique FK; the write-off ledger stays the source of truth (issue #268 preserved).
- **Extend `Product` with a nullable `supplierId`**, not a join table — a SKU belongs to one brand.
  Nullable is the "Needs supplier" bucket, not a gap.
- **Derive expected-credit + reminder state in `shared/domain/*`** (new `credit-claim.ts`) so workers
  (Postgres/pglite) and backend (SQLite) compute identical values, covered by a dual-backend
  conformance test (golden rule 5) — the same parity pattern the markdown-matrix and store-walk
  changes used.
- **Reuse R2 upload plumbing** for photos and the existing per-org storage/tier accounting rather
  than inventing new storage.
- **Schema stays triplicated** (golden rule 6): Prisma (base + production), Neon SQL `0005`
  (+ rollback), runtime SQLite migration `008`; pglite harness (`workers/src/__tests__/pglite-db.ts`)
  updated for parity.

## Guardrails

- Every new endpoint is org-scoped with `organizationId` from auth, never the client payload
  (golden rule 1, enforced by `no-client-organization-id`); cascade delete on every new FK (rule 3).
- `CreditClaimLine.expiredItemTransactionId` is **unique** — a single write-off can be claimed at
  most once, preventing double-claiming the same loss.
- A claim may only be **sent** when it has ≥1 line and the supplier has a `contactEmail`; `sentAt` is
  set **only** on a confirmed server-side send, so the reminder engine never chases an unsent claim.
- Expected-credit values are **snapshotted** onto the claim/line at build time (like `financialLoss`)
  so later policy or price changes never rewrite a raised claim.
- Photo bytes live in R2; only metadata + `deleteAfter` live in the DB. A lifecycle job purges photos
  after `settledAt + retention`, bounding storage cost.
- The policy ratio only *advises* eligibility and expected value in the UI; it never blocks a user
  from claiming a line they judge claimable.

## Deferred Follow-up

- **Supplier portal** (suppliers self-serve claims + see upcoming expiries) — a two-sided product;
  the schema is portal-ready but the portal is a later milestone.
- **Line-level credit outcomes / partial credits** — v1 records a claim-level `creditedValue` and a
  `PARTIALLY_CREDITED` status; resolving credit per individual line is v1.1.
- **Multi-policy / category-scoped policies** ("3-for-1 on health items only") — v1 is one policy per
  supplier; extract a `SupplierCreditPolicy` table when needed.
- **Splitting one write-off across multiple batch numbers** — v1 is one batch per line.
- **`Decimal` money types** — v1 keeps `Float` to match existing `costPrice`/`financialLoss`; an
  app-wide money-type decision is separate.
- **Inbound reply parsing** (auto-detecting a supplier's "credited" email) — v1 outcomes are recorded
  manually.

## Implementation Steps

1. Shared domain (`shared/domain/credit-claim.ts`): `CreditClaimStatus` + `CreditClaimEventType`
   unions, and pure `expectedCredit(policy, unitsClaimed)` + `nextFollowUp(sentAt, followUpDays,
   count)` resolvers used by both backends.
2. Schema (triplicated): `Supplier`, `CreditClaim`, `CreditClaimLine`, `CreditClaimPhoto`,
   `CreditClaimEvent` + `Product.supplierId` in Prisma (base + production); Neon SQL `0005`
   (+ rollback) with FKs/indexes and the unique `expired_item_transaction_id`; runtime SQLite
   migration `008`; update the pglite harness.
3. Backend: repository/service/controller/routes for suppliers (+ policy), product→supplier assign,
   claimable-pool listing, claim build/send, outcome recording, reminder-due read; wire the
   transactional email + R2 photo upload in the service layer; mount in `index.ts`.
4. Workers: parity handlers in `workers/src/database.ts` + routes in `workers/src/index.ts` (with
   retry wrappers), sharing the `shared/domain` resolvers.
5. Reminder engine: scheduled job querying `status = SENT AND nextFollowUpAt <= now`, sending
   follow-ups and advancing the schedule; photo-lifecycle purge job on `deleteAfter`.
6. Frontend: Supplier Credits workspace — triage board, claim builder (per-line batch + photo upload,
   live expected total, preview + send), claim-detail timeline + outcome controls, recovery summary
   panel; new nav entry.
7. Tests: shared-domain unit tests; dual-backend conformance for expected-credit + claimable-pool
   rollup (incl. row order); worker + backend route/validation tests (org-scoping, unique-line,
   send-preconditions); frontend triage/builder/detail tests.
8. Completion checks: backend + frontend lint, affected tests, `tsc`, and
   `npx openspec validate add-supplier-credit-claims --strict`.
