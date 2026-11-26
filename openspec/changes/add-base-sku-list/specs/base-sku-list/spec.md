## Purpose

Give every store a ready-made starter catalogue with cost and retail prices, sized to its subscription tier, so a store can start without uploading its own POS export. The owner maintains one ranked list. Stores adopt it, top it up, and refresh its prices without losing their own edits.

## ADDED Requirements

### Requirement: The owner maintains one ranked base list

The system SHALL let the owner publish a base list as a ranked subset of the master catalogue. Each listed entry carries a cost price, a retail price, a department, a category, and a unique positive integer rank. Entries without a rank SHALL NOT be part of the base list. Publishing SHALL be an operator action, not a tenant action, and tenants SHALL never write the list.

#### Scenario: A sheet with duplicate ranks is rejected

- **GIVEN** a sheet in which two entries share rank 7
- **WHEN** the owner publishes it
- **THEN** the publish fails with a row-level error naming both rows
- **AND** nothing is written

#### Scenario: A dry run shows the diff without writing

- **GIVEN** a valid refreshed sheet
- **WHEN** the owner publishes it as a dry run
- **THEN** the report shows entries added, changed and retired
- **AND** the database is unchanged

#### Scenario: A refresh that would retire too much is refused

- **GIVEN** a sheet that would retire more than the retirement threshold of the active catalogue
- **WHEN** the owner publishes it without explicit confirmation
- **THEN** the publish is refused and nothing is written

#### Scenario: A retired entry leaves the list

- **GIVEN** a ranked entry that the new sheet no longer lists
- **WHEN** the owner publishes the sheet
- **THEN** the entry is retired, not deleted
- **AND** it is excluded from adoption, top-up and sync

### Requirement: A tier's allowance is the top of the ranked list

The system SHALL treat a store's base-list allowance as the lowest-ranked entries up to its tier's SKU limit: 500 for Free, 5,000 for Starter and 50,000 for Professional. Higher tiers receive the whole list. The allowance SHALL be resolved from the organization's current tier on the server, never from client input.

#### Scenario: A free store sees only the top 500

- **GIVEN** a base list of 50,000 ranked entries and a Free-tier organization
- **WHEN** the store asks what it can import
- **THEN** only entries ranked 1 to 500 are offered

#### Scenario: Clients cannot widen the allowance

- **GIVEN** a Free-tier organization
- **WHEN** a request supplies a tier, limit or organization identifier in its payload
- **THEN** the payload value is ignored and the allowance comes from the authenticated organization's tier

### Requirement: A store can adopt the base list with one supplier

The system SHALL let an organization's admin or manager adopt the base list instead of uploading its own, choosing exactly one supplier from API, Sigma or CH2. Adoption SHALL create one product per allowed, active entry with the chosen supplier's SKU, the list cost, the list retail price, the barcode, the name and the catalogue's brand, and SHALL record the supplier on the organization. Adoption SHALL be repeatable without duplicates.

#### Scenario: Adopting prefills the catalogue

- **GIVEN** a Free-tier organization with no products
- **WHEN** an admin adopts the base list with supplier Sigma
- **THEN** products exist for the allowed entries that have a Sigma SKU
- **AND** each product's SKU is its Sigma SKU, with the list cost and retail price
- **AND** the organization records Sigma as its base-list supplier

#### Scenario: Entries without the chosen supplier's SKU are skipped and counted

- **GIVEN** an allowed entry with no CH2 SKU
- **WHEN** an organization adopts the base list with supplier CH2
- **THEN** that entry is not imported and does not count toward the SKU limit
- **AND** the result reports how many entries were skipped for lacking a CH2 code

#### Scenario: Adoption never exceeds the SKU limit

- **GIVEN** a Free-tier organization already holding 480 products
- **WHEN** it adopts the base list
- **THEN** at most 20 further products are created
- **AND** the result reports that the limit was reached

#### Scenario: Re-running adoption does not duplicate

- **GIVEN** an organization that already adopted the base list
- **WHEN** adoption runs again with the same supplier
- **THEN** no product is duplicated and existing products are not changed

#### Scenario: Existing products win over the list

- **GIVEN** an organization with its own product for barcode 9321299800449
- **WHEN** it adopts the base list containing that barcode
- **THEN** the store's own product is kept unchanged
- **AND** no second product is created

#### Scenario: Team members cannot adopt

