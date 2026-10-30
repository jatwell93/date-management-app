## ADDED Requirements

### Requirement: A finished per-change PR is titled after its change

When the route job marks a finished `pr: per-change` PR ready for review, it SHALL replace the PR's title with the conventional prefix of the current title (`type(scope):`, without `WIP:`), the change's proposal heading and `(<change-id>)`. GitHub uses that title for the squash commit, so the commit on `main` SHALL name the change rather than its first task. The route job SHALL read the heading from the archived `proposal.md` on the PR branch. If the current title has no conventional prefix, or the heading cannot be read, the route job SHALL only drop `WIP:`. Per-task PRs SHALL keep their task titles.

#### Scenario: Finished PR retitled

- **GIVEN** a `WIP:` `pr: per-change` PR titled `WIP: docs(openspec): start the tickets proof file (factory-tickets-proof 1.1)`
- **AND** its branch holds the archived change, whose proposal heading is `# Proposal: Prove tickets to archive`
- **WHEN** the route job marks it ready
- **THEN** the PR is titled `docs(openspec): prove tickets to archive (factory-tickets-proof)`

#### Scenario: Proposal heading unreadable

- **GIVEN** a finished `WIP:` `pr: per-change` PR whose archived `proposal.md` cannot be read from the branch
- **WHEN** the route job marks it ready
- **THEN** the PR keeps its title with `WIP:` dropped
