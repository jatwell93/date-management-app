# Handover: factory-tickets-and-autostart

Updated: 2026-10-29 · main at c54f34ea

## State

Proposal merged (#738). Task 1.1 done on `feature/factory-tickets-1-1`. Every dependency holds, so the plan needs no change.

## 1.1 findings (2026-10-29)

- **`gh` flags:** local `gh` 2.86.0 already has `gh issue create --parent` and `--blocked-by` (the article's "2.94+" is wrong or out of date). A live test made #740 and #741 sub-issues of #739, with #741 blocked by #740 (checked through `issues/<n>/sub_issues` and `issues/<n>/dependencies/blocked_by`). All three are closed as not planned. No upgrade is needed. The runner's `gh` version does not matter, because only the local `to-tickets` skill creates issues; the factory only writes `Closes #<n>` in PR bodies.
- **Licence:** mattpocock/skills is MIT ("Copyright (c) 2026 Matt Pocock"). Adapting it is allowed if the copyright and permission notice go with it, so 3.1 puts both at the foot of `.claude/skills/to-tickets/SKILL.md`. Source: `skills/engineering/to-tickets/SKILL.md`, plus `docs/engineering/to-tickets.md` for background.
- **Headless archive:** `openspec archive <id> -y` with stdin closed archived a copy of this change in a scratch repo. It exited 0, merged both spec deltas and did not prompt, even with unchecked tasks. `openspec/specs/**` and `openspec/changes/archive/**` are outside the `no_go` baseline (`scripts/check-no-go.js:36`).
- **Label sender:** issue events written by the owner's local `gh` show `actor` `jatwell93`, and `sender` in the webhook payload is that actor. The router already relies on this for the owner's `needs-human` removal (`sentByOwner`, `scripts/factory-route.js:246`), so 4.1 reuses it.

## Next

2.1 (main-guard hook) and 2.2 (`mem-log` on feature branches only). Neither depends on 1.1. Then 3.1.

## Open PRs

- The 1.1 PR (this branch).

## Waiting on the user

- Merge the 1.1 PR.
