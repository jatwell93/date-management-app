## MODIFIED Requirements

### Requirement: Floor progress shows coverage for the active cycle

The system SHALL provide a floor-progress view for the active cycle that lists bays grouped by
department, each showing whether it has been checked in the active cycle, and for checked bays the
checking user and time. Bays checked only in a prior cycle SHALL be distinguishable from bays never
checked. The view SHALL report coverage as the proportion of bays checked in the active cycle, per
department and for the whole store. The Worker SHALL derive this state from the shared
logic.

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
