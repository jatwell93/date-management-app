# Handover: add-spec-factory-runner

Updated: 2026-10-23 · main at 79849410

## State

Phase 1 is done. The factory ran the pilot change `add-agent-route-map-and-tooling-polish` end to end, one task per hand-started run, and the pilot is archived (its `no_go` list no longer applies to other factory PRs). Each factory PR was opened by the Claude App (`app/claude`), CI ran on it, and `factory/no-go-guard` passed.

| Task                        | Run                                                                       | PR   | Fix rounds after CI                   |
| --------------------------- | ------------------------------------------------------------------------- | ---- | ------------------------------------- |
| 1.1 route map               | https://github.com/jatwell93/date-management-app/actions/runs/39873213474 | #691 | 2 (CodeScene complexity, before #692) |
| 1.2 `pr-feedback --summary` | https://github.com/jatwell93/date-management-app/actions/runs/39880555503 | #693 | 0                                     |
| 1.3 cleanup-merged hints    | https://github.com/jatwell93/date-management-app/actions/runs/39888468245 | #694 | 0                                     |

#692 added ESLint `complexity` 8 and `max-depth` 3 for new code (existing offenders baselined in `eslint.complexity-baseline.js`, capped at 61) and told `run-spec` to keep functions small and use existing parsers.

## Next

Phase 2, task 2.1: a `pull_request: closed` trigger in `factory.yml` that starts the next task when a `factory:<id>` PR merges. Then 2.2 (one-shot `babysit-pr` passes on review and CI events) and 2.3 (a change run through the chain with the owner only merging). Both edit protected paths (`.github/**`, `.claude/**`), so they are built interactively, not by the factory.

## Open PRs

- The PR carrying this handover, the 1.4 tick and the pilot archive.

## Waiting on the user

- Nothing.

## Learnings

- The `production` environment has `wait_timer` and `branch_policy` but no required reviewers. A push to `main` deploys Workers and Pages to production with no further human gate (`.github/workflows/pages-deploy.yml:147-151`, `.github/workflows/workers-deploy.yml:73`). Do not enable `merge: auto` until that changes.
- The action's app token reaches `gh` as well as `git`: factory PRs are authored by `app/claude` and trigger CI.
- In agent mode (`prompt` set), `claude-code-action` allows no Bash unless `--allowedTools` lists it, so `factory.yml` carries an allow-list as well as the deny-list.
- A `pull_request_target` run's check is attached to the base commit, so `no-go-guard.yml` posts the commit status `factory/no-go-guard` on the head SHA. Opening a PR with a label fires `opened` and `labeled` together; the guard's concurrency group cancels the first run, which is expected.
- The guard applies every active change's `no_go` list. Archive a change once done so its list stops protecting those paths from other factory PRs.
- CodeScene's gate cannot run in the factory (the CLI needs a token). ESLint's `complexity` counts differ from CodeScene's (`main` 10 vs 9, `entryLine` 6 vs 9), so the lint rule catches the worst cases only; CodeScene is not a required check, and borderline findings can be answered instead of refactored.
- Squash merges break stacked PRs: after the base PR merges, merge `origin/main` into the stacked branch and keep its side of the add/add conflicts, rather than rebasing and force-pushing. When two PRs both append to the one-line `test:tooling` script, keep both entries.
