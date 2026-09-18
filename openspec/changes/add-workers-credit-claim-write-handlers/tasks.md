# Tasks: Workers write-side handlers for supplier credit claims

Carried forward from `add-supplier-credit-claims` task 4.2 (deferred). Read-side pool + conformance
already landed; this covers the write side only.

## 1. Supplier + product-assign write handlers

- [ ] 1.1 `createSupplier` / `updateSupplier` (name, contact email, policy note, ratio, follow-up
      cadence) in `workers/src/database.ts`, org-scoped from auth (never client payload).
- [ ] 1.2 `assignProductSupplier` (set/unset `Product.supplierId`), persisting for future write-offs.
- [ ] 1.3 Route wiring in `workers/src/index-minimal.ts` with retry wrappers + org-scoping. (This
      change was written when `workers/src/index.ts` still existed; that layer and
      `workers/src/handlers/` were deleted as dead code by `retire-express-unify-on-postgres`
      tasks 3.1.0 / 3.1.0b, so `index-minimal.ts` is the only deployed entrypoint. Its route table
      is the `MINIMAL_ROUTES` table, with the existing claim read route at `index-minimal.ts:273`.)

## 2. Claim build/send/outcome/follow-up handlers

- [ ] 2.1 `buildClaim` — attach write-off lines, snapshot expected credit via
      `shared/domain/credit-claim.ts`, enforce the unique one-write-off-per-line rule. The status
      vocabulary and the open/settled partition (`CREDIT_CLAIM_STATUSES`, `OPEN_CLAIM_STATUSES`,
      `SETTLED_CLAIM_STATUSES`) are exported from that same module as of
      `retire-express-unify-on-postgres` task 3.1.e — use them, do not re-declare the strings, and
      note `CHASEABLE_CLAIM_STATUSES` is a *proper subset* of open (no `DRAFT`/`SENDING`).
- [ ] 2.2 `sendClaim` — R2 photo upload + Resend via `fetch`; set verified `sentAt` only on success;
      schedule first follow-up. Reject when no lines or supplier has no contact email.
- [ ] 2.3 `recordOutcome` — credited / partially credited / rejected → `settledAt`, `creditedValue`,
      photo `deleteAfter`; append event.
- [ ] 2.4 `sendFollowUp` — advance `nextFollowUpAt` by supplier cadence, bump `followUpCount`,
      append event.
- [ ] 2.5 Routes for 2.1–2.4 in `workers/src/index-minimal.ts` (see 1.3 on the entrypoint).

## 3. Photos + email (Workers-native)

- [ ] 3.1 Photo upload via R2 bindings (no `multer`/disk); metadata + `deleteAfter` to the DB.
- [ ] 3.2 Claim email via Resend `fetch` (no Node SDK).

## 4. Conformance + verification

- [ ] 4.1 Extend the pglite conformance harness (`workers/src/__tests__/pglite-db.ts`) to cover the
      write-side resolvers/rollups against the backend.
- [ ] 4.2 Worker route/validation tests: org-scoping, unique-line, send-preconditions, plus the two
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
        Worker at `index-minimal.ts:3787-3789` (the `instanceof File` guard precedes every R2 and
        DB call); follow that shape for 3.1. Assert ordering (the
        service/R2 mock is never called), not just the status code.
- [ ] 4.3 Completion checks: `npm run test:db`, `npm run build:workers`,
      `npx openspec validate add-workers-credit-claim-write-handlers --strict`.
