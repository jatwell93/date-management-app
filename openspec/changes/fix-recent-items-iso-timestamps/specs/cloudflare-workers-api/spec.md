## ADDED Requirements

### Requirement: Worker API timestamps are ISO-8601 UTC

The Worker SHALL return every timestamp it reads from a timestamp column as an ISO-8601 UTC string with milliseconds, `YYYY-MM-DDTHH:MM:SS.mmmZ`, never the space-separated form Postgres prints for `::text`. Date-only values SHALL stay `YYYY-MM-DD`. A test SHALL fail if `workers/src/database.ts` casts a timestamp column to text.

#### Scenario: Recent inventory items carry an ISO-8601 createdAt

- **GIVEN** an inventory item created at 2026-10-19 03:12:45.123 UTC
- **WHEN** a client calls `GET /api/inventory-items/recent/product/:productId` for its product
- **THEN** the item's `createdAt` is `2026-10-19T03:12:45.123Z`
- **AND** `new Date(createdAt)` is that instant in every JavaScript engine

#### Scenario: User and transaction timestamps are ISO-8601

- **WHEN** the Worker returns a user's `createdAt` or an expired-item transaction's `transactionDate`
- **THEN** the value matches `YYYY-MM-DDTHH:MM:SS.mmmZ`

#### Scenario: Date-only values are unchanged

- **WHEN** the Worker returns an `expiryDate`
- **THEN** the value is `YYYY-MM-DD`

#### Scenario: A text cast of a timestamp column fails the tests

- **GIVEN** `workers/src/database.ts` selects `created_at::text`
- **WHEN** the Workers tests run
- **THEN** the static timestamp test fails
