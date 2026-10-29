# Handover: factory-tickets-and-autostart

Updated: 2026-10-29 · main at cbc8cb09

## State

Merged: 1.1 (#742), 2.1 git hooks (#743), 2.2 mem-log (#744), 4.1 factory-ready label (#745), 3.1 to-tickets skill (#746), 4.2 plan-PR merge (#747), 3.2 `Closes #n` (#748). 5.1 (archive mode) is on `feature/factory-tickets-5-1`.

5.1 notes: `mode: archive` is a Claude run (run-spec's "Archive a finished change" section). A per-change PR gets it on the PR once no task is left; the router marks the PR ready only once the branch holds `openspec/changes/archive/<date>-<id>/` (`branchArchived`, contents API). A per-task change, or a per-change PR merged before its archive, gets one archive PR. `@fission-ai/openspec` 1.13.2 is now an exact root devDependency: `npx openspec` on the runner would otherwise fetch the unrelated npm package `openspec`.

## 1.1 findings (2026-10-29)

- **`gh` flags:** local `gh` 2.86.0 already has `gh issue create --parent` and `--blocked-by` (the article's "2.94+" is wrong or out of date). A live test made #740 and #741 sub-issues of #739, with #741 blocked by #740 (checked through `issues/<n>/sub_issues` and `issues/<n>/dependencies/blocked_by`). All three are closed as not planned. No upgrade is needed. The runner's `gh` version does not matter, because only the local `to-tickets` skill creates issues; the factory only writes `Closes #<n>` in PR bodies.
- **Licence:** mattpocock/skills is MIT ("Copyright (c) 2026 Matt Pocock"). Adapting it is allowed if the copyright and permission notice go with it, so 3.1 puts both at the foot of `.claude/skills/to-tickets/SKILL.md`. Source: `skills/engineering/to-tickets/SKILL.md`, plus `docs/engineering/to-tickets.md` for background.
- **Headless archive:** `openspec archive <id> -y` with stdin closed archived a copy of this change in a scratch repo. It exited 0, merged both spec deltas and did not prompt, even with unchecked tasks. `openspec/specs/**` and `openspec/changes/archive/**` are outside the `no_go` baseline (`scripts/check-no-go.js:36`).
- **Label sender:** issue events written by the owner's local `gh` show `actor` `jatwell93`, and `sender` in the webhook payload is that actor. The router already relies on this for the owner's `needs-human` removal (`sentByOwner`, `scripts/factory-route.js:246`), so 4.1 reuses it.

## Next

6.1, the live proof: a throwaway two-task `pr: per-change` change from `/to-tickets` to its archive. Owner input: the quiz and the merges (plan PR, then the change PR). It needs 5.1 merged.

Once 2.1 is proven in use, delete the `verify-branch-before-commit` auto-memory: the pre-commit hook now refuses commits on main.

## Open PRs

- The 5.1 PR (this branch).

## Waiting on the user

- Merge the 5.1 PR.
