## ADDED Requirements

### Requirement: Daily usage report names its users

The daily usage report API SHALL return, with each row, the display name of the user who made the changes (their username, else their email), taken only from users in the caller's organisation, and the usage report page SHALL show that name in the daily activity data on every viewport (the desktop table and the mobile summary list), falling back to `Unknown user <id>` when there is none.

#### Scenario: Manager reads the daily activity table

- **GIVEN** a user `alice` in the caller's organisation who created items yesterday
- **WHEN** the manager opens the usage report
- **THEN** the daily activity row for yesterday shows `alice`, not her numeric id

#### Scenario: Manager reads the report on a phone

- **GIVEN** the same row for `alice`
- **WHEN** the manager opens the usage report on a small screen, where the mobile summary list replaces the table
- **THEN** that row's card shows `alice`

#### Scenario: Audit row points at a user in another organisation

- **GIVEN** an audit row in organisation A whose `user_id` belongs to a user in organisation B
- **WHEN** organisation A requests `GET /api/reports/daily-usage`
- **THEN** that row's `user_name` is null
- **AND** no name from organisation B appears in the response

#### Scenario: User without a name

- **GIVEN** a daily usage row whose `user_name` is null
- **WHEN** the page renders it
- **THEN** the "User" column shows `Unknown user <id>`
