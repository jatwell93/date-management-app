# Handover: factory-one-merge-per-change

Updated: 2026-10-27 · main at 34b19378

## State

5.4 is merged (#724) and proven live (record below). 5.5 (this close-out) is on `feature/factory-5-5-close-out`. 5.6 archives the change once it merges.

Earlier state, kept for the record:

5.1 (owner tasks, #713) is merged and was proven live: run 40179440871 routed `mode=escalate task=5.2`, skipped the Claude job, created tracking issue #714 and labelled it `needs-human`.

5.2 is done: the first real product spec ran unattended. Record below.

5.3 (one PR per change) is deferred by the owner after 5.2: its design moved unchanged to the change `factory-per-change-pr`.

5.4 (retry once) is built on `feature/factory-retry-once`, without the 5.3 sweep: an hourly `schedule` route finds a due `factory-retry` issue and routes the retry in the same workflow run, so nothing is dispatched. #714 keeps `needs-human`: the remaining tasks (5.5, 5.6) edit `no_go` paths and are built interactively.

## 5.2 record: `fix-recent-items-iso-timestamps`

Issue #672, proposal #715 (two Seer findings, both fixed before merge), archived in the 5.2 record PR. Dispatched 2026-10-25 21:13 UTC; last merge 22:47 UTC (94 minutes).

| Task | PR   | Opened to merged | Commits | Fix rounds | Notes                                                                                                                      |
| ---- | ---- | ---------------- | ------- | ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | #716 | 18 min           | 1       | 0          |                                                                                                                            |
| 1.2  | #717 | 29 min           | 2       | 1          | Babysit pass fixed a CodeScene "Large Method" gate (moved a SQL comment into the docblock). The guard missed the fix push. |
| 1.3  | #718 | 5 min            | 1       | 0          |                                                                                                                            |
| 1.4  | #719 | 10 min           | 1       | 0          |                                                                                                                            |
| 1.5  | #720 | 7 min            | 1       | 0          | Final run commented "every task done" on #672.                                                                             |

- **Runs:** 64 `factory.yml` runs; 53 stopped in the route job, 11 started Claude (6 task runs, 5 babysit passes; 31 Claude minutes in all, 1 to 6 minutes each). Every one succeeded.
- **Owner touches:** five merges, and one label toggle on #717. No escalation, no `needs-human`.
- **Missed guard run:** the babysit push `6e80c43d` on #717 started every `pull_request` workflow but no `no-go-guard.yml` run, so the required `factory/no-go-guard` status never arrived. Adding and removing a label re-fired it. #721 makes the CI relay re-dispatch the guard when a factory head has no guard status.
- **Digest:** not yet seen for this change. The 2026-10-25 21:00 UTC schedule had not started by 22:53 UTC (the 2026-10-24 one ran at 22:58).
- **Merge cost:** five of six owner touches were merges, and PRs waited 5 to 29 minutes for one (69 of the 94 minutes). Agent work per task was 1 to 6 minutes.

## 5.4 live check (2026-10-26/27)

- **Failure recorded:** run 40398194932, dispatched on `factory-per-change-pr` from the throwaway branch `feature/factory-retry-live-check` (Claude step replaced by `sleep 120`, `timeout-minutes: 1`). The `run` job ended `failure`, not `cancelled`, so a step timeout below the job's works. The `report` job created tracking issue #726 and labelled it `factory-retry`, with the run link and the marker comment.
- **Hold respected:** `needs-human` added to #726 at about 20:47 UTC. The next scheduled run, 40427465118 at 00:36 UTC (label about four hours old), routed `mode=none`, "no retry due", with no Claude run.
- **Cleanup:** `factory-retry` removed from #726; that `issues` event routed `none` ("not a needs-human removal"). #726 keeps `needs-human`, so the deferred change stays held. The owner deletes the throwaway branch.
- **Not exercised live:** a real retry run and a failed-retry escalation (router and `factory-retry.js` tests cover them).
- **Schedule reliability:** GitHub ran one of about six expected hourly `schedule` runs between 21:00 and 03:00 UTC, 13 minutes after its cron minute. Expect a retry hours after a failure, not one hour.

## Next

- 5.6: `openspec validate factory-one-merge-per-change --strict`, then archive after the 5.5 PR merges.

## Open PRs

- The 5.5 PR from `feature/factory-5-5-close-out`.

## Waiting on the user

- Merge the 5.5 PR. Keep `needs-human` on #714 and #726. Delete `feature/factory-retry-live-check` (local and remote).

## Learnings

- No GitHub event fires when `pr-feedback.js`'s quiet window ends, so anything that waits for "settled" needs a schedule (the hourly sweep), not an event.
- Seer reviews proposals as if they were code. On #710 it kept finding narrower bookkeeping gaps (holds, retries, labels) for nine rounds; past a few rounds those are cheaper as test cases in the build tasks.
- `nextTask` skips unnumbered checkboxes, so sub-items under a task never count as the next task.
- `pull_request_target` can silently skip a push that `pull_request` workflows see. A required status posted by such a workflow needs a second trigger.
- Seer's findings on the 5.2 proposal (a missed file, a comment that would trip the guard test) were real and cheap to fix before dispatch: one review round on the spec saved a failing task.
- A `schedule` event carries `github.event.repository` (the digest checks out `default_branch` on it), so scheduled jobs can use the same checkout as event-driven ones.
