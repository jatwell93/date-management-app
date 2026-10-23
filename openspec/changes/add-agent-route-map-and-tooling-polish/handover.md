# Handover: add-agent-route-map-and-tooling-polish

Updated: 2026-10-23 · branch feature/factory-add-agent-route-map-and-tooling-polish-1.2

## State

Tasks 1.1 (merged, #691) and 1.2 done. Task 1.2 adds `--summary` to `scripts/pr-feedback.js` with tests in `scripts/pr-feedback.test.js`; PR pending the owner's merge. Task 1.3 not started.

## Next

Task 1.3, the manual-command hints in `scripts/cleanup-merged.js`, once the 1.2 PR is merged.

## Open PRs

- Task 1.2 factory PR (label `factory:add-agent-route-map-and-tooling-polish`).

## Waiting on the user

- Merge of the task 1.2 PR.
- Add `--summary` to `.claude/skills/babysit-pr/SKILL.md` (protected path, left untouched).

## Learnings

- `--summary` is built by `formatSummary(report)` from the normal report, so the JSON output is unchanged. Tests drive `main` with a fake `gh`; the fixture commit date is days in the past, so use a huge `--quiet-minutes` to force the quiet window.
