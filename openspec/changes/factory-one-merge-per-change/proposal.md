# Proposal: One merge per change

## Why

`add-spec-factory-runner` (archived in #709) runs an OpenSpec change without a session open. What the owner still does by hand:

1. **One merge per task.** The next task starts only when the owner merges the last one, so a five-task change needs the owner five times, hours apart.
2. **Tasks only the owner can do still cost a run.** Task 4.1 needed `AGENTS.md`, a `no_go` path. The factory spent a full run finding that out, then escalated on #707.
3. **A run that dies is not retried.** A run killed by a usage limit or the 90-minute timeout opens no PR and starts nothing. The daily digest lists it, and the owner dispatches it again.
4. **Two paths have never run live:** the digest posting a comment, and a babysit pass fixing a real bot finding. Every factory PR so far came back clean.

## What changes

- **Owner tasks.** A task written `- [ ] 2.3 (owner) …` is never attempted. When it is the next unchecked task, the router escalates it on the tracking issue (`needs-human`, owner mentioned) without starting a Claude run. The owner does it, ticks it in the task list the router reads, then removes `needs-human`. That list is `tasks.md` on the open per-change PR's branch while there is one, else on `main`, and the escalation comment names the branch to tick it on. If the task is still unchecked when the label goes, the router escalates again.
- **One PR per change, opt-in.** A change whose Autonomy block says `pr: per-change` keeps one PR on `feature/factory-<id>`:
  - The first task opens the PR. Every later task adds its commits with a `Factory-Task: <n>` trailer and pushes, never rebasing or force-pushing.
  - Every run on the PR advances it by one step, chosen from the PR's state when the run starts: a babysit pass while something is actionable; the next task once the PR is settled (`pr-feedback.js` `settled=true`, nothing actionable); marking it ready when no task is left; nothing while checks run or the quiet window lasts. A run that found work but could neither push nor reply escalates.
  - All runs of the change share one concurrency group. GitHub cancels an older pending run when a newer one queues, which is harmless: the newer run reads the PR's state afresh.
  - An hourly sweep (`schedule` on `factory.yml`, route job only, no Claude run) dispatches an advance run for each open per-change PR, because no GitHub event fires when the quiet window ends. It skips a PR parked with `needs-human` (on the PR or the tracking issue) and a change waiting on a retry (`factory-retry`). A duplicate dispatch just finds nothing to do. Cancelling a run does not stop the change; adding `needs-human` does.
  - Each task merges `origin/main` into the branch first, unless that merge would bring in a `.github/**` change: the Claude App has no Workflows permission, so GitHub would reject the push. The branch then stays on its older base, and the owner uses "Update branch" before merging (the ruleset requires branches to be up to date).
  - While the PR is open, the PR branch's `tasks.md` is the task list the router and sweep read (through the contents API, since the route job checks out only `main`), because the ticks land there, not on `main`.
  - The babysit round cap of 5 counts per task: `scripts/babysit-round.js` counts `Babysit-Round` trailers after the newest `Factory-Task` commit.
  - When no unchecked task is left, the run marks the PR ready (`gh pr ready`) and mentions the owner on it, also when the last task was an `(owner)` task. The owner reviews and merges once. That merge starts no task.
  - Default stays `pr: per-task`. Migrations, billing, auth and production-data work stay per-task.
- **Retry once.** When a task run fails, a `report-failure` job adds the label `factory-retry` to the tracking issue (no `factory:` prefix, so the router never reads it as a change id). While the label is under an hour old the sweep leaves the change alone; once it is older, the sweep dispatches the change as a retry and removes the label. A failed retry escalates with both run links instead of retrying again. A timeout counts as a failure: the Claude step gets a `timeout-minutes` below the job's, because a job that hits its own timeout can end `cancelled`, which `if: failure()` skips. A cancelled run starts no retry.
- **First real spec.** A small product change, written by the owner, runs end to end with the owner touching the keyboard only to merge and answer escalations. It shows whether the merges are the main remaining cost, and should prove the digest posting path.

## Safety

Nothing here changes what the factory can reach:

- It still never merges. A per-change PR needs the owner's approval like any other factory PR (`main` ruleset), and the deny-list keeps `gh pr merge`, `gh pr review` and `gh api`. The runner gains only `gh pr ready`.
- `no-go-guard` checks the whole per-change PR, so every task's diff is still checked before merge.
- The sweep runs in the route job, from `main`'s checkout, with no Claude step. The route job needs `actions: write` to dispatch runs; the Claude job keeps `actions: read`.
- New scripts (`scripts/factory-sweep.js`, `scripts/factory-escalate.js`) go on the `no_go` baseline in `scripts/check-no-go.js`, beside the other factory scripts, and on the list of rules a babysit pass restores from `main`.
- A per-change PR is bigger at merge time. Each task is its own commit, so the owner can review it commit by commit.

## Autonomy

```yaml
merge: human
```

Not for the factory: 5.1, 5.3, 5.4 and 5.5 edit `no_go` paths (`.github/**`, `.claude/**`, `AGENTS.md`, the factory scripts), so they are built in interactive sessions with the owner. 5.2 is a separate product change that the factory runs.

## Out of scope

- Agents merging. Every merge to `main` deploys production, and the `production` environment has no required reviewer.
- Running tasks of one change in parallel.
- Writing the spec. That stays with the owner.
