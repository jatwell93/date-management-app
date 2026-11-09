# Handover: extract-software-factory

Updated: 2026-11-09 · main at 724fcb950

## State

Group 1 is done: the public repo `jatwell93/software-factory` exists with a `v*` tag rule (1.1), `design.md` inventories 22 couplings in the 41 files that move (1.2, #780), and the config schema and adapter contract are merged in the new repo (1.3, software-factory #1). Task 2.1 is split into several PRs in the new repo; the first, software-factory #2, ports `check-no-go` (config-driven baseline) and adds the change-id check. No factory file in this repo has changed yet.

## Next

Task 2.1, remaining parts, in `C:\Users\josha\software-factory` (a separate clone, branch off `main`): port the other scripts and their tests (`pr-feedback`, `babysit-round`, `factory-route`, `factory-issue`, `factory-ticket`, `factory-escalate`, `factory-retry`, `factory-sweep`, `factory-digest`, `cleanup-merged`) and the main-branch git hooks with a rewritten installer (`design.md` row 21). Keep the OpenSpec reads in `lib/openspec-reads.js` until 2.2.

## Open PRs

- software-factory #2: feat(guard): config-driven check-no-go and the change-id check. Test job passes; reviews pending.

## Waiting on the user

- Merge software-factory #2 once it is settled (the agent reports when). Its `main` needs a review from the owner.

## Learnings

- Bot reviewers found a real slip in every round of #779 and #780, nearly all in claims written without opening the cited line. Before writing a `path:line` claim into `design.md`, open the line (`grep -n` the file).
- The new repo has Prettier pinned at 3.9.10 with this repo's options. A PostToolUse format hook rewrites files on save; run `npx prettier --write .` there before committing.
- `check-no-go --change all` now also applies the list of a folder with an invalid id (the original skipped it), covered by a test in software-factory.
- A mutation check found an equivalent mutant: an `archive` filter on `--files` had no visible effect because `archive` is a valid id, so the helper has its own unit test.
- Do not run `sed` with backslashes through the shell; use the Edit tool (global CLAUDE.md).
