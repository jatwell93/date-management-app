## ADDED Requirements

### Requirement: The factory reads a GSD project through a gsd adapter

The software-factory repo SHALL provide a `gsd` spec-source adapter that implements every method of `SpecSourceAdapter` for a project that keeps its plan in `.planning/`. A change SHALL be a phase directory under `.planning/phases/` and a task SHALL be a plan line in `.planning/ROADMAP.md`. The adapter SHALL NOT run GSD's installer or commands, and SHALL be tested against a pinned `open-gsd/gsd-core` commit.

#### Scenario: Tasks come from the roadmap

- **GIVEN** a phase with two plan lines in `ROADMAP.md`, one ticked
- **WHEN** the adapter lists the phase's tasks
- **THEN** it returns both plans in order, the ticked one with `done: true`, and `blockedBy` taken from the plan's `depends_on`

#### Scenario: Autonomy comes from a sidecar

- **GIVEN** a phase with no autonomy sidecar
- **WHEN** the adapter reads its autonomy
- **THEN** it returns `merge: human` and the documented defaults, since GSD's format has no such field

#### Scenario: The adapter passes the contract suite

- **GIVEN** the shared contract suite
- **WHEN** it runs against the `gsd` adapter
- **THEN** every case passes
