# Tasks: Workers write-side handlers for supplier credit claims

Carried forward from `add-supplier-credit-claims` task 4.2 (deferred). Read-side pool + conformance
already landed; this covers the write side only.

## 1. Supplier + product-assign write handlers

**Already complete when this change was picked up.** These tasks were written while only
Express had supplier writes; `retire-express-unify-on-postgres` has since ported all of
them. Verified present, not re-implemented: `createSupplier` / `updateSupplier` /
`clearSupplierPolicy` in `workers/src/supplier-credit-database.ts:128`/`:153`/`:176`,
`assignProductSupplier` in `workers/src/database.ts:2108`, and the five routes in
`MINIMAL_API_ROUTES` (`index-minimal.ts:290`-`302`).

- [x] 1.1 `createSupplier` / `updateSupplier` (name, contact email, policy note, ratio, follow-up
      cadence) in `workers/src/database.ts`, org-scoped from auth (never client payload).
- [x] 1.2 `assignProductSupplier` (set/unset `Product.supplierId`), persisting for future write-offs.
- [x] 1.3 Route wiring in `workers/src/index-minimal.ts` with retry wrappers + org-scoping. (This
      change was written when `workers/src/index.ts` still existed; that layer and
      `workers/src/handlers/` were deleted as dead code by `retire-express-unify-on-postgres`
      tasks 3.1.0 / 3.1.0b, so `index-minimal.ts` is the only deployed entrypoint. Its route table
      is the `MINIMAL_API_ROUTES` table (`index-minimal.ts:241`), with the existing claim read
      route at `index-minimal.ts:305`.)

## 2. Claim build/send/outcome/follow-up handlers

- [x] 2.1 `buildClaim` — attach write-off lines, snapshot expected credit via
      `shared/domain/credit-claim.ts`, enforce the unique one-write-off-per-line rule. The status
      vocabulary and the open/settled partition (`CREDIT_CLAIM_STATUSES`, `OPEN_CLAIM_STATUSES`,
      `SETTLED_CLAIM_STATUSES`) are exported from that same module as of
      `retire-express-unify-on-postgres` task 3.1.e — use them, do not re-declare the strings, and
      note `CHASEABLE_CLAIM_STATUSES` is a *proper subset* of open (no `DRAFT`/`SENDING`).
- [x] 2.2 `sendClaim` — R2 photo upload + Resend via `fetch`; set verified `sentAt` only on success;
      schedule first follow-up. Reject when no lines or supplier has no contact email.
- [x] 2.3 `recordOutcome` — credited / partially credited / rejected → `settledAt`, `creditedValue`,
      photo `deleteAfter`; append event.
- [x] 2.4 `sendFollowUp` — advance `nextFollowUpAt` by supplier cadence, bump `followUpCount`,
      append event.
- [x] 2.5 Routes for 2.1–2.4 in `workers/src/index-minimal.ts` (see 1.3 on the entrypoint).

## 3. Photos + email (Workers-native)

- [x] 3.1 Photo upload via R2 bindings (no `multer`/disk); metadata + `deleteAfter` to the DB.
- [x] 3.2 Claim email via Resend `fetch` (no Node SDK).

## 4. Conformance + verification

- [x] 4.1 Extend the pglite conformance harness (`workers/src/__tests__/pglite-db.ts`) to cover the
      write-side resolvers/rollups against the backend.
- [x] 4.2 Worker route/validation tests: org-scoping, unique-line, send-preconditions, plus the two
      properties below. They come from `retire-express-unify-on-postgres` task 3.1.d, which read the
      Express controller tests this migration retires and found two guarantees that exist only there
      — so porting the routes without porting these would lose them silently:
      - **The claim creator comes from the verified JWT and never the request body.** Express passes
        `req.userId` into `buildClaim` as a separate argument from the body
        (`backend/src/controllers/credit-claim.controller.ts:44`, asserted at
        `backend/src/tests/controllers/credit-claim.controller.test.ts:65`). The Worker handler for
        2.1 must take the creator from `auth`, and the test must prove a body-supplied
        `createdByUserId` is ignored rather than merely absent.
      - **A photo upload with no file is rejected before the service is invoked.** Express throws
        `ValidationError` on `!req.file` ahead of any call
        (`credit-claim.controller.ts:52-54`, asserted at `credit-claim.controller.test.ts:79`).
        This is the same reject-before-work ordering `handleUploadDirect` already gets right in the
        Worker at `index-minimal.ts:3844` (the `instanceof File` guard at `:3865` precedes every R2 and
        DB call); follow that shape for 3.1. Assert ordering (the
        service/R2 mock is never called), not just the status code.
- [x] 4.3 Completion checks: `npm run test:db`, `npm run build:workers`,
      `npx openspec validate add-workers-credit-claim-write-handlers --strict`.

## Implementation notes

