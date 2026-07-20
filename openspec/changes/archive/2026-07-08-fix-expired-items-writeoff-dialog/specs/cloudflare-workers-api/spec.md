## ADDED Requirements

### Requirement: Expired Items Workers API Parity

The Cloudflare Workers API SHALL preserve frontend-compatible expired item processing and expired-loss reporting behavior for `/api/expired-items`.

#### Scenario: Expired loss report route returns frontend shape

- **WHEN** an authenticated user requests `GET /api/expired-items/reports/expired-losses`
- **THEN** the Worker returns HTTP 200
- **AND** the response body contains `lossesBySKU`
- **AND** the response body contains `lossesByStoreArea`

#### Scenario: Expired write-off processes requested quantity

- **WHEN** an authenticated user posts `POST /api/expired-items/process` with action `expired` and `unitsDiscarded` greater than `1`
- **THEN** the Worker processes exactly that many matching expired inventory rows for the same product, store area, and cost group
- **AND** the Worker records one expired item transaction with `units_discarded` equal to the requested quantity
- **AND** the Worker records `financial_loss` equal to requested quantity multiplied by unit cost
- **AND** processed rows no longer appear in the expired items worklist

#### Scenario: Expired write-off quantity bounds are enforced

- **WHEN** an authenticated user posts an expired write-off with `unitsDiscarded` below `1`, non-integer, or greater than the grouped available quantity
- **THEN** the Worker rejects the request with a validation error
- **AND** no inventory rows are dispositioned
- **AND** no expired item transaction is recorded
