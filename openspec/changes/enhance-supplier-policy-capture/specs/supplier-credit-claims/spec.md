## MODIFIED Requirements

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

## ADDED Requirements

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
multiple brands in a single action, applying immediately within the organization. Bulk-attach SHALL
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
already linked to the target brand SHALL be reported as no-ops.

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