- **Where the code landed.** `workers/src/credit-claim-database.ts` (SQL primitives,
  split out of `database.ts` the way `supplier-credit-database.ts` is),
  `workers/src/credit-claim-service.ts` (send/follow-up/outcome orchestration, R2,
  Resend), and six routes in `index-minimal.ts`. `listCreditClaims` moved into the new
  module and gained a shared loader so the list and detail views cannot disagree.
- **No transactions.** The Neon HTTP driver has none, so everything the backend does in
  `prisma.$transaction` becomes a single statement with CTEs. Atomicity is
  mutation-verified: splitting the build into header-then-lines fails `rolls the whole
  build back` and nothing else. The one-write-off-per-claim *race* is closed by the
  `credit_claim_lines.expired_item_transaction_id UNIQUE` constraint, not by the CTE --
  the pre-flight check only buys the friendly message.
- **`renderClaimEmail` was hoisted** to `shared/domain/credit-claim-email.ts`, with
  `backend/src/services/credit-claim-email.helpers.ts` left as a re-export. This is a
  backend touch the proposal's "out of scope" did not anticipate; the alternative was a
  second copy of the supplier email body, which is the drift that produced four
  disagreeing copies of the role vocabulary (#517). Backend behaviour is unchanged (59
  backend credit-claim tests pass).
- **Photos reuse the `CSV_UPLOADS` R2 bucket** under a
  `credit-claims/{org}/{claim}/{line}/` prefix rather than adding a binding, so no
  Cloudflare change is needed to deploy. A dedicated bucket with its own lifecycle rule
  remains available later.
- **`RESEND_API_KEY` / `RESEND_FROM_EMAIL` are declared optional** in `types/env.d.ts`
  and are **not yet set on any Worker environment**. Until they are, send and follow-up
  return the backend's "Email provider is not configured" validation error and roll the
  claim back to `DRAFT` -- every other claim operation works.
  **Both** are required before the send path is live:
  `wrangler secret put RESEND_API_KEY` and `wrangler secret put RESEND_FROM_EMAIL`.
  A missing sender counts as unconfigured rather than falling back to a placeholder,
  because Resend rejects a `from` outside a verified domain -- the placeholder would
  turn a clean refusal into a provider error on the first real send.
- **Harness fix.** The pglite harness declared the four `credit_claim*` tables
  `TIMESTAMPTZ` where migration 0005 declares `timestamp(3)`. The write path casts with
  an explicit `::timestamp`, which a naive column stores verbatim but a `TIMESTAMPTZ`
  column re-interprets in the session zone -- so the harness shifted every `sent_at` by
  the runner's UTC offset. Corrected to match the migration. The matching read-side
  hazard (`new Date` on a zone-less string is *local* time) is handled by
  `parseDbTimestamp` in `credit-claim-service.ts`.
- **Verification.** 38 real-SQL tests + 41 route/service tests, all new. Fourteen
  mutations were run against them; each killed the test guarding it and no others.
  `npm run test:db` 236 passed, `npx vitest run` 365 passed, `npm run typecheck` and
  `npm run build` clean, backend `tsc` clean, 59 backend credit-claim tests pass.

## Bot review round

Two automated reviews of the branch produced ten distinct findings. Seven were
confirmed against the code and fixed, two were rejected with reasons, one was confirmed
but deferred to its own issue.

**Fixed**

- **Stuck `SENDING` (the one that mattered).** `finalizeSentClaim` ran with no error
  handling after the supplier had already been emailed. `SENDING` is a dead end --
  `reserveClaimForSending` needs `DRAFT`, follow-ups need a chaseable status,
  `recordOutcome` refuses anything neither chaseable nor `PARTIALLY_CREDITED`, and
  `revertClaimToDraft` is only reachable from inside `sendClaim`'s own failure paths --
  so a transient Neon failure stranded the claim with no route out. Now retried once
  and, on a second failure, reported through the backend's own `sending-stuck` Sentry
  tags. **The review's suggested remedy was a blind retry, which would have introduced
  the bug issue #487 documents:** a statement that times out *after* the server
  committed it gets applied twice, and this one ends in an `INSERT` of the `SENT`
  event. `finalizeSentClaim` is therefore now gated on `status = 'SENDING'`, which
  makes it idempotent -- a retry after a committed attempt matches no row, so the
  `updated` CTE is empty and no duplicate event is written. The retry is only safe
  because of that predicate.
- The file header's claim that the ambiguous `SENDING` state "is not reachable the same
  way" was corrected: single-statement finalize removes the *partial* finalize, not a
  *failed* one.
