## ADDED Requirements

### Requirement: Worker API request bodies use camelCase field names only

The Worker API SHALL read request body fields by their camelCase names only. A handler SHALL NOT read a snake_case alias of a field (for example `product_id` for `productId`), and SHALL NOT log a deprecation warning for one. A snake_case field in a request body SHALL be ignored, so a request that supplies a required field only in snake_case SHALL fail the same validation as a request that omits it. This applies to inventory item create, store walk check create, and store area create and update.

#### Scenario: Inventory item with snake_case fields only

- **GIVEN** an authenticated request to create an inventory item
- **AND** the body is `{ "product_id": 1, "expiry_date": "2026-12-31", "location_id": 1 }`
- **WHEN** the Worker handles it
- **THEN** the response is 400 with `Missing or invalid productId`
- **AND** no inventory item is created

#### Scenario: camelCase beside snake_case

- **GIVEN** an authenticated request to create an inventory item
- **AND** the body has valid `productId`, `expiryDate` and `locationId`, plus `product_id: 999`
- **WHEN** the Worker handles it
- **THEN** the item is created for `productId`, not 999

#### Scenario: Store area with snake_case parent

- **GIVEN** an authenticated request to create a store area
- **AND** the body is `{ "name": "Front", "parent_id": 5 }`
- **WHEN** the Worker handles it
- **THEN** the area is created with no parent
