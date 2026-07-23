# supplier-credit-claims Specification

## Purpose
TBD - created by archiving change add-supplier-credit-claims. Update Purpose after archive.
## Requirements
### Requirement: Suppliers carry a reusable credit policy

The system SHALL let an organization record **suppliers**, each with a name, an optional claim-send
contact email, an optional contact phone, a free-text **store-instructions** credit policy that
supports simple markdown (bullet points and line breaks), an optional in-store **representative** name
and email, an optional structured credit ratio (units written off → units credited e.g. 3 write-offs for 1 credit back or a 1 to 1 swap), and a follow-up
cadence in days. Suppliers SHALL be org-scoped with the organization derived from the authenticated
context and never from a client-supplied identifier. The structured ratio, when present, SHALL be used
to compute the expected credit for a claim; when absent, expected credit MAY be unknown.

Creating a supplier SHALL NOT require any policy content: a supplier MAY be created with only a name
and optional contact so that onboarding and just-in-time triage complete without policy entry. When a
write authors or edits policy content, the system SHALL require non-empty store instructions **and**
at least one contact method among contact email, contact phone, or representative email, and SHALL
reject the write otherwise. The contact email SHALL serve one purpose only — the address to which
claims are sent — and SHALL remain the sole such address. The representative name and email SHALL
identify the in-store human contact for advisory reference and SHALL NOT be used to send claims
automatically, even when no claim-send contact email is set. Markdown store instructions SHALL be
rendered without allowing raw HTML injection.

The system SHALL maintain a policy-updated timestamp that changes only when a supplier's policy
content — store instructions, ratio, cadence, or representative fields — changes, and SHALL leave that
timestamp unchanged for non-policy edits such as a brand relinking to the supplier.
Partial supplier edits SHALL preserve omitted fields. Existing full replacement updates SHALL remain
supported. Policy validation failures SHALL return structured field details with status 422, while
authorization failures SHALL return 403. Admins SHALL have an explicit operation to clear policy
content without clearing supplier contact fields.

#### Scenario: A supplier with a 3-for-1 ratio yields expected credit

- **GIVEN** a supplier with a credit ratio of 3 units written off → 1 unit credited
- **WHEN** a claim line writes off 6 units of that supplier's product
- **THEN** the expected credit for that line is 2 units

#### Scenario: A supplier without a structured ratio has unknown expected credit

- **GIVEN** a supplier whose policy is recorded only as free-text store instructions
- **WHEN** a claim line is created for that supplier
- **THEN** the line records the units claimed
- **AND** the expected credit is left unknown rather than assumed

#### Scenario: A supplier can be created with no policy

- **GIVEN** a user creating a supplier with only a name during triage
- **WHEN** the supplier is saved
- **THEN** the supplier is created with no store instructions and no representative
- **AND** no policy validation is applied

#### Scenario: Authoring policy requires instructions and a contact method

- **GIVEN** a user editing a supplier to add store instructions
- **WHEN** the instructions are provided but no contact email, contact phone, or representative email is present
- **THEN** the write is rejected as invalid

#### Scenario: The representative email is not used to send claims

- **GIVEN** a supplier with a representative email but no claim-send contact email
- **WHEN** a user attempts to send a claim to that supplier
- **THEN** the send is rejected for lack of a claim-send contact email
- **AND** the representative email is not used as the send address

#### Scenario: The policy timestamp changes only on policy edits

- **GIVEN** a supplier whose policy was last updated at a recorded time
- **WHEN** a brand is relinked to that supplier without changing any policy field
- **THEN** the policy-updated timestamp is unchanged
- **AND** editing the store instructions later advances the policy-updated timestamp

#### Scenario: An unchanged policy payload is a non-policy edit

- **GIVEN** a supplier with normalized policy content
- **WHEN** a non-admin submits the same effective policy values with different incidental whitespace
- **THEN** the write does not require admin rights or policy validation
- **AND** the policy-updated timestamp is unchanged

#### Scenario: An admin explicitly clears a policy

