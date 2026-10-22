## ADDED Requirements

### Requirement: Route map of the deployed Worker

The repository SHALL provide `scripts/route-map.js`, which prints one line per entry of `MINIMAL_API_ROUTES` in `workers/src/index-minimal.ts` with the method, the path or path pattern, the handler name and the `file:line` of the handler's definition, and a test SHALL fail when any entry's handler cannot be located.

#### Scenario: Agent looks up a route

- **GIVEN** the current `workers/src/index-minimal.ts`
- **WHEN** an agent runs `npm run route-map`
- **THEN** the output contains a line for `GET /api/products` naming `handleGetProducts` and the `file:line` that declares it

#### Scenario: A handler moves out of reach

- **GIVEN** a route table entry whose handler is declared nowhere under `workers/src/`
- **WHEN** `npm run test:tooling` runs
- **THEN** the route-map test fails and names the handler

### Requirement: One-line PR feedback summary

`scripts/pr-feedback.js` SHALL accept `--summary` and then print a single line with the PR number, `settled`, `waitingOn`, the actionable count and the check counts, instead of the JSON report.

#### Scenario: PR waiting on its quiet window

- **GIVEN** a PR whose checks have passed and whose last review was two minutes ago
- **WHEN** `node scripts/pr-feedback.js <pr> --summary` runs
- **THEN** it prints one line containing `settled=false` and `waitingOn=quiet window`

### Requirement: Cleanup prints manual commands for kept branches

`scripts/cleanup-merged.js` SHALL print, after each branch or worktree it keeps, the command the owner could run to delete or inspect it, and SHALL NOT run that command itself.

#### Scenario: Branch with unverified local commits

- **GIVEN** a local branch whose upstream is gone and whose tip is in no merged PR or `origin/main`
- **WHEN** `node scripts/cleanup-merged.js` runs
- **THEN** it prints the keep reason followed by `git branch -D <branch>` as a hint
- **AND** the branch still exists afterwards
