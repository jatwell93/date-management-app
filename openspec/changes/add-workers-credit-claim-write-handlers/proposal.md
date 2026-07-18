# Proposal: Workers write-side handlers for supplier credit claims

## Why

`add-supplier-credit-claims` (PR #356, archived) shipped the full credit-claim capability on the
backend (Express + SQLite) and landed the **read-side** parity on the Workers runtime — the
claimable-pool query `getClaimablePool` in `workers/src/database.ts`, proven identical to the backend
by the dual-backend conformance test. Task 4.2 of that change was explicitly **deferred**: the
**write-side** worker handlers were not implemented.

The backend Express router cannot be registered as-is in Workers — it imports `multer` for photo
uploads, which does not bundle for the Workers runtime, and photo storage needs R2 bindings rather
than a local disk. Until Workers-native write handlers exist, the credit-claim capability is only
fully operational on the backend; the production Workers/Neon path can read the claimable pool but
cannot create suppliers, build or send claims, record outcomes, or send follow-ups.

This is the last gap before credit claims are production-deployable on the Workers runtime, and it is
squarely on the theme of the current milestone (moving write paths off Express onto Workers +
Postgres).

## What changes

Add Workers-native write handlers and routes so the deployed Workers runtime has full parity with the
backend for the supplier credit-claim capability. No behavioral requirements change — the behaviors
are already specified and satisfied on the backend; this closes the runtime-parity gap for the
write side.

## Scope

- **Worker write handlers** in `workers/src/database.ts` (Neon SQL) mirroring the backend service/
  repository layer, reusing the `shared/domain/credit-claim.ts` resolvers so both runtimes compute
  identical expected-credit and follow-up values:
  - supplier CRUD (+ policy ratio / follow-up cadence)
  - assign supplier to a product
  - build a claim (attach write-off lines, snapshot expected credit, enforce the unique
    one-write-off-per-line rule)
  - send a claim (Resend via `fetch`, R2 photo upload, verified `sentAt`, first follow-up scheduled)
  - record outcome (credited / partially credited / rejected → `settledAt`, `creditedValue`, photo
    `deleteAfter`)
  - send follow-up (advance `nextFollowUpAt`, bump `followUpCount`, append event)
- **Routes** in `workers/src/index.ts` wiring the handlers with the standard org-scoping and retry
  wrappers, matching the backend route surface.
- **Photos via R2 bindings** rather than `multer`/disk; **email via Resend `fetch`** (no Node SDK).
- **Dual-backend conformance** extended to the write side where a shared rollup/resolver is involved,
  following the read-side pattern already in place.

## Out of scope

- Any change to the backend implementation, the shared domain resolvers, or the database schema —
  all three already exist and are unchanged.
- New credit-claim behaviors (partial line-level credits, supplier portal, inbound reply parsing) —
  these remain deferred as recorded in the archived change.

## Reuse Strategy

- **Reuse `shared/domain/credit-claim.ts`** (`expectedCredit`, `nextFollowUp`, status/event unions)
  so Workers and backend produce byte-identical results — the same parity discipline the read-side
  `rollupClaimablePool` used.
- **Reuse existing R2 upload plumbing** and per-org storage/tier accounting for photos rather than
  introducing new storage.
- **Mirror the backend route/validation contracts** (org-scoping from auth, unique-line enforcement,
  send preconditions) so the two runtimes stay behaviorally identical.

## Implementation Steps

1. Port supplier CRUD + product-assign write handlers to `workers/src/database.ts` (Neon SQL),
   sharing the domain resolvers.
2. Port claim build/send/outcome/follow-up handlers, wiring R2 photo upload and Resend `fetch`.
3. Wire routes in `workers/src/index.ts` with org-scoping and retry wrappers.
4. Extend the pglite conformance harness to cover the write-side resolvers/rollups.
5. Completion checks: `npm run test:db`, worker route/validation tests, `npm run build:workers`,
   and `npx openspec validate add-workers-credit-claim-write-handlers --strict`.
