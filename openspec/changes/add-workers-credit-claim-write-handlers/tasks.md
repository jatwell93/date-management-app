# Tasks: Workers write-side handlers for supplier credit claims

Carried forward from `add-supplier-credit-claims` task 4.2 (deferred). Read-side pool + conformance
already landed; this covers the write side only.

## 1. Supplier + product-assign write handlers

- [ ] 1.1 `createSupplier` / `updateSupplier` (name, contact email, policy note, ratio, follow-up
      cadence) in `workers/src/database.ts`, org-scoped from auth (never client payload).
- [ ] 1.2 `assignProductSupplier` (set/unset `Product.supplierId`), persisting for future write-offs.
- [ ] 1.3 Route wiring in `workers/src/index.ts` with retry wrappers + org-scoping.

## 2. Claim build/send/outcome/follow-up handlers

- [ ] 2.1 `buildClaim` — attach write-off lines, snapshot expected credit via
      `shared/domain/credit-claim.ts`, enforce the unique one-write-off-per-line rule.
- [ ] 2.2 `sendClaim` — R2 photo upload + Resend via `fetch`; set verified `sentAt` only on success;
      schedule first follow-up. Reject when no lines or supplier has no contact email.
- [ ] 2.3 `recordOutcome` — credited / partially credited / rejected → `settledAt`, `creditedValue`,
      photo `deleteAfter`; append event.
- [ ] 2.4 `sendFollowUp` — advance `nextFollowUpAt` by supplier cadence, bump `followUpCount`,
      append event.
- [ ] 2.5 Routes for 2.1–2.4 in `workers/src/index.ts`.

## 3. Photos + email (Workers-native)

- [ ] 3.1 Photo upload via R2 bindings (no `multer`/disk); metadata + `deleteAfter` to the DB.
- [ ] 3.2 Claim email via Resend `fetch` (no Node SDK).

## 4. Conformance + verification

- [ ] 4.1 Extend the pglite conformance harness (`workers/src/__tests__/pglite-db.ts`) to cover the
      write-side resolvers/rollups against the backend.
- [ ] 4.2 Worker route/validation tests: org-scoping, unique-line, send-preconditions.
- [ ] 4.3 Completion checks: `npm run test:db`, `npm run build:workers`,
      `npx openspec validate add-workers-credit-claim-write-handlers --strict`.
