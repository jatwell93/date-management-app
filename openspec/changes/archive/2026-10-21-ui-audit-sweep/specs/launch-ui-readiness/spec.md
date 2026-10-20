## ADDED Requirements

### Requirement: Every routed view passes a technical UI quality audit
Each routed frontend view and the app shell SHALL be audited with `/impeccable:audit` against the
design context in `.impeccable.md`, and all reported P0-P3 findings SHALL be fixed or recorded as
explicitly deferred with a reason in the view's pull request.

#### Scenario: A view audit finds an accessibility defect
- **WHEN** the audit of a view reports a WCAG AA failure such as an unlabeled input or low contrast
- **THEN** the view's pull request SHALL fix the defect
- **AND** SHALL add or adjust a test that covers the fixed behavior where it is testable in jsdom

#### Scenario: A view audit finds a defect in shared code
- **WHEN** a finding is located in shared code outside the view's own files
- **THEN** the view's pull request SHALL NOT change that shared code
- **AND** the finding SHALL be fixed in the shell pull request
