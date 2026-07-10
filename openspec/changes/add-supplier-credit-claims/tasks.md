# Tasks: Supplier credit-claim recovery

## 1. Shared domain (parity foundation)

- [x] 1.1 Add `shared/domain/credit-claim.ts`: `CreditClaimStatus` and `CreditClaimEventType`
      const-unions (mirroring `shared/domain/disposition.ts`).
- [x] 1.2 Pure resolver `expectedCredit(policy, unitsClaimed)` (ratio → units/value; unknown when no
      ratio).
- [x] 1.3 Pure resolver `nextFollowUp(sentAt, followUpDays, followUpCount)` and a `isFollowUpDue`
      predicate.
- [x] 1.4 Pure claimable-pool rollup helper (write-offs → grouped-by-supplier with expected totals),
      shared by both backends.
- [x] 1.5 Unit tests for all resolvers (edge cases: no ratio, below-threshold qty, zero units).

## 2. Schema (triplicated — golden rule 6)

- [x] 2.1 Prisma base (`backend/prisma/schema.prisma`): `Supplier`, `CreditClaim`,
      `CreditClaimLine`, `CreditClaimPhoto`, `CreditClaimEvent`; add `Product.supplierId` (nullable)
      and back-relations on `Organization`, `User`, `ExpiredItemTransaction`.
- [x] 2.2 Mirror into `backend/prisma/production/schema.prisma`.
- [x] 2.3 Neon SQL `0005_add_supplier_credit_claims.sql` (+ rollback): tables, FKs (cascade), indexes,
      unique `expired_item_transaction_id`, index on `next_follow_up_at` and `delete_after`.
- [x] 2.4 Runtime SQLite migration `015-add-supplier-credit-claims` (008 was taken; highest was 014).
- [x] 2.5 Update pglite harness (`workers/src/__tests__/pglite-db.ts`) with the new tables.
- [ ] 2.6 Dual-backend conformance test: claimable-pool rollup + expected-credit identical across
      Postgres/pglite and SQLite (including row order). **→ built with task 4.1 (needs the query).**

## 3. Backend (Express — layered)

- [x] 3.1 Supplier repository/service/controller/routes (CRUD + policy fields), org-scoped.
- [x] 3.2 Assign-supplier-to-product endpoint (persists `Product.supplierId`).
- [x] 3.3 Claimable-pool listing endpoint (grouped by supplier via the shared rollup; excludes
      already-claimed write-offs).
- [x] 3.4 Claim build endpoint: create claim + lines from write-offs, capture batch/units, snapshot
      expected credit; enforce unique write-off per line.
- [x] 3.5 Photo upload to R2 (reuse existing storage-factory); persist `CreditClaimPhoto` metadata.
- [x] 3.6 Claim send: Resend behind a swappable `EmailSender` interface (dependency-free fetch); set
      `sentAt` + `nextFollowUpAt` only on success; enforce ≥1 line + supplier email; append `SENT` event.
- [x] 3.7 Record-outcome endpoint (credited / partially credited / rejected → `settledAt`,
      `creditedValue`, photo `deleteAfter`); append event.
- [x] 3.8 Send-follow-up endpoint (advances schedule, bumps count, appends event). Follow-up-due read
      lives in the repo (`findFollowUpDue`) for the reminder engine (task 5.1).
- [x] 3.9 Recovery report endpoint (outstanding, per-supplier recovery rate, unclaimed value) via
      shared `rollupRecoveryReport` (reused by workers later).
- [x] 3.10 Routes mounted in `backend/src/index.ts`; controller/route-wiring tests (status-filter
      mapping, missing-photo 400, build passes userId, report). Service tests cover org-scoping,
      unique-line and send preconditions. 41 feature tests green; backend tsc clean.

## 4. Workers (parity)

- [ ] 4.1 Supplier + claim + pool query functions in `workers/src/database.ts` (retry wrappers),
      sharing the `shared/domain` resolvers.
- [ ] 4.2 Routes in `workers/src/index.ts` matching the backend surface.
- [ ] 4.3 Worker route/db tests (pglite) mirroring the backend cases.

## 5. Scheduled jobs

- [x] 5.1 Reminder engine: `runCreditClaimReminderJob` iterates orgs, `findFollowUpDue` +
      `sendFollowUp` per due claim, failures isolated. Registered in `scheduler.service` (daily 08:00).
- [x] 5.2 Photo-lifecycle purge job: `runCreditClaimPhotoPurgeJob` deletes storage objects + rows
      where `deleteAfter <= now`. Registered (daily 03:00). 3 job tests green; backend tsc clean.

## 6. Frontend (Supplier Credits workspace)

- [ ] 6.1 New nav entry + route (`AppNav.tsx`, `App.tsx`) and `supplierCreditService.ts`.
- [ ] 6.2 Triage board: To Claim (grouped by supplier + "needs supplier"), Open Claims (with
      follow-up-due badge), Settled.
- [ ] 6.3 Assign-supplier flow from the "needs supplier" bucket (create supplier + policy inline).
- [ ] 6.4 Claim builder: per-line batch input + photo upload, live expected-credit total, email
      preview, send.
- [ ] 6.5 Claim-detail: timeline, resend-follow-up, record-outcome controls.
- [ ] 6.6 Recovery summary panel (outstanding $, per-supplier recovery rate, money left on the table).
- [ ] 6.7 Component tests: triage grouping, builder validation (send preconditions), detail timeline.

## 7. Completion checks

- [ ] 7.1 `npm run lint` (backend + frontend) clean.
- [ ] 7.2 Affected tests pass (shared, backend, workers, frontend); conformance test green.
- [ ] 7.3 `tsc --noEmit` clean across packages.
- [ ] 7.4 `npx openspec validate add-supplier-credit-claims --strict` passes.
