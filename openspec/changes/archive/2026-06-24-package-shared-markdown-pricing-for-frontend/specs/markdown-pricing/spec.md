## ADDED Requirements

### Requirement: Frontend markdown pricing uses the shared discount ladder

The frontend SHALL derive markdown discount percentages and cost-based markdown prices from the
shared markdown pricing domain so frontend, backend, and worker-adjacent pricing logic cannot drift
into separate 75/60/50 ladder definitions.

#### Scenario: Frontend delegates to shared pricing

- **GIVEN** `shared/domain/markdown.ts` defines the canonical markdown discount ladder
- **WHEN** frontend code calls `calculateMarkdownPercentage` or `calculateMarkdownPrice`
- **THEN** the result is derived from the shared ladder rather than a separate hardcoded ladder in
  `frontend/src/lib/utils.ts`

#### Scenario: Frontend production build accepts the shared import

- **GIVEN** the frontend utility imports shared markdown pricing code
- **WHEN** the CRACO production build runs
- **THEN** the build succeeds without violating CRA module scope constraints

#### Scenario: Display rounding remains separate

- **GIVEN** a cost that produces a fractional markdown price
- **WHEN** the shared markdown price helper returns the calculated value
- **THEN** it preserves the raw arithmetic result
- **AND** currency/display components remain responsible for rounding or formatting
