# Handover: add-spec-factory-runner

Updated: 2026-10-21 · main at 05cace3a

## State

The proposal has been drafted and awaits owner approval. PR #675 (agent-run PR loop: `pr-feedback`, `cleanup-merged`, the `babysit-pr`, `handover` and `resume` skills) is merged. PR #677 (`waitingOn` and `quietUntil` in `pr-feedback`) is open.

## Next

Phase 0 is the owner's setup. After that comes task 1.1, the `run-spec` skill.

## Open PRs

- #677 feat(tooling): say why a PR is not settled in pr-feedback. The babysit job is running.

## Waiting on the user

- Approve the proposal. Decisions already made on 2026-10-21: billing uses the subscription OAuth token, merges default to `human`, and the pilot is a new small spec.
- Phase 0: store the `CLAUDE_CODE_OAUTH_TOKEN` secret, install the Claude GitHub App, and create the labels.

## Learnings

- The `production` environment has `wait_timer` and `branch_policy` but no required reviewers. A push to `main` deploys Workers and Pages to production with no further human gate (`.github/workflows/pages-deploy.yml:147-151`, `.github/workflows/workers-deploy.yml:73`). Do not enable `merge: auto` until that changes.
- A PR opened with the default `GITHUB_TOKEN` does not trigger other workflows. The factory must push as the Claude GitHub App.
