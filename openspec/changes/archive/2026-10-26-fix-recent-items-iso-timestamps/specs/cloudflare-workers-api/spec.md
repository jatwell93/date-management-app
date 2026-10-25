## ADDED Requirements

### Requirement: Worker API timestamps are ISO-8601 UTC

The Worker API SHALL return every timestamp it reads from a timestamp column as an ISO-8601 UTC string with milliseconds, `YYYY-MM-DDTHH:MM:SS.mmmZ`, never the space-separated form Postgres prints for `::text`. Date-only values SHALL stay `YYYY-MM-DD`. A test SHALL fail if a non-test file in `workers/src` casts a timestamp column to text. The only exemption is the `trial_end_date` reads of the trial-email and SaaS-metrics jobs, which are not API responses and whose trial-email stale-message check compares the value as read.

#### Scenario: Recent inventory items carry an ISO-8601 createdAt

- **GIVEN** an inventory item created at 2026-10-19 03:12:45.123 UTC
- **WHEN** a client calls `GET /api/inventory-items/recent/product/:productId` for its product
- **THEN** the item's `createdAt` is `2026-10-19T03:12:45.123Z`
- **AND** `new Date(createdAt)` is that instant in every JavaScript engine

#### Scenario: User, transaction and credit-claim timestamps are ISO-8601

- **WHEN** the Worker returns a user's `createdAt`, an expired-item transaction's `transactionDate`, or a credit claim's `sentAt`, `nextFollowUpAt`, `settledAt`, supplier policy update time or event `createdAt`
- **THEN** the value matches `YYYY-MM-DDTHH:MM:SS.mmmZ`

#### Scenario: Date-only values are unchanged

- **WHEN** the Worker returns an `expiryDate`
- **THEN** the value is `YYYY-MM-DD`

#### Scenario: A text cast of a timestamp column fails the tests

- **GIVEN** a non-test file in `workers/src` selects `created_at::text`
- **WHEN** the Workers tests run
- **THEN** the static timestamp test fails
