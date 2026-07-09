## ADDED Requirements

### Requirement: Store areas form a two-level department-to-bay hierarchy

The system SHALL let an organization organize its store areas as a two-level hierarchy: a
**department** is a store area with no parent, and a **bay** is a store area whose parent is a
department. Inventory items SHALL continue to reference the bay (the leaf area) as their location.
Existing single-level store areas SHALL be preserved as bays under a department without moving any
inventory reference. The hierarchy SHALL be scoped to the organization, derived from the
authenticated context and never from a client-supplied identifier.

#### Scenario: Existing flat areas are preserved as bays

- **GIVEN** an organization with existing store areas and inventory items assigned to them
- **WHEN** the department-to-bay hierarchy is introduced
- **THEN** each existing area becomes a bay under a department
- **AND** every inventory item's location still resolves to the same area it referenced before

#### Scenario: A bay belongs to exactly one department

- **GIVEN** a department "Hair"
- **WHEN** a bay "Bay 1" is created under it
- **THEN** "Bay 1" has "Hair" as its parent
- **AND** inventory can be assigned to "Bay 1" but not to the department "Hair"

### Requirement: A store walk is tracked as a repeatable cycle

The system SHALL let an organization run repeatable **check cycles**, each representing one full
walk of the store floor. A cycle SHALL have a name, a status of active or completed, a start time,
and a completion time once finished. An organization SHALL have at most one active cycle at a time.
Cycles SHALL be org-scoped with the organization derived from the authenticated context.

#### Scenario: Only one active cycle at a time

- **GIVEN** an organization with an active check cycle
- **WHEN** it attempts to start a second cycle without completing the first
- **THEN** the request is rejected until the active cycle is completed

#### Scenario: Completing a cycle records its completion

- **GIVEN** an active check cycle
- **WHEN** the organization completes it
- **THEN** the cycle's status becomes completed and its completion time is recorded
- **AND** a new cycle may then be started

### Requirement: Checking a bay records a first-class event

The system SHALL record each bay check as an event capturing the bay, the check cycle, the user who
checked it, the time of the check, and a count of items added during that check. A bay check SHALL
require an active cycle and SHALL only be recorded against a bay (a leaf area), never a department.
Recording a bay check SHALL be independent of whether any product was added, and SHALL update the
bay's derived last-checked timestamp.

#### Scenario: A bay with no new items is still recorded as checked

- **GIVEN** an active cycle and a bay whose stock is all in date
- **WHEN** a user marks the bay as checked without adding any item
- **THEN** a bay check event is recorded for that bay, cycle, user, and time
- **AND** the bay's last-checked timestamp is updated

#### Scenario: A department cannot be checked

- **WHEN** a bay check is attempted against a department (an area with no parent)
- **THEN** the request is rejected because only leaf bays can be checked

#### Scenario: A bay check requires an active cycle

- **GIVEN** an organization with no active cycle
- **WHEN** a user attempts to check a bay
- **THEN** the request is rejected until a cycle is started

### Requirement: Floor progress shows coverage for the active cycle

The system SHALL provide a floor-progress view for the active cycle that lists bays grouped by
department, each showing whether it has been checked in the active cycle, and for checked bays the
checking user and time. Bays checked only in a prior cycle SHALL be distinguishable from bays never
checked. The view SHALL report coverage as the proportion of bays checked in the active cycle, per
department and for the whole store. Both server backends SHALL derive this state from the same shared
logic and produce identical results.

#### Scenario: Where-are-we-up-to without deduction

- **GIVEN** an active cycle in which some bays have been checked and others have not
- **WHEN** the floor-progress view is requested
- **THEN** unchecked bays are listed as not yet checked
- **AND** checked bays show the checker and time
- **AND** store and per-department coverage percentages reflect the checked proportion

#### Scenario: Prior-cycle checks are marked overdue, not current

- **GIVEN** a bay last checked in a previous, completed cycle
- **WHEN** the floor-progress view for the current active cycle is requested
- **THEN** the bay is shown as overdue rather than as checked in the current cycle

### Requirement: Audit reporting of checking productivity

The system SHALL report, per user and per cycle, the number of bays checked, coverage percentage,
bays checked per hour, and cycle completion time. The system SHALL surface a red flag when a user's
checking pace is implausibly fast or when many consecutive bay checks record zero items added, so
managers can verify checks are genuinely performed. These reports SHALL be org-scoped.

#### Scenario: Productivity metrics per user

- **GIVEN** a completed check cycle with bay checks by several users
- **WHEN** the audit report is viewed
- **THEN** each user's bays checked, coverage, and bays-per-hour are shown

#### Scenario: Implausible activity is flagged

- **GIVEN** a user whose bay checks occur faster than is physically plausible or record zero items across many bays that normally hold near-expiry stock
- **WHEN** the audit report is viewed
- **THEN** those checks are flagged for review
