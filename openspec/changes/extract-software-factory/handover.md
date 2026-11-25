# Handover: extract-software-factory

Updated: 2026-11-24 · main at 0b7f85bf0 · software-factory main at `efb8435` (this repo's pin is still `07a9dca`: move it with `factory-upgrade.js --ref efb843562248e144610a0b05aefa5aa8fc4fbb58` on a plain PR)

## State

Groups 1 to 4 are done. `jatwell93/software-factory` (public, GPL-3.0) holds the schema, adapter contract, OpenSpec adapter, scripts, reusable workflows, five skills, digest and the setup CLI. This repo runs it pinned to `07a9dcac600ccda4f52a59961eb5ab2d99bbf42f` (#797). The `docs/` folder now has the quickstart, the factory guide (moved in, generalised) and owner setup (#38).

Task 5.1 ran on the private Python repo `jatwell93/time-planner`: `init`, `doctor`, the owner steps, plan PR #8, then change `weekly-plan-model` ran to a merged PR #9 (tasks 1.1 to 1.3 and the archive on one per-change PR). It found six factory bugs, all fixed and live in time-planner at pin `c099f2c`: private-repo token scopes (software-factory #31), no OpenSpec CLI on a project without `package.json` (#32), the factory not asked after reviews settle (#33), required statuses never posted for a head (#34), plus earlier #29 (owner-setup doc) and CRLF compare. The full log, one entry per gap, is `C:\Users\josha\proof-5-1-log.md` (outside both repos: copy it into "5.1 gaps" below when the proof ends).

The second change, `habit-tracking`, ran to a merged per-change PR #19 (tasks 1.1 to 1.3 plus the archive) and found two more bugs: the babysit pass could not read CI on a private repo (software-factory #35 saves the CI state before the agent starts) and the no-go guard fails an owner edit of a protected path made on a factory PR (worked around: the owner task went on its own PR, time-planner #20). Time-planner is pinned to `8791ba1`. 5.1 is ticked; the gaps are below.

## Next

1. Task 5.2 demo (owner): someone who has not seen the repo follows `docs/quickstart.md` in software-factory to a first factory PR, on a scratch repo. Tick 5.2 when it works, and write what they stumbled on into the quickstart. The quickstart and the guide are written (software-factory #38); the demo is the only part left.
2. Remove this repo's own copy `docs/factory-guide.md` (or shrink it to a link to the factory repo's) once the demo passes. It is a copy now.
3. Live check of the new pin: the first factory PR here is the first babysit pass with the CI snapshot (#35) and `allowed_bots` `*`. Read `denied:` lines and the "Save the PR's CI state" step if it misbehaves.
4. `add-paul-adapter` is done and archived (#803), run live on review-radar. `add-gsd-adapter` is skipped for now (design.md section 4).
5. Factory follow-ups found on the review-radar run, none blocking (software-factory):
   - The PAUL `run-spec` archive step overwrote `STATE.md` "Last activity" and "Stopped at" while another phase was in progress (fixed by hand on review-radar #31). It should leave them alone when another phase is active.
   - A new file in a gitignored folder is dropped silently by `git add`: review-radar ignored `backend/routers/` and `backend/services/`, so `url_validation.py` never reached #23 and `main` broke until #26. Add a `run-spec` check on `git status --ignored` and a `doctor` check for an ignore pattern that matches tracked source folders.
   - A `tsc` gate run from the repo root needs `-p <dir>`: `doctor` or `init` could try each gate once.
   - `reviews-settled`: the 15-minute `schedule` did not fire on a new repo (dispatch with `pr` re-evaluates), and a listed bot that never posts holds every PR for the full timeout.
6. Smaller factory follow-ups, none blocking: a guard exemption for an owner edit of a protected path (the own-PR route is documented), the stale statuses after a revert push (cause unknown), and a second-PR hint for the ruleset picker.

## Open PRs

- None for this change.

## Waiting on the user

- Actions approval policy in this repo (`first_time_contributors_new_to_github` may stop the click); also require `factory/change-ids` in this repo's `main` ruleset (it requires `factory/no-go-guard` but not `factory/change-ids`; `doctor` fails on it; time-planner already requires both) and enable "Block force pushes" on `main`, if not done.
- Swap Sentry for Cursor Bugbot in `review_bots` (own PR, protected path) when the Sentry subscription ends. Sentry posts a review on few PRs, so every PR waits the 30-minute timeout for it today. Confirm Bugbot's login (`cursor`) and that it reviews factory PRs (authored by `claude[bot]`) before listing it.
- Whether a run that ends with denied tool calls and no PR should fail the job (today `success`).
- Confirm the Claude GitHub App covers time-planner (done: it does).

## Learnings

- Private repos need more than public ones: `gh workflow run` needs `--ref`; `gh pr checks` needs `actions: read`; a reusable workflow cannot get more than its caller grants, so `doctor` and `upgrade` check the caller's `permissions` and triggers against the template.
- GitHub starts no `workflow_run` for a run held for owner approval, and sometimes no `pull_request_target` for an agent push. Recovery runs from `factory/reviews-settled` (every 15 minutes), not from the CI relay. A manual unblock is `gh pr close` then `gh pr reopen`.
- A per-change PR advances on an event; the quiet window ending is no event. `gh workflow run factory.yml -f pr=<n> --ref main` advances it; with no inputs it does nothing.
- Read `denied:` lines in a run log first when a run ends `success` with no PR.
- Mutation-check scripts: give each backup a unique name (two files named `check-change-ids.yml` clobbered each other and made every later "kill" false).
- Tooling: dcg blocks heredocs, `$VAR` redirects and `$(...)` loops (use Write and `--body-file`); the Bash tool halves backslashes (global CLAUDE.md); a prettier hook rewrites files on save.
- `check-change-ids` flags `use-cloudflare-r2-and-a-serverless-database` (43 characters, limit 42): rename before building it.

## 5.1 gaps

From `C:\Users\josha\proof-5-1-log.md`, two changes on a private Python repo (`jatwell93/time-planner`). Owner touches logged over both changes: plan PRs merged (2), final PRs merged (2), "Approve and run workflows" clicks (2), `needs-human` removals (1), close and reopen of a PR (2), one stray PR to make required checks appear (1), plus merges of factory fixes and time-planner pin moves (not counted one by one). Most are fixes for the bugs below, not steady-state touches.

Fixed in software-factory:

- Private repos need more token scope than public ones: `gh workflow run` needs `--ref`, `gh pr checks` needs `actions: read` (#31). `doctor` and `upgrade` check the caller's permissions.
- No OpenSpec CLI on a project without `package.json`: the adapter pins a CLI and archive runs install it (#32).
- Nothing asked the factory after reviews settled, so a PR stayed `WIP:` for hours (#33).
- No `pull_request_target` run for an agent push left `factory/no-go-guard` and `factory/change-ids` at "Waiting for status" (#34). The sweep dispatches both after 10 minutes.
- `doctor`, `init` and `upgrade` compared bytes, so CRLF checkouts looked "different" (fixed: line endings ignored).
- The owner-setup doc was missing (#29).
- The Claude action runs the agent with the Claude GitHub App's token, not the workflow's, so the babysit pass could not read checks on a private repo ("Resource not accessible by integration"). The workflow now saves the CI state first and `pr-feedback.js` reads it (#35). Checked after: the save step ran on the archive pass with no denied calls and no error. A babysit pass that needs it has not run since.

Closed after the proof (software-factory #36, #37, #38, #39):

- The first factory push on a private repo needs the owner's "Approve and run workflows" click: no automatic fix; documented in `owner-setup.md` and the quickstart.
- `init` did not list the files `openspec init` wrote: it now does (`created <path> (adapter setup)`).
- An owner task that edits a protected path: the own-PR route is documented in `owner-setup.md`. The guard still has no exemption, by design.
- `to-tickets` was not in the `Skill` tool's list: `disable-model-invocation` removed. `factory-new-change` now writes a commented `# pr: per-change` hint.
- A review from a bot that `review_bots` did not name failed the run (the action refused the actor) and queued a retry: `allowed_bots` is now every bot by default, with an optional list; `init --review-bot` writes `review_bots`. The bot logins seen so far are in `owner-setup.md`.

Still open:

- The owner step "require the checks in a ruleset" says the checks exist only after a second PR has run (the quickstart says so too); no automatic help, and `doctor` cannot tell you the picker is empty.
- After the revert push on PR #19 the guard and change-ids statuses did not turn green; close and reopen fixed it. Cause not found.
- The Sentry login (`sentry`) was not findable from the repo; the owner-setup doc now explains how to read a login from a PR.
