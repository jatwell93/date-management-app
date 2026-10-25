# Handover: factory-one-merge-per-change

Updated: 2026-10-25 · main at the #710 merge

## State

Proposal merged (#710, 21 Seer findings over nine rounds, all fixed). 5.1 (owner tasks) is built in the PR from `feature/factory-owner-tasks`: the router escalates an `(owner)` next task from the route job, with no Claude run.

## Next

- After the 5.1 PR merges, a live check: dispatch this change (`gh workflow run factory.yml -f change_id=factory-one-merge-per-change`). Its next task, 5.2, is `(owner)`, so the run should take the `escalate` job, create or reuse the tracking issue, add `needs-human` and comment task 5.2, with the Claude job skipped.
- 5.2: the owner picks a small product change and runs it unattended.

## Open PRs

- 5.1 PR from `feature/factory-owner-tasks`.

## Waiting on the user

- Merge the 5.1 PR, then run the live check above (or ask Claude to).
- Pick the change for 5.2.

## Learnings

- No GitHub event fires when `pr-feedback.js`'s quiet window ends, so anything that waits for "settled" needs a schedule (the hourly sweep), not an event.
- Seer reviews proposals as if they were code. On #710 it kept finding narrower bookkeeping gaps (holds, retries, labels) for nine rounds; past a few rounds those are cheaper as test cases in the build tasks.
- `nextTask` skips unnumbered checkboxes, so sub-items under a task never count as the next task.
