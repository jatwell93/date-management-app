# Proposal: One PR per change

> **Status: deferred.** Moved unchanged from `factory-one-merge-per-change` (task 5.3) on 2026-10-26, after its first real spec (5.2). Build it after that change is archived.

## Why

With one PR per task, the next task starts only when the owner merges the last one. In the first unattended run (`fix-recent-items-iso-timestamps`, PRs #716-#720) five of the owner's six touches were merges, and PRs waited 5 to 29 minutes for one, 69 of the run's 94 minutes. Each merge took the owner about a minute, so it was deferred: worth it once changes run long enough that the owner wants to leave them overnight.

## What changes

- **One PR per change, opt-in.** A change whose Autonomy block says `pr: per-change` keeps one PR, on the branch its first task opens (`feature/factory-<id>-<first task>`):
  - The first task opens the PR as a draft (or with a `WIP:` title, if task 1.1 finds a bot skips drafts). Every later task adds its commits with a `Factory-Task: <n>` trailer and pushes, never rebasing or force-pushing.
  - Escalations on a per-change PR, including a babysit pass hitting its round cap, put `needs-human` on the tracking issue only, never on the PR. Removing that one label resumes the change. Every route checks the tracking issue before starting a Claude run, so a review or CI event on a parked or backing-off change starts nothing either.
  - Every run on the PR advances it by one step, chosen from the PR's state when the run starts: a babysit pass while something is actionable; the next task once the PR is settled (`pr-feedback.js` `settled=true`, nothing actionable); marking it ready when no task is left; nothing while checks run or the quiet window lasts. The route job picks the step, so only a babysit pass or a task costs a Claude run: it marks the PR ready itself (`gh pr ready` and a comment) and routes a waiting or finished PR to `none`. The Claude run re-checks the state when it starts, in case it changed while queued. A run that found work but could neither push nor reply escalates.
  - All runs of the change share one concurrency group. GitHub cancels an older pending run when a newer one queues, which is harmless: the newer run reads the PR's state afresh.
  - An hourly sweep (`schedule` on `factory.yml`, route job only, no Claude run) uses the same step choice for each open per-change PR, because no GitHub event fires when the quiet window ends, and dispatches a run only when the step is a babysit pass or a task. It skips a PR parked with `needs-human` (on the PR or the tracking issue) and a change waiting on a retry (`factory-retry`). A duplicate dispatch just finds nothing to do. Cancelling a run does not stop the change; adding `needs-human` does.
  - Each task merges `origin/main` into the branch first, unless that merge would bring in a `.github/**` change: the Claude App has no Workflows permission, so GitHub would reject the push. The branch then stays on its older base, and the owner uses "Update branch" before merging (the ruleset requires branches to be up to date).
  - While the PR is open, the PR branch's `tasks.md` is the task list the router and sweep read (through the contents API, since the route job checks out only `main`), because the ticks land there, not on `main`.
  - The babysit round cap of 5 counts per task: `scripts/babysit-round.js` counts `Babysit-Round` trailers after the newest `Factory-Task` commit.
  - When no unchecked task is left, the run marks the PR ready (`gh pr ready`) and mentions the owner on it, also when the last task was an `(owner)` task. The owner reviews and merges once. That merge starts no task.
  - Default stays `pr: per-task`. Migrations, billing, auth and production-data work stay per-task.

The hourly sweep extends the scheduled retry check that `factory-one-merge-per-change` task 5.4 adds to the route job. The sweep's dispatches need `actions: write` on the route job (the Claude job keeps `actions: read`), or the route job can route the step in the same workflow run as the retry check does.

When this is built, re-check the MODIFIED requirements in `specs/agent-factory-runner/spec.md` against the archived `agent-factory-runner` spec: they were written against the spec before `factory-one-merge-per-change`.

## Safety

- It still never merges. A per-change PR needs the owner's approval like any other factory PR (`main` ruleset), and the deny-list keeps `gh pr merge`, `gh pr review` and `gh api`. The runner gains only `gh pr ready`.
- `no-go-guard` checks the whole per-change PR, so every task's diff is still checked before merge.
- `scripts/factory-sweep.js` goes on the `no_go` baseline and on the rules a babysit pass restores from `main`.
- A per-change PR is bigger at merge time. Each task is its own commit, so the owner can review it commit by commit.

## Autonomy

```yaml
merge: human
```

Not for the factory: it edits `.github/**` and the factory scripts.
