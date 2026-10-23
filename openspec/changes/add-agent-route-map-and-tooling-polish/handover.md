# Handover: add-agent-route-map-and-tooling-polish

Updated: 2026-10-23 · branch feature/factory-add-agent-route-map-and-tooling-polish-1.3

## State

Tasks 1.1 (#691) and 1.2 (#693) merged. Task 1.3 done: `scripts/cleanup-merged.js` prints a manual-command hint after each `keep` line, with tests in `scripts/cleanup-merged.test.js`; PR pending the owner's merge. All tasks are ticked.

## Next

Once the 1.3 PR is merged, archive the change (`openspec archive`).

## Open PRs

- Task 1.3 factory PR (label `factory:add-agent-route-map-and-tooling-polish`).

## Waiting on the user

- Merge of the task 1.3 PR.
- Add `--summary` to `.claude/skills/babysit-pr/SKILL.md` (protected path, left untouched).

## Learnings

- Hints live on the `kept` entries from `plan` (`hint` field), so they are data; `main` only prints them. Nothing runs them.
