## ADDED Requirements

### Requirement: The owner's ready label starts a change

The factory SHALL start a change's first unchecked task when the owner adds the label `factory:ready` to the change's tracking issue (the open issue labelled `factory:<change-id>`), as a `workflow_dispatch` with that change id does. It SHALL ignore the label when anyone other than the owner adds it, when the issue has no `factory:<change-id>` label, when the issue has `needs-human` or `factory-retry`, and when the change already has an open factory PR.

#### Scenario: Owner approves the plan

- **GIVEN** a change with a tracking issue and no open factory PR
- **WHEN** the owner adds `factory:ready` to the tracking issue
- **THEN** a run starts the change's first unchecked task

#### Scenario: Someone else adds the label

- **GIVEN** a change with a tracking issue
- **WHEN** an account other than the owner adds `factory:ready`
- **THEN** the router routes to nothing and no Claude run starts

### Requirement: The factory archives a finished change

When a change has no unchecked task left, the factory SHALL archive it before handing it to the owner: reconcile the change's spec deltas with `openspec/specs/` and with what its tasks built, pass `openspec validate`, and run `openspec archive`. On a `pr: per-change` change it SHALL commit the archive on the open PR's branch before the PR is marked ready. On a per-task change it SHALL open one archive PR. The archive PR SHALL close the tracking issue on merge. A failed validation SHALL escalate with `needs-human`.

#### Scenario: Per-change PR finishes its last task

- **GIVEN** a `pr: per-change` PR, settled, with every task ticked in the branch's `tasks.md`
- **WHEN** a run reaches it
- **THEN** the run commits the archived change on the PR branch
- **AND** only then is `WIP:` dropped and the owner mentioned

#### Scenario: Spec delta fails validation

- **GIVEN** a finished change whose spec delta fails `openspec validate`
- **WHEN** the archive run starts
- **THEN** it escalates with `needs-human` on the tracking issue and pushes nothing

### Requirement: A merged task closes its ticket

When a task line in `tasks.md` carries an issue number, the factory PR that lands the task SHALL reference it with `Closes #<n>`, so the owner's merge closes the ticket.

#### Scenario: Task with a ticket merges

- **GIVEN** task `1.2 ... (#812)` landed by a factory PR
- **WHEN** the owner merges the PR
- **THEN** issue #812 is closed
