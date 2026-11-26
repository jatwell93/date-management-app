## MODIFIED Requirements

### Requirement: A curated master catalogue maps products to brand and supplier

The system SHALL maintain a provider-curated master catalogue, keyed by barcode, that records each
product's description, per-wholesaler SKUs (API, Sigma, CH2), brand, manufacturer, department,
category, reference prices, an optional list cost price, and an optional base-list rank. The
catalogue SHALL be global read-only reference data that tenants read but never
write. When a store's product import is enriched, the system SHALL match uploaded items by barcode
first and fall back to matching the uploaded SKU against any wholesaler SKU. Retired catalogue
entries SHALL be excluded from all import matching — neither their barcode nor their wholesaler SKUs
SHALL match an uploaded item — while remaining preserved for audit. A matched item SHALL be tagged
with the catalogue's brand and a suggested supplier; an unmatched item SHALL surface in a
"needs brand" state. The owner's sheet SHALL name the two levels "Department" and "Category"; the
catalogue SHALL keep storing them in its existing category and sub-category fields so that existing
matching is unaffected. A sheet that lacks a "Department" header SHALL be read in the legacy layout, where "Category" and "Sub-Category" keep their old meaning.

#### Scenario: A barcode match tags brand and suggested supplier

- **GIVEN** a master catalogue entry for barcode 9321299800449 with brand "The Cancer Council"
- **WHEN** an uploaded product with that barcode is enriched
- **THEN** the product is linked to a brand named "The Cancer Council"
- **AND** the brand carries the catalogue's manufacturer as an advisory supplier suggestion

#### Scenario: A missing catalogue barcode match falls back to a wholesaler SKU

- **GIVEN** an uploaded product whose barcode has no master-catalogue match but whose API SKU matches an active catalogue entry's API SKU
- **WHEN** the product is enriched
- **THEN** the product is matched to that catalogue entry via the wholesaler SKU

#### Scenario: A retired entry does not match

- **GIVEN** a retired catalogue entry for barcode 9300000000001 whose API SKU is "API-123"
- **WHEN** an uploaded product with that barcode or that API SKU is enriched
- **THEN** the product does not match the retired entry
- **AND** it surfaces in the "needs brand" state unless another active entry matches

#### Scenario: An active shared-SKU entry wins independently of row order

- **GIVEN** active and retired catalogue entries share the same wholesaler SKU
- **WHEN** an uploaded product is enriched by the Worker
- **THEN** the active catalogue entry matches regardless of database row order

#### Scenario: An unmatched item lands in needs-brand

- **GIVEN** an uploaded product whose barcode and SKU match no active catalogue entry
- **WHEN** the product is enriched
- **THEN** the product appears in the "needs brand" state with no brand assigned

#### Scenario: A sheet with a Department header maps onto the existing fields

- **GIVEN** a sheet with "Department" and "Category" headers
- **WHEN** the owner publishes it
- **THEN** each entry's Department is stored as its category and its Category as its sub-category
- **AND** barcode and wholesaler-SKU matching behave as before

#### Scenario: A legacy sheet still publishes

- **GIVEN** a sheet with "Category" and "Sub-Category" headers and no "Department" header
- **WHEN** the owner publishes it
- **THEN** it is read in the legacy layout and no cost price or rank is required
