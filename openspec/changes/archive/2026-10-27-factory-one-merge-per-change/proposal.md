# Proposal: One merge per change

## Why

`add-spec-factory-runner` (archived in #709) runs an OpenSpec change without a session open. What the owner still does by hand:

1. **One merge per task.** The next task starts only when the owner merges the last one, so a five-task change needs the owner five times, hours apart.
2. **Tasks only the owner can do still cost a run.** Task 4.1 needed `AGENTS.md`, a `no_go` path. The factory spent a full run finding that out, then escalated on #707.
3. **A run that dies is not retried.** A run killed by a usage limit or the 90-minute timeout opens no PR and starts nothing. The daily digest lists it, and the owner dispatches it again.
4. **Two paths have never run live:** the digest posting a comment, and a babysit pass fixing a real bot finding. Every factory PR so far came back clean.

## What changes

- **Owner tasks.** A task written `- [ ] 2.3 (owner) …` is never attempted. When it is the next unchecked task, the router escalates it on the tracking issue (`needs-human`, owner mentioned) without starting a Claude run. The owner does it, ticks it in the task list the router reads, then removes `needs-human`. That list is `tasks.md` on `main`. If the task is still unchecked when the label goes, the router escalates again.
- **Retry once.** When a Claude run fails (a task or a babysit pass), a `report` job adds the label `factory-retry` to the tracking issue and comments the failed run's link there (no `factory:` prefix on the label, so the router never reads it as a change id). An hourly `schedule` on `factory.yml` runs the route job, which lists open issues labelled `factory-retry`, so a run that failed before opening a PR is retried too. While the label is under an hour old it leaves the change alone; once it is older, it swaps the label for `factory-retrying` and routes one run in the same workflow run: a babysit pass when the change has an open factory PR, else a task. Nothing is dispatched, so the route job needs no `actions: write`. `factory-retrying` stays until the retry run itself succeeds (the route marks it with a `retry` output), so a parallel success cannot reset the budget. A run that fails while the issue has `factory-retrying` removes it and escalates with both run links (the first from the earlier comment) instead of retrying again. Every route, babysit included, starts no Claude run while the tracking issue has `needs-human` or `factory-retry`, so a review or CI event during the backoff starts nothing. A timeout counts as a failure: the Claude step gets a `timeout-minutes` below the job's, because a job that hits its own timeout can end `cancelled`. A cancelled run starts no retry.
- **One PR per change: deferred.** 5.2 showed merges are the main owner cost (five of six touches), but each took the owner a minute, and the per-change design is the largest and riskiest part of this change. Its design moved unchanged to the change `factory-per-change-pr`, to build when longer unattended runs need it.
- **First real spec.** A small product change, written by the owner, runs end to end with the owner touching the keyboard only to merge and answer escalations. It shows whether the merges are the main remaining cost, and should prove the digest posting path.

## Safety

Nothing here changes what the factory can reach:

- It still never merges, and the deny-list keeps `gh pr merge`, `gh pr review` and `gh api`.
- The scheduled retry check runs in the route job, from `main`'s checkout, with no Claude step, and dispatches nothing; the workflow's permissions do not change.
- New scripts (`scripts/factory-escalate.js`, `scripts/factory-retry.js`) go on the `no_go` baseline in `scripts/check-no-go.js`, beside the other factory scripts, and on the list of rules a babysit pass restores from `main`.

## Autonomy

```yaml
merge: human
```

Not for the factory: 5.1, 5.4 and 5.5 edit `no_go` paths (`.github/**`, `.claude/**`, `AGENTS.md`, the factory scripts), so they are built in interactive sessions with the owner. 5.2 is a separate product change that the factory runs.

## Out of scope

- Agents merging. Every merge to `main` deploys production, and the `production` environment has no required reviewer.
- Running tasks of one change in parallel.
- Writing the spec. That stays with the owner.
