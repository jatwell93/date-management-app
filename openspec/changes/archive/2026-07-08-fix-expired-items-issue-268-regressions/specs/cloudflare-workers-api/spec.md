## ADDED Requirements

### Requirement: Expired Loss Report Route Deployment Parity

The Cloudflare Workers API SHALL expose the expired-loss report route in built and deployed route tables.

#### Scenario: Expired loss report route is not route-not-found

- **WHEN** a request is made to `GET /api/expired-items/reports/expired-losses`
- **THEN** the Worker route dispatcher matches the expired-loss report handler
- **AND** the response is not HTTP 404 route-not-found
- **AND** authenticated requests return a body containing `lossesBySKU` and `lossesByStoreArea`

#### Scenario: Live smoke probe detects stale deployment

- **WHEN** the deployment smoke check probes `https://api.expirymate.com.au/api/expired-items/reports/expired-losses`
- **THEN** a route-not-found HTTP 404 response fails the smoke check
- **AND** authentication-related responses are allowed for unauthenticated probes

### Requirement: Expired Items Grouped Quantity Processing

Expired item worklist and processing behavior SHALL use grouped quantity availability for same product, location, expiry, and cost pool rows.

#### Scenario: Grouped expired worklist reports available quantity

- **WHEN** multiple expired inventory rows share the same product, location, expiry date, and cost price
- **THEN** the expired items worklist returns one grouped row
- **AND** that grouped row has `quantityAvailable` equal to the number of matching undispositioned rows

#### Scenario: Multi-unit expired write-off processes exact requested units

- **WHEN** an authenticated user processes an expired grouped row with `unitsDiscarded` set to `N`
- **THEN** exactly `N` matching inventory rows are marked disposed
- **AND** exactly one expired item transaction is recorded with `unitsDiscarded` equal to `N`
- **AND** financial loss equals `N` multiplied by the grouped unit cost

### Requirement: Expired Items Dialog Quantity UX

The expired item process dialog SHALL present grouped item details and quantity controls with consistent typography while preserving editable whole-number quantity entry.

#### Scenario: Dialog detail typography is consistent

- **WHEN** a user opens the expired write-off dialog for a grouped expired item
- **THEN** Product, SKU, Location, Expiry Date, Cost Price, quantity helper text, and quantity error text use the dialog detail typography system
- **AND** the dialog does not mix monospace, muted helper, and tabular number styles for these values

#### Scenario: User can submit a non-one grouped quantity

- **WHEN** a grouped expired item has `quantityAvailable` of `100`
- **AND** the user enters `37`
- **THEN** the confirmation copy shows `37` units and the calculated loss
- **AND** the process request sends `{ unitsDiscarded: 37 }`
