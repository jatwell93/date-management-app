# Handover: add-spec-factory-runner

Updated: 2026-10-24 · main at 5b2994da

## State

Phases 1 and 2 are done; phase 3 is built and waits for merge.

Phase 1: the factory ran the pilot change `add-agent-route-map-and-tooling-polish` end to end, one task per hand-started run, and the pilot is archived (its `no_go` list no longer applies to other factory PRs). Each factory PR was opened by the Claude App (`app/claude`), CI ran on it, and `factory/no-go-guard` passed.

| Task                        | Run                                                                       | PR   | Fix rounds after CI                   |
| --------------------------- | ------------------------------------------------------------------------- | ---- | ------------------------------------- |
| 1.1 route map               | https://github.com/jatwell93/date-management-app/actions/runs/39873213474 | #691 | 2 (CodeScene complexity, before #692) |
| 1.2 `pr-feedback --summary` | https://github.com/jatwell93/date-management-app/actions/runs/39880555503 | #693 | 0                                     |
| 1.3 cleanup-merged hints    | https://github.com/jatwell93/date-management-app/actions/runs/39888468245 | #694 | 0                                     |

#692 added ESLint `complexity` 8 and `max-depth` 3 for new code (existing offenders baselined in `eslint.complexity-baseline.js`, capped at 61) and told `run-spec` to keep functions small and use existing parsers.

Phase 2 (#696): merges of factory PRs start the next task, and relayed CI runs and review events start one-shot babysit passes, routed by `scripts/factory-route.js`. Task 2.3 ran `show-user-names-in-daily-usage` (issue #671) through the chain. The owner dispatched once, then only approved and merged.

| Step                   | Started by | Run                                                                       | PR   | Fix rounds after CI |
| ---------------------- | ---------- | ------------------------------------------------------------------------- | ---- | ------------------- |
| 1.1 Worker `user_name` | dispatch   | https://github.com/jatwell93/date-management-app/actions/runs/39951529433 | #701 | 0                   |
| 2.1 frontend label     | #701 merge | https://github.com/jatwell93/date-management-app/actions/runs/40034037190 | #702 | 0                   |
| completion comment     | #702 merge | https://github.com/jatwell93/date-management-app/actions/runs/40051993463 | #703 | n/a                 |

Every relayed CI and review event on #701 and #702 routed to `mode=none` ("Actions checks still running", then "nothing actionable"), so no babysit pass ran. The babysit path has unit tests but has not yet fixed a real finding. #701's cross-tenant test was mutation-checked by hand: it fails with the join scoping removed.

Phase 3 is on `feature/factory-phase-3-escalation-digest` (3.1, 3.2). It edits protected paths, so it is built interactively.

- Escalation: `scripts/factory-issue.js` finds the tracking issue (labelled `factory:<id>`, else the `issue:` key in the proposal's `## Autonomy` block, else new; an issue cited in prose never counts). The router holds every task of a change while that issue has `needs-human`, and resumes it when the owner removes the label (`issues: unlabeled`; a removal by anyone else is ignored). The next run records the owner's answer under "Decisions" in its PR's `handover.md`.
- Digest: `.github/workflows/factory-digest.yml`, daily at 21:00 UTC, comments on the `Factory digest` issue (label `factory-digest`; no `factory:` prefix, so the router never reads it as a change).

## Next

Phase 4: AGENTS.md §5 and the memory store (4.1), then strict validation and archive (4.2). After merge, check both new paths live: dispatch `factory-digest.yml` once, and park a throwaway change to see the hold and the resume.

## Open PRs

- Phase 3 PR from `feature/factory-phase-3-escalation-digest`.

## Waiting on the user

- Merge the phase 3 PR.

Phase 0 is verified (2026-10-23, `gh api repos/{owner}/{repo}/rulesets/14671588`): 1 required approval, Repository admin bypass, and `factory/no-go-guard` among the 7 required checks.

## Learnings

- The `production` environment has `wait_timer` and `branch_policy` but no required reviewers. A push to `main` deploys Workers and Pages to production with no further human gate (`.github/workflows/pages-deploy.yml:147-151`, `.github/workflows/workers-deploy.yml:73`). Do not enable `merge: auto` until that changes.
- The action's app token reaches `gh` as well as `git`: factory PRs are authored by `app/claude` and trigger CI.
- In agent mode (`prompt` set), `claude-code-action` allows no Bash unless `--allowedTools` lists it, so `factory.yml` carries an allow-list as well as the deny-list.
- A `pull_request_target` run's check is attached to the base commit, so `no-go-guard.yml` posts the commit status `factory/no-go-guard` on the head SHA. Opening a PR with a label fires `opened` and `labeled` together; the guard's concurrency group cancels the first run, which is expected.
- The guard applies every active change's `no_go` list. Archive a change once done so its list stops protecting those paths from other factory PRs.
- CodeScene's gate cannot run in the factory (the CLI needs a token). ESLint's `complexity` counts differ from CodeScene's (`main` 10 vs 9, `entryLine` 6 vs 9), so the lint rule catches the worst cases only; CodeScene is not a required check, and borderline findings can be answered instead of refactored.
- Squash merges break stacked PRs: after the base PR merges, merge `origin/main` into the stacked branch and keep its side of the add/add conflicts, rather than rebasing and force-pushing. When two PRs both append to the one-line `test:tooling` script, keep both entries.
- `run-spec` found the tracking issue by the `factory:<id>` label only, so a change written for an existing issue (#671) got a second, label-made issue (#703). Phase 3's `scripts/factory-issue.js` adopts the proposal's issue first.
- A PR parked by babysit-pr (`needs-human` on the PR, not the issue) does not hold new tasks. Removing that label starts nothing by itself; the next review or CI event on the PR starts a pass.
