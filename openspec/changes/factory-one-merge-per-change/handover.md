# Handover: factory-one-merge-per-change

Updated: 2026-10-26 · main at 9e850736

## State

5.1 (owner tasks, #713) is merged and was proven live: run 40179440871 routed `mode=escalate task=5.2`, skipped the Claude job, created tracking issue #714 and labelled it `needs-human`.

5.2 is done: the first real product spec ran unattended. Record below. #714 still has `needs-human`, so the factory holds this change until the owner decides on 5.3.

## 5.2 record: `fix-recent-items-iso-timestamps`

Issue #672, proposal #715 (two Seer findings, both fixed before merge), archived in the 5.2 record PR. Dispatched 2026-10-25 21:13 UTC; last merge 22:47 UTC (94 minutes).

| Task | PR | Opened to merged | Commits | Fix rounds | Notes |
| --- | --- | --- | --- | --- | --- |
| 1.1 | #716 | 18 min | 1 | 0 | |
| 1.2 | #717 | 29 min | 2 | 1 | Babysit pass fixed a CodeScene "Large Method" gate (moved a SQL comment into the docblock). The guard missed the fix push. |
| 1.3 | #718 | 5 min | 1 | 0 | |
| 1.4 | #719 | 10 min | 1 | 0 | |
| 1.5 | #720 | 7 min | 1 | 0 | Final run commented "every task done" on #672. |

- **Runs:** 64 `factory.yml` runs; 53 stopped in the route job, 11 started Claude (6 task runs, 5 babysit passes; 31 Claude minutes in all, 1 to 6 minutes each). Every one succeeded.
- **Owner touches:** five merges, and one label toggle on #717. No escalation, no `needs-human`.
- **Missed guard run:** the babysit push `6e80c43d` on #717 started every `pull_request` workflow but no `no-go-guard.yml` run, so the required `factory/no-go-guard` status never arrived. Adding and removing a label re-fired it. #721 makes the CI relay re-dispatch the guard when a factory head has no guard status.
- **Digest:** not yet seen for this change. The 2026-10-25 21:00 UTC schedule had not started by 22:53 UTC (the 2026-10-24 one ran at 22:58).
- **Merge cost:** five of six owner touches were merges, and PRs waited 5 to 29 minutes for one (69 of the 94 minutes). Agent work per task was 1 to 6 minutes.

## Next

- The owner decides whether 5.3 (one PR per change) is worth building, from the record above. If not, drop 5.3a/5.3b from `tasks.md` before resuming.
- Then remove `needs-human` from #714 to resume: the next task is 5.3a, or 5.4 if 5.3 is dropped.

## Open PRs

- #721 (re-run the no-go guard when a factory head has no status).
- The 5.2 record PR (this handover, 5.2 ticked, the change archived).

## Waiting on the user

- Merge #721 and the 5.2 record PR.
- The 5.3 decision.

## Learnings

- No GitHub event fires when `pr-feedback.js`'s quiet window ends, so anything that waits for "settled" needs a schedule (the hourly sweep), not an event.
- Seer reviews proposals as if they were code. On #710 it kept finding narrower bookkeeping gaps (holds, retries, labels) for nine rounds; past a few rounds those are cheaper as test cases in the build tasks.
- `nextTask` skips unnumbered checkboxes, so sub-items under a task never count as the next task.
- `pull_request_target` can silently skip a push that `pull_request` workflows see. A required status posted by such a workflow needs a second trigger.
- Seer's findings on the 5.2 proposal (a missed file, a comment that would trip the guard test) were real and cheap to fix before dispatch: one review round on the spec saved a failing task.