- **GIVEN** a user whose role is team member
- **WHEN** they request adoption
- **THEN** the request is refused with a permission error and nothing is written

#### Scenario: The organization comes from the session

- **GIVEN** an admin of organization A who sends organization B's identifier in the request
- **WHEN** adoption runs
- **THEN** only organization A's products are created and organization B is untouched

### Requirement: Adoption is a choice, not a requirement

The system SHALL offer a store with no products the choice between adopting the base list and uploading its own POS export. Choosing to upload SHALL leave the existing upload flow unchanged, and the store SHALL remain able to adopt the base list later.

#### Scenario: A store uploads its own list instead

- **GIVEN** a new organization at the first-run choice
- **WHEN** the admin chooses to upload their own list
- **THEN** the existing upload flow starts and no base-list products are created

### Requirement: A store can top up from the base list within its limit

The system SHALL let an admin or manager add allowed base-list products that the store does not yet hold, up to the tier's SKU limit, using the supplier already recorded for the organization. Top-up SHALL work for stores that began with their own list. Top-up SHALL never delete or change existing products.

#### Scenario: An upgrade makes more of the list available

- **GIVEN** a store that adopted the list on Free and upgrades to Starter
- **WHEN** an admin tops up
- **THEN** products for entries ranked 501 to 5,000 are added
- **AND** the first 500 products are unchanged

#### Scenario: A store that began with its own list tops up

- **GIVEN** an organization with its own 200 products and no recorded base-list supplier
- **WHEN** an admin tops up and chooses a supplier
- **THEN** allowed entries not already present are added up to the limit
- **AND** the chosen supplier is recorded

### Requirement: Price sync updates only untouched prices

The system SHALL tell a store when the base list has newer prices than the ones it last imported. On request by an admin or manager, the system SHALL update the cost and retail prices of base-list products whose prices still equal what was last imported from the list. Prices the store has edited SHALL NOT be changed. The result SHALL report how many products were updated, how many were skipped because the store edited them, and how many entries have since been retired.

#### Scenario: An untouched price follows the list

- **GIVEN** a base-list product whose cost still equals its last-imported list cost
- **WHEN** the owner raises that entry's cost and the store syncs
- **THEN** the product's cost becomes the new list cost

#### Scenario: An edited price is kept

- **GIVEN** a base-list product whose cost the store changed after import
- **WHEN** the store syncs
- **THEN** the product's cost is unchanged
- **AND** it is counted as skipped because the store edited it

#### Scenario: A retired entry leaves the store's product alone

- **GIVEN** a base-list product whose entry the owner has since retired
- **WHEN** the store syncs
- **THEN** the product is kept and unchanged, and counted as retired

### Requirement: A store over its limit is frozen, not purged

The system SHALL never delete products because of a tier change. When an organization holds more products than its tier allows, the system SHALL lock the excess base-list products, highest rank first, and exclude them from product lookup and new-expiry entry. Products the store uploaded or created itself SHALL never be locked. Locks SHALL clear when the store upgrades or falls back under its limit.

#### Scenario: A downgrade locks the excess list products

- **GIVEN** a Professional store holding 20,000 base-list products
- **WHEN** it downgrades to Free
- **THEN** all 20,000 products remain stored
- **AND** all but the 500 lowest-ranked are locked and cannot be found when adding an expiry

#### Scenario: Own products are never locked

- **GIVEN** a downgraded store with 300 own products and 2,000 base-list products
- **WHEN** locks are reconciled for the Free limit
- **THEN** none of the 300 own products is locked
- **AND** only 200 base-list products remain unlocked

#### Scenario: Upgrading clears the lock

- **GIVEN** a downgraded store with locked products
- **WHEN** it upgrades to a tier whose limit covers them
- **THEN** the locks are cleared and the products are available again

### Requirement: A frozen store keeps its history and cannot grow

While an organization is over its limit, existing expiry records for locked products SHALL remain visible and unchanged, and adoption, top-up and sync SHALL be refused with a message that the store is over its plan.

#### Scenario: Growth actions are refused while over the limit

- **GIVEN** an organization above its tier's SKU limit
- **WHEN** an admin attempts adoption, top-up or sync
- **THEN** the request is refused with an over-plan message and nothing is written

#### Scenario: Existing expiries on locked products stay visible

- **GIVEN** a locked product with three active expiry items
- **WHEN** the store views its expiries
- **THEN** all three items are still shown and unchanged
