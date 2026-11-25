# Proposal: Title a finished per-change PR after its change

## Why

A `pr: per-change` PR takes its title from its first task, because the first task run opens it. When the change is finished, the route job only drops `WIP:` from that title. GitHub uses the PR title for the squash commit, so `main` records the whole change under its first task's name. Live proof #756 landed tasks 1.1 and 1.2 and the archive, but `main` reads "docs(openspec): start the tickets proof file (factory-tickets-proof 1.1)" (5aecb915).

## What changes

- When the route job marks a finished per-change PR ready (`markReady`, `scripts/factory-route.js`), it replaces the title instead of only stripping `WIP:`. The new title keeps the conventional prefix (`type(scope):`) of the current title, followed by the change's proposal heading (`# Proposal: <name>`), lowercased at the first letter, and then `(<change-id>)`. Example: `docs(openspec): prove tickets to archive (factory-tickets-proof)`.
- The heading is read from the PR branch, where the archive run has already moved the proposal to `openspec/changes/archive/<date>-<id>/proposal.md`. It is read through the contents API, as `branchArchived` already reads that folder.
- If there is no prefix, or the proposal or its heading cannot be read, the route job falls back to the current behaviour: it drops `WIP:` only.
- Per-task PRs do not change: each one already names its one task.

## Out of scope

- PR bodies. They already list every task.
- Rewriting commits already on `main`.

## Autonomy

```yaml
merge: human
```

Every task touches `scripts/factory-route.js`, which is on the `no_go` baseline (`scripts/check-no-go.js`), so it is built in an interactive session.
