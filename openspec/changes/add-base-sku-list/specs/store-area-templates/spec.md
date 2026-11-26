## Purpose

Let a store set up its floor layout quickly by starting from the base list's departments instead of typing every department by hand. The store reviews and edits the suggestions before anything is created.

## ADDED Requirements

### Requirement: The base list offers department templates

The system SHALL offer an admin or manager a list of department names derived from the active base-list entries within the organization's tier allowance, each with the number of entries it covers. The offer SHALL be optional and available any time after login from the store-areas page. The allowance and the organization SHALL come from the authenticated context.

#### Scenario: A free store is offered only departments in its allowance

- **GIVEN** a Free-tier organization and a department that appears only in entries ranked above 500
- **WHEN** the store opens the department templates
- **THEN** that department is not offered

#### Scenario: Templates are available without having adopted the list

- **GIVEN** an organization that uploaded its own products
- **WHEN** an admin opens the department templates
- **THEN** the template departments are offered

#### Scenario: Team members cannot create from templates

- **GIVEN** a user whose role is team member
- **WHEN** they submit a template selection
- **THEN** the request is refused and no area is created

### Requirement: Templates are editable before creation

The system SHALL let the user rename, remove or add department names in the checklist before confirming. Confirming SHALL create one top-level department store area per accepted name, using the names as edited. Bays under those departments SHALL be added afterwards through the existing bay feature.

#### Scenario: A renamed department is created as edited

- **GIVEN** the template "Cold and flu" renamed to "Cold and flu - front"
- **WHEN** the user confirms
- **THEN** a department named "Cold and flu - front" exists with no parent

#### Scenario: Unticked departments are not created

- **GIVEN** a checklist of 12 departments with 4 unticked
- **WHEN** the user confirms
- **THEN** exactly 8 departments are created

### Requirement: Template creation never duplicates or overwrites

The system SHALL skip any accepted name that matches an existing department of the organization, ignoring case and surrounding whitespace, and SHALL report the skipped names. Creation SHALL NOT modify or delete existing store areas, and SHALL be safe to repeat. It SHALL reject blank names and names beyond the allowed length.

#### Scenario: An existing department is skipped

- **GIVEN** an organization that already has a department "Analgesics"
- **WHEN** it confirms a selection containing "analgesics "
- **THEN** no second department is created
- **AND** the result lists the name as skipped

#### Scenario: A repeated confirmation is a no-op

- **GIVEN** a selection already created once
- **WHEN** the same selection is confirmed again
- **THEN** no area is created and every name is reported as skipped

#### Scenario: Another organization's areas are unaffected

- **GIVEN** organizations A and B, where B already has a department "Dental"
- **WHEN** A confirms a selection containing "Dental"
- **THEN** A gets its own "Dental" department and B's areas are unchanged