- **GIVEN** a supplier with policy content and supplier contact fields
- **WHEN** an admin clears the policy
- **THEN** instructions, ratio, and representative fields are cleared and cadence resets to 7
- **AND** supplier contact fields remain unchanged

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

### Requirement: Editing supplier policy is restricted to organization admins

The system SHALL authorize writes that set or change a supplier's policy content — store instructions,
credit ratio, follow-up cadence, or representative fields — only for users holding the organization
`admin` role, and SHALL reject such writes from non-admins by failing closed. Non-policy supplier
writes, such as creating a bare supplier or changing its claim-send contact, SHALL remain available to
existing roles. All users within the organization SHALL be able to read a supplier's policy and
representative details.

#### Scenario: A non-admin cannot edit policy

- **GIVEN** a non-admin user in an organization
- **WHEN** the user submits a supplier write that changes the store instructions
- **THEN** the write is rejected as forbidden
- **AND** the store instructions are not changed

#### Scenario: An admin can edit policy

- **GIVEN** an admin user and an existing supplier
- **WHEN** the admin updates the store instructions with a valid contact method present
- **THEN** the store instructions are saved
- **AND** the policy-updated timestamp advances

#### Scenario: A non-admin may still create a bare supplier

- **GIVEN** a non-admin user triaging a write-off
- **WHEN** the user creates a supplier with only a name and a claim-send contact email
- **THEN** the supplier is created without requiring admin rights

### Requirement: A policy review dashboard surfaces per-brand policy coverage

The system SHALL provide an org-scoped read that lists brands with their resolved supplier, a policy
status of attached or missing determined by whether the resolved supplier has store instructions, the
policy-updated timestamp, and the representative name. The read SHALL support filtering by brand,
supplier, and policy status, and SHALL support sorting by policy-updated time oldest first so stale or
missing policies can be prioritized. An admin SHALL be able to attach one existing supplier's policy to
multiple brands in a single action and SHALL be able to create a new policy-bearing supplier before
attaching it to those selected brands. The create flow SHALL use the same supplier policy validation
and authorization as other supplier creation. Bulk-attach SHALL
require the chosen supplier to already have store instructions and SHALL reject an attempt to attach a
supplier that has none. Bulk-attach SHALL apply atomically — every selected brand is attached or none
is — and SHALL return a summary of how many brands were attached. Rows SHALL be ordered
deterministically with null policy timestamps first, then timestamp, brand name, and brand ID. Bulk ID
arrays SHALL contain 1–500 raw positive IDs and SHALL be deduplicated only after the raw cap is
enforced.

#### Scenario: A brand whose supplier has no instructions shows missing policy

- **GIVEN** a brand resolving to a supplier with empty store instructions
- **WHEN** the policy review dashboard is produced
- **THEN** the brand's policy status is missing

#### Scenario: Filtering by missing policy prioritizes gaps

- **GIVEN** brands with a mix of attached and missing policies
- **WHEN** the dashboard is filtered to missing policy and sorted oldest first
- **THEN** only brands whose resolved supplier lacks store instructions are listed
- **AND** they are ordered with the oldest policy-updated time first

#### Scenario: Bulk-attaching a policy applies to every selected brand

- **GIVEN** an admin, several brands, and an existing supplier that has store instructions
- **WHEN** the admin bulk-attaches that supplier to the selected brands
- **THEN** each selected brand resolves to that supplier within the organization
- **AND** each attachment is recorded as a correction for central review

#### Scenario: Bulk-attaching a supplier with no instructions is rejected

- **GIVEN** an admin, several brands, and an existing supplier whose store instructions are empty
- **WHEN** the admin attempts to bulk-attach that supplier to the selected brands
- **THEN** the request is rejected as invalid
- **AND** none of the selected brands are changed

#### Scenario: Creating a supplier and attaching it to selected brands

- **GIVEN** an admin has selected several brands and no suitable supplier exists
- **WHEN** the admin creates a valid policy-bearing supplier and continues the attach action
- **THEN** the new supplier is created through the standard supplier policy rules
- **AND** every selected brand is atomically attached to that supplier

