# markdown-pricing Specification

## Purpose
TBD - created by archiving change add-user-configurable-markdown-matrix. Update Purpose after archive.
## Requirements
### Requirement: Each organization configures its own 3-band markdown matrix

The system SHALL let an organization define a markdown matrix of exactly three bands **for each
credit scope**, keyed to the existing day-to-expiry windows (band 1 = 61-90 days, band 2 = 31-60
days, band 3 = 0-30 days). The credit scopes SHALL be exactly `NO_CREDIT` and `FULL_CREDIT`. Each
band SHALL have a discount percentage between 0 and 100 and a basis of either cost price or retail
price, independently selectable per band and per scope. The matrices SHALL be scoped to that
organization only, with the organization derived from the authenticated context and never from a
client-supplied identifier.

Until an organization edits a scope's matrix, the system SHALL apply that scope's default: for
`NO_CREDIT`, band 1 = 50% off cost, band 2 = 60% off cost, band 3 = 75% off cost; for `FULL_CREDIT`,
band 1 = band 2 = band 3 = 20% off cost. Organizations that existed before this change SHALL retain
their stored matrix as their `NO_CREDIT` matrix, so no existing organization sees a change in
behavior.

Validation SHALL be identical for every scope: percentages bounded to 0-100, discounts non-decreasing
as expiry nears, and the retail basis available only to organizations holding retail prices.

#### Scenario: New organization uses the default matrices

- **GIVEN** an organization that has never edited its markdown matrices
- **WHEN** a markdown price is computed for a no-credit item 80 days from expiry (band 1) with a cost of 10
- **THEN** the price is 5.00 (50% off cost), matching the pre-existing default ladder
- **AND WHEN** a markdown price is computed for a full-credit item 80 days from expiry with a cost of 10
- **THEN** the price is 8.00 (20% off cost)

#### Scenario: Existing matrix is preserved as the no-credit matrix

- **GIVEN** an organization that had configured a matrix before credit scopes existed
- **WHEN** the change is deployed and its matrices are read
- **THEN** its stored bands are returned as its `NO_CREDIT` matrix unchanged
- **AND** every price it displayed before the deployment is identical after it

#### Scenario: Each scope is configured independently

- **GIVEN** an organization that sets its full-credit matrix to 20% off retail for all three bands
- **WHEN** it saves without touching its no-credit matrix
- **THEN** both matrices persist, and no-credit items continue to price on the previous no-credit bands

#### Scenario: A flat full-credit matrix is valid

- **WHEN** an organization saves a full-credit matrix of 20% / 20% / 20%
- **THEN** the save succeeds, because the non-decreasing rule permits equal discounts across bands

#### Scenario: Percentages are bounded and bands are non-decreasing in every scope

- **WHEN** an organization saves any scope's matrix with a band percentage outside 0-100, or with a nearer-expiry band discounted less than a further-expiry band
- **THEN** the save is rejected with a validation error and both stored matrices are unchanged

#### Scenario: Matrix changes recompute prices live

- **GIVEN** an organization changes a band's percentage in either scope
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

### Requirement: Markdown prices are scoped by the item's supplier credit policy

The system SHALL resolve each item's credit scope from its supplier and SHALL price the item using
the matrix configured for that scope. The supplier SHALL be resolved from the product's own supplier
if set, otherwise from its brand's supplier, reusing the existing supplier-resolution rule. An item
whose resolved supplier is classified as offering full credit SHALL price on the `FULL_CREDIT`
matrix; every other item SHALL price on the `NO_CREDIT` matrix.

Credit scope SHALL affect only which matrix is selected. It SHALL NOT affect the day-to-expiry band
windows, the treatment of expired stock, or whether an item is priced at all.

#### Scenario: Full-credit supplier gets the light markdown

- **GIVEN** an organization whose full-credit matrix is 20% off cost
- **AND** a supplier classified as offering full credit
- **WHEN** a markdown price is computed for one of that supplier's products 45 days from expiry with a cost of 10
- **THEN** the price is 8.00, not the no-credit band 2 price

#### Scenario: Supplier resolved through the item's brand

- **GIVEN** a product with no supplier of its own, whose brand is linked to a full-credit supplier
- **WHEN** its markdown price is computed
- **THEN** the full-credit matrix applies, resolved through the brand

