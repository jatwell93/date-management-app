# supplier-credit-claims Specification

## Purpose
TBD - created by archiving change add-supplier-credit-claims. Update Purpose after archive.
## Requirements
### Requirement: Suppliers carry a reusable credit policy

The system SHALL let an organization record **suppliers**, each with a name, an optional contact
email, a free-text credit-policy note, an optional structured credit ratio (units written off →
units credited), and a follow-up cadence in days. Suppliers SHALL be org-scoped with the
organization derived from the authenticated context and never from a client-supplied identifier. The
structured ratio, when present, SHALL be used to compute the expected credit for a claim; when
absent, expected credit MAY be unknown.

#### Scenario: A supplier with a 3-for-1 ratio yields expected credit

- **GIVEN** a supplier with a credit ratio of 3 units written off → 1 unit credited
- **WHEN** a claim line writes off 6 units of that supplier's product
- **THEN** the expected credit for that line is 2 units

#### Scenario: A supplier without a structured ratio has unknown expected credit

- **GIVEN** a supplier whose policy is recorded only as a free-text note
- **WHEN** a claim line is created for that supplier
- **THEN** the line records the units claimed
- **AND** the expected credit is left unknown rather than assumed

### Requirement: Products map to a supplier and the map builds through use

The system SHALL allow each product to reference at most one supplier, and SHALL allow that reference
to be unset. A product with no supplier SHALL surface in a "needs supplier" state in the claimable
pool. Assigning a supplier to a product SHALL persist for that product so future write-offs of the
same product resolve to the supplier automatically.

#### Scenario: An unassigned product appears as needs-supplier

- **GIVEN** an expired write-off for a product with no supplier assigned
- **WHEN** the claimable pool is viewed
- **THEN** the write-off appears in the "needs supplier" group, not under any supplier

#### Scenario: Assigning a supplier persists for future write-offs

- **GIVEN** a product with no supplier assigned
- **WHEN** a user assigns it to a supplier while triaging a write-off
- **THEN** the product references that supplier
- **AND** a later write-off of the same product appears under that supplier without reassignment

### Requirement: Expired write-offs form a claimable pool grouped by supplier

The system SHALL present every expired-item write-off as a candidate for a supplier credit claim,
grouped by the product's supplier, without altering how the write-off itself is recorded. A write-off
that has already been attached to a claim line SHALL NOT appear as an available candidate.

#### Scenario: A write-off becomes a claim candidate without changing the ledger

- **GIVEN** an item is marked expired and its write-off is recorded
- **WHEN** the claimable pool is viewed
- **THEN** the write-off appears as a candidate under its supplier
- **AND** the recorded write-off quantity and financial loss are unchanged

#### Scenario: An already-claimed write-off is not offered again

- **GIVEN** a write-off already attached to a claim line
- **WHEN** the claimable pool is viewed
- **THEN** that write-off does not appear as an available candidate

### Requirement: A claim batches write-offs for one supplier

The system SHALL let a user assemble a **credit claim** for a single supplier from one or more
write-offs. Each claim line SHALL reference exactly one write-off, and any given write-off SHALL be
attached to at most one claim line. Each line SHALL capture a batch number and the units claimed, and
MAY carry photos. The claim SHALL snapshot its expected credit at build time so later policy or price
changes do not alter a raised claim.

#### Scenario: A single write-off cannot be claimed twice

- **GIVEN** a write-off already attached to a claim line
- **WHEN** an attempt is made to attach the same write-off to another claim line
- **THEN** the attempt is rejected

#### Scenario: Expected credit is snapshotted at build time

- **GIVEN** a claim built while the supplier's ratio is 3 → 1
- **WHEN** the supplier's ratio is later changed
- **THEN** the previously built claim retains the expected credit computed at build time

### Requirement: Claims are sent server-side with a verified timestamp

The system SHALL send a claim to the supplier's contact email server-side, attaching the claim's
photos, and SHALL record a send timestamp only when the send succeeds. A claim SHALL only be sendable
when it has at least one line and its supplier has a contact email. Photo bytes SHALL be stored in
object storage with only their metadata and a lifecycle deletion time held in the database.

#### Scenario: A claim without a supplier email cannot be sent

- **GIVEN** a claim whose supplier has no contact email
- **WHEN** a user attempts to send the claim
- **THEN** the send is rejected and no send timestamp is recorded

#### Scenario: A successful send records the timestamp and starts the follow-up clock

- **GIVEN** a draft claim with at least one line and a supplier contact email
- **WHEN** the claim is sent and the send succeeds
- **THEN** the claim's status becomes sent, its send timestamp is recorded
- **AND** a first follow-up time is scheduled from the send time and the supplier's cadence

### Requirement: The system reminds users to follow up on unpaid claims

The system SHALL identify sent claims whose next follow-up time has passed and SHALL support sending
a follow-up, after which it advances the next follow-up time by the supplier's cadence and increments
the follow-up count. Claims that have reached a settled outcome SHALL NOT be surfaced for follow-up.

#### Scenario: An overdue sent claim is surfaced for follow-up

- **GIVEN** a sent claim whose next follow-up time has passed
- **WHEN** the follow-up-due list is produced
- **THEN** the claim appears in it

#### Scenario: Following up advances the schedule

- **GIVEN** a sent claim that is due for follow-up
- **WHEN** a follow-up is sent
- **THEN** the follow-up count increases
- **AND** the next follow-up time advances by the supplier's cadence

#### Scenario: A settled claim is no longer chased

- **GIVEN** a claim recorded as credited or rejected
- **WHEN** the follow-up-due list is produced
- **THEN** the claim does not appear in it

### Requirement: Claim outcomes are recorded and photos are lifecycle-purged

The system SHALL let a user record a claim outcome of credited, partially credited, or rejected,
capturing the credited value where applicable and a settlement time. On settlement the system SHALL
schedule deletion of the claim's photos after a retention period. Every state change SHALL append a
timeline event capturing the type, the acting user where known, and the time.

#### Scenario: Recording a credit settles the claim and schedules photo deletion

- **GIVEN** a sent claim
- **WHEN** a user records it as credited with a credited value
- **THEN** the claim's status becomes credited, its credited value and settlement time are recorded
- **AND** its photos are scheduled for deletion after the retention period

#### Scenario: Each transition is recorded on the timeline

- **GIVEN** a claim that moves from draft to sent to credited
- **WHEN** the claim timeline is viewed
- **THEN** it shows an event for each transition with its type and time

### Requirement: Recovery reporting surfaces outstanding and unclaimed credit

The system SHALL report, per organization, the total outstanding expected credit for sent-but-unsettled
claims, the recovery rate per supplier, and the value of eligible write-offs for which no claim was
ever raised. Reporting SHALL be org-scoped with the organization derived from the authenticated
context.

#### Scenario: Unclaimed eligible write-offs are surfaced as money left on the table

- **GIVEN** eligible write-offs for a supplier that were never attached to any claim
- **WHEN** the recovery report is produced
- **THEN** their value is reported as unclaimed credit

