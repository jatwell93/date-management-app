# Handover: extract-software-factory

Updated: 2026-11-19 · main at dcfafa5d1 · software-factory main at `c099f2c`

## State

Groups 1 to 4 are done. `jatwell93/software-factory` (public, GPL-3.0) holds the schema, adapter contract, OpenSpec adapter, scripts, reusable workflows, five skills, digest and the setup CLI. This repo runs it pinned to `1b55a7946865384265a3fe07b8f53f400420f6e1` and needs `upgrade` to move (see Next).

Task 5.1 ran on the private Python repo `jatwell93/time-planner`: `init`, `doctor`, the owner steps, plan PR #8, then change `weekly-plan-model` ran to a merged PR #9 (tasks 1.1 to 1.3 and the archive on one per-change PR). It found six factory bugs, all fixed and live in time-planner at pin `c099f2c`: private-repo token scopes (software-factory #31), no OpenSpec CLI on a project without `package.json` (#32), the factory not asked after reviews settle (#33), required statuses never posted for a head (#34), plus earlier #29 (owner-setup doc) and CRLF compare. The full log, one entry per gap, is `C:\Users\josha\proof-5-1-log.md` (outside both repos: copy it into "5.1 gaps" below when the proof ends).

A second change on time-planner is being planned in the builder session, to prove the fixes end to end. Do not tick 5.1 until it merges.

## Next

1. Task 5.1 close: after the second time-planner change merges, read the log, write "5.1 gaps" here, tick 5.1 in `tasks.md`.
2. Factory follow-ups, small PRs in software-factory: `docs/owner-setup.md` says the first factory push on a private repo needs "Approve and run workflows" (no automatic fix); `init` lists the files `openspec init` created (it lists only its own).
3. Task 5.2: quickstart, and move `docs/factory-guide.md` into the factory repo, using the 5.1 gaps.
4. Task 6.1: PAUL and GSD research. Use `https://github.com/open-gsd/gsd-core` for GSD only: an older GSD distribution is retired and may be compromised. Read, never install or run anything from it: no `npx`, no install script. Read its files through `gh api` or a web fetch, write the findings (task, status and archive formats; what the adapter interface covers or lacks), build no adapter.
5. Move this repo's pin: run `upgrade` from a factory checkout at the target commit (it raises permissions and the change-ids trigger). Do it after the proof, not mid-run.

## Open PRs

- None for this change.

## Waiting on the user

- Merge the time-planner second change's plan PR and its final PR; click "Approve and run workflows" on factory pushes. Count and log each touch.
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

Written when 5.1 closes, from the log (see State).