#### Scenario: Product supplier takes precedence over the brand supplier

- **GIVEN** a product whose own supplier offers no credit, and whose brand is linked to a full-credit supplier
- **WHEN** its markdown price is computed
- **THEN** the no-credit matrix applies, because the product's own supplier wins

#### Scenario: Credit scope does not change the band windows

- **GIVEN** a full-credit item 95 days from expiry, and another that expired yesterday
- **WHEN** their markdown prices are computed
- **THEN** neither is priced, matching the existing behavior for out-of-window and expired stock

### Requirement: Unclassified stock still prices, using the no-credit matrix

The system SHALL price every in-window item regardless of how completely its supplier is known. An
item whose supplier is absent, whose brand is unmatched, whose brand-to-supplier link is an
unconfirmed reference suggestion, or whose supplier holds no credit policy SHALL be priced on the
`NO_CREDIT` matrix. The system SHALL NOT withhold, defer, or block a markdown because credit
information is missing.

Where the credit scope was resolved from incomplete information, the system SHALL surface a warning
alongside the price identifying what is missing, and SHALL offer the user a route to the supplier and
catalogue review surfaces to complete it.

#### Scenario: Unbranded SKU is still priced

- **GIVEN** a product with no brand and no supplier
- **WHEN** it is scanned 20 days from expiry
- **THEN** it is priced on the no-credit band 3
- **AND** a warning indicates no brand is matched, linking to catalogue review

#### Scenario: Unconfirmed supplier fails safe to no credit

- **GIVEN** a product whose brand carries an unconfirmed reference supplier suggestion that offers full credit
- **WHEN** its markdown price is computed
- **THEN** the no-credit matrix applies
- **AND** a warning indicates the supplier is unconfirmed and should be verified before pricing

#### Scenario: Supplier with no policy on file

- **GIVEN** a product whose resolved supplier has no credit policy recorded
- **WHEN** it is scanned
- **THEN** it is priced on the no-credit matrix
- **AND** a warning indicates no credit policy is on file, linking to the supplier

### Requirement: The applied credit scope is visible and not overridable at markdown time

The system SHALL display, alongside each markdown price, which credit scope was applied and the
supplier it was resolved from. This indication SHALL be read-only: the system SHALL NOT offer a
per-item or per-scan override of the resolved credit scope.

Correcting a wrong classification SHALL be done by editing the supplier's credit policy, which SHALL
then apply to every item resolving to that supplier.

#### Scenario: Scope is shown with the price

- **WHEN** an operator scans a product supplied by a full-credit supplier
- **THEN** the markdown price is shown together with an indication that the full-credit matrix applied and the supplier it came from

#### Scenario: No per-scan override is offered

- **WHEN** an operator views a resolved markdown price
- **THEN** no control is presented to change that item's credit scope for this scan

#### Scenario: Correcting the supplier corrects every item

- **GIVEN** a supplier reclassified from no credit to full credit
- **WHEN** any of its products is next priced
- **THEN** the full-credit matrix applies, with no per-item action required

### Requirement: Saving a matrix warns that stickered stock needs re-pricing

Because markdown prices are computed live and never stored, a matrix change SHALL take effect
immediately across every pricing surface for all existing stock. Before saving a changed matrix, the
system SHALL warn the user that prices update everywhere immediately and that items already
physically stickered under the previous matrix will show the new price on their worklist and need
re-stickering. The system SHALL NOT claim the change applies only to future items.

The system SHALL NOT perform any bulk update of existing items, as no per-item price is stored.

#### Scenario: Save warns before applying

- **WHEN** a user saves a changed markdown matrix
- **THEN** a confirmation explains that the new prices apply everywhere immediately and that already-stickered items will need re-stickering
- **AND** the matrix is saved only once the user confirms

#### Scenario: Existing items re-price without migration

- **GIVEN** an item currently 20 days from expiry, already stickered under the old matrix
- **WHEN** the organization changes its band 3 percentage
- **THEN** that item's price on the expiry worklist reflects the new percentage on the next view
- **AND** no per-item record was written

#### Scenario: The worklist serves as the re-sticker list

- **GIVEN** an organization that has just changed a matrix
- **WHEN** a user opens the detailed expiry report
- **THEN** every in-window item is listed at its new price, so the user can re-sticker from that list

