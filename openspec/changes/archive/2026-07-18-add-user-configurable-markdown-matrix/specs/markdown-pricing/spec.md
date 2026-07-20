## ADDED Requirements

### Requirement: Each organization configures its own 3-band markdown matrix

The system SHALL let an organization define its own markdown matrix of exactly three bands, keyed to
the existing day-to-expiry windows (band 1 = 61-90 days, band 2 = 31-60 days, band 3 = 0-30 days).
Each band SHALL have a discount percentage between 0 and 100 and a basis of either cost price or
retail price. The organization's matrix SHALL be scoped to that organization only, with the
organization derived from the authenticated context and never from a client-supplied identifier.
Until an organization edits its matrix, the system SHALL apply the default matrix of band 1 = 50%
off cost, band 2 = 60% off cost, band 3 = 75% off cost, so existing organizations see no change in
behavior.

#### Scenario: New organization uses the default matrix

- **GIVEN** an organization that has never edited its markdown matrix
- **WHEN** a markdown price is computed for one of its items 80 days from expiry (band 1) with a cost of 10
- **THEN** the price is 5.00 (50% off cost), matching the pre-existing default ladder

#### Scenario: Organization sets custom retail-based bands

- **GIVEN** an organization that has uploaded retail prices
- **AND** it configures band 1 = 50% off retail, band 2 = 75% off retail, band 3 = 90% off retail
- **WHEN** a markdown price is computed for an item 20 days from expiry (band 3) with a retail price of 10
- **THEN** the price is 1.00 (90% off retail)

#### Scenario: Percentages are bounded and bands are non-decreasing

- **WHEN** an organization saves a matrix with a band percentage outside 0-100, or a nearer-expiry band discounted less than a further-expiry band
- **THEN** the save is rejected with a validation error and the stored matrix is unchanged

#### Scenario: Matrix changes recompute prices live

- **GIVEN** an organization changes a band's percentage
- **WHEN** its reports or calculators are next viewed
- **THEN** the reduced prices reflect the new matrix without any per-row snapshot or migration

### Requirement: Retail basis requires uploaded retail prices

The system SHALL store a product's retail price as a value distinct from its cost price, and SHALL
only offer the retail basis for a markdown band when the organization has at least one product with a
retail price. When the organization has no retail data, the configuration options SHALL be reduced to
cost only. When an individual product on a retail-basis band has no retail price, the system SHALL
fall back to that product's cost price so the item is still priced.

#### Scenario: Retail basis unavailable without retail data

- **GIVEN** an organization that has only uploaded cost prices
- **WHEN** it opens the markdown matrix configuration
- **THEN** only the cost basis is selectable for every band
- **AND** an attempt to save a band with the retail basis is rejected

#### Scenario: Per-product fallback to cost

- **GIVEN** an organization with a band set to the retail basis
- **AND** a product in that band that has a cost price but no retail price
- **WHEN** the product's markdown price is computed
- **THEN** the price is derived from the product's cost price rather than being left unpriced

### Requirement: Distinct retail column on product upload

The catalogue upload SHALL recognize retail/selling-price columns as a retail price distinct from
cost, rather than folding them into the cost price. Cost price SHALL remain required; retail price
SHALL be optional so cost-only catalogues continue to upload successfully.

#### Scenario: Upload with both cost and retail

- **GIVEN** a catalogue file with separate cost and retail (or selling price) columns
- **WHEN** it is uploaded
- **THEN** each product stores both its cost price and its retail price as distinct values

#### Scenario: Cost-only upload still succeeds

- **GIVEN** a catalogue file with a cost column but no retail column
- **WHEN** it is uploaded
- **THEN** the upload succeeds and products have a cost price and no retail price
