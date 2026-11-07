## ADDED Requirements

### Requirement: Worker changes are formatted with the package script before a push

When a factory task run or a review-fix pass changes files under `workers/`, the run SHALL format them with `npm run format --prefix workers` before it commits or pushes. It SHALL NOT format Worker files with an inline `npx prettier`, so the write command matches the `npm run format:check` command CI runs. The runner's `--allowedTools` list SHALL permit the command without approval.

#### Scenario: Task changes a Worker test file

- **GIVEN** a task whose diff includes `workers/src/inventory-item-handlers.test.ts`
- **WHEN** the run reaches its gate step
- **THEN** it runs `npm run format --prefix workers` before it commits
- **AND** the PR's `Check formatting` step passes without a manual fix

#### Scenario: Task changes no Worker file

- **GIVEN** a task whose diff has no file under `workers/`
- **WHEN** the run reaches its gate step
- **THEN** it does not run the Worker format command
