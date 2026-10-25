# Proposal: Return ISO-8601 timestamps from the Worker API

## Why

Several Worker reads serialise a timestamp column with `::text` (#672). Postgres prints a `TIMESTAMP(3)` column as `2026-10-19 03:12:45.123`: a space instead of `T`, and no zone. That is not ISO-8601. Safari/JSC's `new Date()` gives Invalid Date for it, and other engines read it as local time, although the column holds UTC.

The frontend on the scan page guards against an unparseable value since #655, but the API should return one unambiguous format. Two reads already do: `getLastCatalogueUpload` (`workers/src/database.ts:1757`) and `listOrgAuditLog` (`workers/src/database.ts:3788`).

This is also the first real product change for the factory (task 5.2 of `factory-one-merge-per-change`): small, Workers-only, no migration, and every result is provable by a test.

## What Changes

- Every timestamp the Worker returns from these reads is ISO-8601 UTC with milliseconds, `YYYY-MM-DDTHH:MM:SS.mmmZ`, written with the pattern `listOrgAuditLog` uses: `to_char(<col>, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`. The columns are naive `TIMESTAMP(3)` holding UTC, so the `Z` is a literal.
  - `findRecentInventoryItemsByProductId` `createdAt` (`workers/src/database.ts:3025`), the read #672 is about.
  - The user reads: `listUsers` (`:3752`), the role-change read (`:994`) and the user-create read (`:1105`), all `createdAt`.
  - The expired-item transaction write's `transactionDate` (`:2723`).
  - The credit-claim reads in `workers/src/credit-claim-database.ts`: `sentAt`, `nextFollowUpAt`, `settledAt`, `supplier_policy_updated_at` (`:216`-`:231`) and the claim events' `createdAt` (`:276`). `SupplierCreditsPage` passes the event `createdAt` to `new Date()` (`frontend/src/pages/SupplierCreditsPage.tsx:1024`), so Safari shows Invalid Date today. `parseDbTimestamp` (`workers/src/credit-claim-service.ts:91`) already accepts both shapes, so the follow-up schedule keeps working.
- A static test fails if any non-test file in `workers/src` casts a timestamp column (`*_at`, `transaction_date`, `trial_end_date`) to text again, except the exemption below.
- Date-only columns (`expiry_date`, `created_at::date::text`) keep `::text`: `YYYY-MM-DD` is already ISO-8601.
- Exempt: the `trial_end_date::text` reads in `workers/src/notifications/trial-email-database.ts` and `workers/src/scheduled/jobs/saas-metrics-snapshot.ts`. They are trial and billing jobs, not API responses, and the trial-email queue compares the value it enqueued with a later read to detect a stale message (`workers/src/notifications/messages.ts:8`), so changing one side alone would break that check. The static test lists these lines by file, so a new cast elsewhere still fails.

Not changed: the frontend, the database schema, response field names. The pglite harness needs no change: it applies the real migrations (`workers/src/__tests__/pglite-db.ts:13`), so #672's third to-do is already covered.

## Impact

- `workers/src/database.ts`, `workers/src/credit-claim-database.ts` and their tests only.
- API consumers get `T` and `Z` where they got a space and no zone. `new Date()` reads both on Chromium, so the visible change is that Safari parses the value, and every engine reads it as UTC.

## Autonomy

```yaml
merge: human
issue: 672
no_go:
  - frontend/**
  - shared/**
  - database/**
```
