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
- [x] 2.6 Dual-backend conformance test (`database.credit-claim.conformance.node.test.ts`):
      claimable-pool rollup + expected-credit identical across Neon/pglite and SQLite, including row
      order and org isolation. 2 tests green.

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

- [x] 4.1 Claimable-pool query `getClaimablePool` in `workers/src/database.ts` (Neon SQL → shared
      `rollupClaimablePool`), proven identical to the SQLite backend by the 2.6 conformance test.
- [ ] 4.2 **DEFERRED** — write-side worker handlers (supplier CRUD, claim build/send/outcome/
      follow-up, photos) + routes in `workers/src/index.ts`. The backend Express router can't be
      registered as-is (it imports `multer` for photos, which won't bundle in Workers); these need
      Workers-native handlers (Resend via fetch is fine; photos need R2 bindings). Read-side pool +
      conformance landed; write-side is a follow-up before production deploy.
- [x] 4.3 Worker db conformance test (pglite vs SQLite) for the claimable pool — see 2.6.

## 5. Scheduled jobs

- [x] 5.1 Reminder engine: `runCreditClaimReminderJob` iterates orgs, `findFollowUpDue` +
      `sendFollowUp` per due claim, failures isolated. Registered in `scheduler.service` (daily 08:00).
- [x] 5.2 Photo-lifecycle purge job: `runCreditClaimPhotoPurgeJob` deletes storage objects + rows
      where `deleteAfter <= now`. Registered (daily 03:00). 3 job tests green; backend tsc clean.

## 6. Frontend (Supplier Credits workspace)

- [x] 6.1 Nav entry + `/supplier-credits` route (`AppNav.tsx`, `App.tsx`) and `supplierCreditService.ts`.
- [x] 6.2 Triage board: To Claim (grouped by supplier + "needs supplier"), Open Claims (with
      follow-up-due count/badge), Settled tabs.
- [x] 6.3 Assign-supplier flow from the "needs supplier" bucket (pick existing or create supplier +
      ratio inline).
- [x] 6.4 Claim builder: per-line batch input + expected-credit hints; photo upload per line in the
      detail modal (attach before send). Live email preview deferred (send renders server-side).
- [x] 6.5 Claim-detail: timeline, send, resend-follow-up, record-outcome (credited/rejected) controls.
- [x] 6.6 Recovery summary panel (outstanding $, money on the table, per-supplier recovery rate).
- [x] 6.7 Component tests: recovery panel + pool grouping render, follow-up-due badge on Open tab,
      build-claim modal opens with batch input (3 tests green; frontend tsc clean for new files).

## 7. Completion checks

- [x] 7.1 Lint clean on all new files (backend + frontend); prettier auto-fixed.
- [x] 7.2 Affected tests pass: 44 backend + 2 workers conformance + 3 frontend = 49 feature tests.
- [x] 7.3 `tsc --noEmit` clean: backend 0 errors, workers typecheck clean, frontend 0 errors in new
      files (pre-existing errors elsewhere untouched).
- [x] 7.4 `npx openspec validate add-supplier-credit-claims --strict` passes.
