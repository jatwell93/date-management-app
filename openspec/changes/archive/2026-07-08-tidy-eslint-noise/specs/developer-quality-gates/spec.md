## ADDED Requirements

### Requirement: Actionable lint output

Root and package lint commands SHALL report diagnostics for application source, tests, and maintained project scripts without including local AI/tooling reference artifacts that are not part of runtime or CI quality gates.

#### Scenario: Root lint excludes local reference tooling

- **WHEN** a developer runs `npm run lint` from the repository root
- **THEN** lint diagnostics exclude local reference folders such as `.windsurf`
- **AND** remaining diagnostics come from maintained project source, tests, scripts, or configuration.

#### Scenario: Package lint warnings are intentionally handled

- **WHEN** a developer runs frontend or backend package lint
- **THEN** fixable warnings are removed
- **AND** any remaining warning suppression is local to the line or file that requires it with a reason.
