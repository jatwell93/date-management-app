# Handover: extract-software-factory

Updated: 2026-11-20 · main at a4579cab9 · software-factory main at `8791ba1`

## State

Groups 1 to 4 are done. `jatwell93/software-factory` (public, GPL-3.0) holds the schema, adapter contract, OpenSpec adapter, scripts, reusable workflows, five skills, digest and the setup CLI. This repo runs it pinned to `1b55a7946865384265a3fe07b8f53f400420f6e1` and needs `upgrade` to move (see Next).

Task 5.1 ran on the private Python repo `jatwell93/time-planner`: `init`, `doctor`, the owner steps, plan PR #8, then change `weekly-plan-model` ran to a merged PR #9 (tasks 1.1 to 1.3 and the archive on one per-change PR). It found six factory bugs, all fixed and live in time-planner at pin `c099f2c`: private-repo token scopes (software-factory #31), no OpenSpec CLI on a project without `package.json` (#32), the factory not asked after reviews settle (#33), required statuses never posted for a head (#34), plus earlier #29 (owner-setup doc) and CRLF compare. The full log, one entry per gap, is `C:\Users\josha\proof-5-1-log.md` (outside both repos: copy it into "5.1 gaps" below when the proof ends).

The second change, `habit-tracking`, ran to a merged per-change PR #19 (tasks 1.1 to 1.3 plus the archive) and found two more bugs: the babysit pass could not read CI on a private repo (software-factory #35 saves the CI state before the agent starts) and the no-go guard fails an owner edit of a protected path made on a factory PR (worked around: the owner task went on its own PR, time-planner #20). Time-planner is pinned to `8791ba1`. 5.1 is ticked; the gaps are below.

## Next

1. Factory follow-ups, small PRs in software-factory: `docs/owner-setup.md` says the first factory push on a private repo needs "Approve and run workflows" (no automatic fix); `init` lists the files `openspec init` created (it lists only its own); an owner task that edits a protected path needs a documented route (own PR to `main`) or a guard exemption; `to-tickets` is invisible to the `Skill` tool (`disable-model-invocation`); `factory-new-change` scaffolds no `pr:` key.
2. Task 5.2: quickstart, and move `docs/factory-guide.md` into the factory repo, using the 5.1 gaps.
3. Move this repo's pin: run `upgrade` from a factory checkout at the target commit (full 40-character SHA; it raises permissions and the change-ids trigger). Do it after 5.2 starts, not mid-run.
4. Follow-up changes `add-paul-adapter` and `add-gsd-adapter` (task 6.1 is done; design.md section 4).

## Open PRs

- None for this change.

## Waiting on the user

- Actions approval policy in this repo (`first_time_contributors_new_to_github` may stop the click); also require `factory/change-ids` in this repo's ruleset and enable "Block force pushes" on `main`, if not done.
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

Open (follow-ups, item 1 of Next):

- The first factory push on a private repo needs the owner's "Approve and run workflows" click.
- `init` does not list the files `openspec init` wrote (config, specs and changes `.gitkeep`, 6 commands, 6 skills).
- The owner step "require the checks in a ruleset" does not say the checks exist only after a second PR has run; the picker is empty until then.
- The no-go guard fails an owner's own edit of a protected path on a factory-labelled PR. Today's route: an own PR to `main`.
- After the revert push on PR #19 the guard and change-ids statuses did not turn green; close and reopen fixed it. Cause not found.
- `to-tickets` is not in the `Skill` tool's list; `factory-new-change` writes no `pr:` key; the Sentry login (`sentry`) was not findable from the repo.
