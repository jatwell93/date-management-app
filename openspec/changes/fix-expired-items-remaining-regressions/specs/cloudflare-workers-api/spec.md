## MODIFIED Requirements

### Requirement: Expired loss report route is present in deployed Worker artifact

The Workers API SHALL register `GET /api/expired-items/reports/expired-losses` in the minimal Worker entrypoint used by production builds.

#### Scenario: Built artifact contains expired loss report route

- **GIVEN** the production Worker is built from `workers/src/index-minimal.ts`
- **WHEN** `npm run build --prefix workers` completes
- **THEN** `workers/dist/index.js` contains `/api/expired-items/reports/expired-losses`
- **AND** this route is not implemented only in `workers/src/index.ts`

#### Scenario: Live expired loss report route is not route-missing

- **WHEN** a smoke check probes `https://api.expirymate.com.au/api/expired-items/reports/expired-losses`
- **THEN** a `404` response fails the check
- **AND** authentication, rate-limit, or server responses are accepted as route-present signals

### Requirement: Expired write-offs preserve multi-unit quantities and realized loss

Expired write-offs SHALL process exactly the requested number of matching inventory rows and record realized loss from the expired item transaction ledger.

#### Scenario: User submits a multi-unit expired write-off

- **GIVEN** an expired grouped row has `quantityAvailable` greater than `1`
- **WHEN** the user clears `#units-discarded` and types a whole number `N` within the available quantity
- **THEN** the field shows the full value typed
- **AND** the confirmation text references `N units`
- **AND** the API receives `{ inventoryItemId, action: "expired", unitsDiscarded: N }`

#### Scenario: API records realized loss for multi-unit expired write-off

- **GIVEN** `N` matching expired inventory rows share the selected product, location, expiry, and status criteria
- **WHEN** an expired write-off is submitted with `unitsDiscarded` equal to `N`
- **THEN** exactly `N` matching inventory rows are processed
- **AND** exactly one `expired_item_transactions` row is recorded with `units_discarded = N`
- **AND** `financial_loss = costPrice * N`
- **AND** expired-loss reports return `{ lossesBySKU, lossesByStoreArea }`