#### Scenario: Attachment failure after supplier creation is recoverable

- **GIVEN** a valid supplier has been created from the bulk-attach workflow
- **WHEN** the subsequent atomic brand attachment fails
- **THEN** none of the selected brands are changed
- **AND** the created supplier remains selected so the admin can retry without re-entering it

### Requirement: A SKU matching view highlights unmatched SKUs and supports bulk-link

The system SHALL present a SKU-level matching view listing each product's SKU, product name, brand
match state, supplier-policy attached-or-missing state, and last-updated time, grouped by brand, with
unmatched SKUs visually distinguished. The view SHALL let a user manually link a single unmatched SKU
to a brand and SHALL let a user link many unmatched SKUs to one brand in a single action. Bulk-link
SHALL apply immediately within the organization and SHALL record a correction per linked SKU.
Bulk-link SHALL apply atomically, SHALL bound the number of items accepted in a single request and
reject an oversized request, and SHALL return a summary reporting how many products were newly linked
versus already linked rather than failing when some selected products already reference the brand.
The request SHALL identify exactly one existing brand ID or new brand name. If any selected product is
linked to a different brand, the system SHALL return 409 and roll back the entire request; products
already linked to the target brand SHALL be reported as no-ops. The view SHALL use server-backed
numbered pagination with filtered totals rather than append-only loading. It SHALL support a
case-insensitive product-name filter with `starts with` and `contains` modes and product-name A-Z and
Z-A ordering. Equal product names SHALL use product ID as a deterministic tie-breaker. Existing cursor
callers SHALL remain compatible.

#### Scenario: Unmatched SKUs are distinguished

- **GIVEN** a product with no brand assigned
- **WHEN** the SKU matching view is produced
- **THEN** that product appears as unmatched and is visually distinguished from matched products

#### Scenario: Bulk-linking SKUs to a brand applies and records corrections

- **GIVEN** an organization with fifty unmatched SKUs
- **WHEN** a user bulk-links all fifty to a single brand
- **THEN** each product references that brand within the organization
- **AND** one brand-added correction is recorded per linked SKU

#### Scenario: Bulk-link is org-scoped

- **GIVEN** unmatched SKUs in two organizations
- **WHEN** a user in one organization bulk-links its SKUs to a brand
- **THEN** only that organization's products are linked
- **AND** the other organization's products are unchanged

#### Scenario: Bulk-link reports already-linked products instead of failing

- **GIVEN** a selection of SKUs where some already reference the target brand
- **WHEN** the user bulk-links the selection
- **THEN** the newly linked products are linked
- **AND** the response reports the already-linked products as skipped rather than rejecting the request

#### Scenario: An oversized bulk-link request is rejected

- **GIVEN** a bulk-link request whose product count exceeds the accepted batch limit
- **WHEN** the request is submitted
- **THEN** it is rejected as invalid
- **AND** no products are linked

#### Scenario: Numbered pagination describes the filtered catalogue

- **GIVEN** an organization catalogue containing more products than one configured page
- **WHEN** the user opens a numbered catalogue page
- **THEN** only that page's rows are returned
- **AND** the response reports the filtered total item and page counts
- **AND** first, previous, numbered, next, and last navigation reflects those counts

#### Scenario: Product titles are filtered and ordered server-side

- **GIVEN** catalogue product names with mixed case and duplicate titles
- **WHEN** the user chooses `starts with` or `contains`, enters title text, and chooses A-Z or Z-A
- **THEN** matching is case-insensitive and applied before pagination
- **AND** rows are ordered by product name in the requested direction and then product ID ascending

#### Scenario: A filter change cannot leave hidden bulk selections

- **GIVEN** the user has selected SKU rows across numbered pages
- **WHEN** the user changes the title, match mode, ordering, catalogue state, or page size
- **THEN** the view returns to page 1
- **AND** selections hidden by the new result set are cleared

