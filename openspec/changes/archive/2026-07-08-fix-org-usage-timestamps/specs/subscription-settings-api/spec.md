# Delta for Subscription Settings API

## ADDED Requirements

### Requirement: Organization Usage Timestamp Fix
The system SHALL properly handle timestamps for organization usage records.

#### Scenario: Create organization usage with valid timestamp
- GIVEN a user is creating an organization usage record
- WHEN the user submits the record
- THEN the system creates the record with a valid timestamp
- AND the timestamp is in the correct format

#### Scenario: Worker handles timestamp-safe organization usage creation
- GIVEN a Worker is processing an organization usage creation request
- WHEN the request includes timestamp data
- THEN the Worker properly handles the timestamp
- AND creates the usage record without errors