- `revertClaimToDraft` on the not-configured path was unguarded while the sibling call
  in the `catch` was guarded, so a failing revert replaced the caller's 400 with a 500.
  Both now go through `releaseReservation`, which reports the stuck row rather than
  swallowing it silently (the review's remedy swallowed it).
- Outcome validation now mirrors `claimOutcomeSchema`: non-negative `creditedValue`
  (a negative would have been counted as money recovered by the recovery report),
  `Number` instead of `parseFloat` (which reads "5abc" as 5), and the 1000-character
  note cap.
- `batchNumber` now mirrors `claimCreateSchema`: max 120 characters and no HTML tags.
- `loadAttachments` issues its R2 reads with `Promise.all` instead of serially.
- `escapeHtml` now escapes `'`. No current interpolation needs it, but the helper is
  shared now and the cost is nil.
- The renderer's JSDoc, carried over verbatim in the hoist, described a Prisma-shaped
  input it no longer takes (SKU, expiry, a product relation). Rewritten, and the module
  gained the unit tests it never had on either side (`credit-claim-email.test.ts`).

**Rejected**

- *Hoist the Resend endpoint URL and the `noreply@example.com` fallback into
  `shared/domain`.* `shared/domain/` holds domain logic deliberately free of transport;
  an HTTP endpoint and a placeholder sender are configuration. Nothing breaks if the
  runtimes disagree on them, unlike the email body, where divergence is silent and
  visible to suppliers. Moving them blurs the boundary that makes the module useful.
- *Guard on `Content-Length` before `request.formData()`.* `Content-Length` is
  attacker-controlled and absent on chunked uploads, so it does not actually bound
  isolate memory -- it only helps an honest client while reading as protection.
  Cloudflare already caps request bodies at the edge.

**Deferred to an issue**

- **#522** — `unitsClaimed` is never bounded by the write-off's `unitsDiscarded`, so a
  line can claim more units than were written off and snapshot the inflated expected
  credit.
  Real, but **shared with the backend** (`credit-claim.service.ts:93-96`) rather than a
  Worker divergence: fixing one runtime would break the parity this change exists to
  establish, and fixing the backend is out of scope here. Same disposition as #460.

**Verification of the round.** Eleven further mutations, each killing the test guarding
it and no others -- including the new idempotency predicate, whose removal fails the
"no-op when finalized a second time" test alone.

## Second review round (Copilot + Sentry)

The first round covered two bot reports. A later pass over the PR's own review threads
found Copilot and Sentry comments that had not been read. Six Copilot findings and one
Sentry finding, all confirmed against the code, all fixed.

- **The follow-up reservation was keyed only on the counter.** The caller checks
  `isChaseableClaimStatus` against a row it read earlier, so an outcome recorded in
  between left that check passing against a claim that was by then settled: the CAS
  still matched on the counter, the supplier was emailed about a closed claim, and a
  `next_follow_up_at` was written onto the settled row that `recordClaimOutcome` had
  just cleared -- re-arming the reminder engine against it permanently. The status is
  now part of the predicate, in `reserveFollowUp` and in `restoreFollowUpSchedule`.
  Same lesson as the `finalizeSentClaim` fix: a stale read is only safe when
  everything the decision rested on is re-checked in the write.
- **Sentry's duplicate-follow-up finding is the same defect from the other end.** It
  observed that the only way a duplicate nudge happens is a retry, and the only reason
  the client retries is that the function throws *after* the email was accepted. The
  post-send writes (the `FOLLOW_UP_SENT` event and the reload) are now best-effort and
  reported rather than thrown, so the caller is told the truth -- the nudge happened --
  and never retries into a second email.
- **A missing R2 object was being skipped silently** on the grounds that it had "already
  been purged". That is unreachable: photos attach only to `DRAFT` claims and
  `delete_after` is only set at settlement, so nothing can purge them while the claim is
  still sendable. It meant the R2 write and the metadata row had diverged, and the claim
  went to the supplier without the evidence it is built on. Now refused with an
  actionable 400 and the claim returned to `DRAFT`.
- **`RESEND_FROM_EMAIL` is now required**, not defaulted to `noreply@example.com`. Resend
  rejects an unverified sender, so the placeholder did not degrade gracefully -- it
  turned "not configured" into a 500 on the first send after someone set only the API
  key, which is exactly what this change's own deployment note told them to do.
- **An orphaned R2 object** was left behind when the metadata write *threw* (only a
  returned refusal was cleaned up). Nothing else knows the key, so the purge job -- which
  works from photo rows -- could never find it.
- **Body fields were coerced, not type-checked.** The backend's schemas are
  `z.number().int().positive()`, which refuse the string `"10"`; the Worker accepted it,
  and `Number()` also turned `true` and `''` into valid credited values. Both runtimes
  now answer alike. Path segments still parse from text, which is what a URL is.

Nine mutations were run against the fixes; each killed the test guarding it. Fixing the
follow-up CAS also exposed two existing tests that would have started passing for the
wrong reason -- the cross-organization one would have been refused by the new status
guard rather than by scoping -- so their fixtures now set a chaseable status explicitly.
