## ADDED Requirements

### Requirement: Suppliers are classified by the credit they return

The system SHALL let an organization classify each supplier by the credit it returns for expired
stock, as exactly one of: no credit, or full credit (the full cost recovered, whether by rebate or
stock swap). Suppliers SHALL default to no credit, so suppliers recorded before this classification
existed are unclassified until a user sets them.

The classification SHALL be a policy field: writing it SHALL require the organization admin role,
SHALL stamp the supplier's policy-updated timestamp, and SHALL be visible read-only to non-admins,
consistent with the other supplier policy fields. It SHALL be settable through the existing supplier
create and update operations, with no separate endpoint.

The classification SHALL be independent of the structured credit ratio: a supplier MAY be classified
as full credit with no ratio recorded, and MAY have a ratio recorded while classified as no credit.

#### Scenario: Existing suppliers default to no credit

- **GIVEN** suppliers recorded before this change
- **WHEN** their credit classification is read
- **THEN** each is no credit, and no supplier behavior changes until a user classifies it

#### Scenario: An admin classifies a supplier as full credit

- **GIVEN** an organization admin editing a supplier
- **WHEN** they classify it as offering full credit and save
- **THEN** the classification persists
- **AND** the supplier's policy-updated timestamp is stamped

#### Scenario: A non-admin cannot change the classification

- **GIVEN** a user without the admin role
- **WHEN** they attempt to change a supplier's credit classification
- **THEN** the request is rejected as forbidden
- **AND** the stored classification is unchanged and the field is not silently dropped

#### Scenario: A non-admin can see the classification

- **GIVEN** a user without the admin role viewing a supplier
- **WHEN** the supplier record is displayed
- **THEN** the credit classification is shown read-only alongside the other policy fields

#### Scenario: Classification is independent of the credit ratio

- **GIVEN** a supplier classified as full credit whose structured ratio is not recorded
- **WHEN** a claim line is created for that supplier
- **THEN** the expected credit is left unknown, exactly as before
- **AND** the supplier is still treated as full credit for markdown pricing

#### Scenario: Classifying a supplier is a policy write

- **GIVEN** a supplier whose only change in a request is its credit classification
- **WHEN** the request is saved
- **THEN** it is treated as a policy write for authorization, validation, and timestamping
