# Delta for Reporting UI

## ADDED Requirements

### Requirement: Expiry Summary Counts Display
The system SHALL display accurate expiry summary counts in the reporting UI.

#### Scenario: View expiry summary counts
- GIVEN a user is viewing the reports page
- WHEN the page loads
- THEN the system displays the correct expiry risk count
- AND the system displays the correct next month markdown count
- AND the system displays the correct active future stock count

### Requirement: Stale Payload Handling
The system SHALL handle stale payloads gracefully in the reporting UI.

#### Scenario: Handle stale overall payloads
- GIVEN the system detects a stale payload
- WHEN the user attempts to view reports
- THEN the system fetches fresh data
- AND displays the updated information

### Requirement: Total Markdown Removal
The system SHALL remove the monthly Total Markdown display from the reporting UI.

#### Scenario: Total Markdown not displayed
- GIVEN a user is viewing the reports page
- WHEN the page loads
- THEN the system does not display the Total Markdown section