# Proposal: Spec factory runner

## Why

The goal is to write an OpenSpec change, then step away while agents implement it. A retro of 20 sessions (2026-10-21) found that about 300 of 373 user messages were relay work. PR #675 removed most of that relay from interactive sessions: the agent now pushes, opens PRs, and handles bot reviews itself (`babysit-pr`), and state lives in `handover.md` (`handover`, `/resume`).

Two things still need a human at the keyboard:

1. **A session has to be running.** The laptop shuts down without warning and runs short of memory. Usage limits kill long sweeps of subagents.
2. **Someone has to start the next task.** After a PR merges, nothing picks up the next unchecked task until the user starts a session.

## What changes

- **A GitHub Actions runner** (`.github/workflows/factory.yml`) runs Claude Code via `anthropics/claude-code-action@v1`. It authenticates with the user's subscription (`CLAUDE_CODE_OAUTH_TOKEN`) and works on one task per run, with fresh context each time.
- **Event-driven loop:**
  - `workflow_dispatch` (change id) or the `factory:run` label on a tracking issue starts the next unchecked task.
  - One task at a time per change: new-task runs share the concurrency group `factory-<id>` (queued, never cancelled), and `run-spec` exits without changes when an open `factory:<id>` PR already exists. A repeated trigger therefore cannot take the same task twice.
  - `pull_request_review`, `pull_request_review_comment` and `workflow_run: completed` (for the CI workflows) on a `factory:<id>` PR run a `babysit-pr` pass. Not `check_suite`: GitHub does not start workflows from check suites that Actions itself created, and all CI here is Actions. One pass per PR runs at a time (concurrency group). Each PR gets at most 5 fix rounds.
  - `pull_request: closed` with `merged == true` on a `factory:<id>` PR starts the next task.
  - Each babysit pass is one-shot: it never waits or schedules a check-back. It ignores the quiet window, because every late bot that posts starts its own pass; a pass that waited for quiet would exit on the very review that started it, and nothing would start another. It exits without changes only while a GitHub Actions check is still running, because that check's `workflow_run: completed` event starts the next pass. Pending checks from other apps (CodeScene, Seer) do not hold it: they emit no `workflow_run`, and their results arrive as reviews, which start their own passes. Each pass runs `scripts/check-no-go.js` before pushing, like `run-spec`. Its round count survives between runs: every babysit commit carries a `Babysit-Round: N` trailer, the next pass reads the highest N from the PR's commits, and at 5 it stops with `needs-human`.
- **A `run-spec` skill** used by the runner. It runs `/resume <id>` and implements exactly one task. It then runs the gate, pushes, opens a PR labelled `factory:<id>`, ticks the task, and updates `handover.md`.
- **Escalation, not stalling.** A task that needs a decision, or that touches a `no_go` path, gets the `needs-human` label and an `@`-mention to the owner, and its decision is recorded in `handover.md`. Every later task waits for it, so the run stops until the owner answers. A run never merges.
- **An `## Autonomy` block in `proposal.md`** (already described in AGENTS.md §5) is extended with `no_go` paths. `merge` defaults to `human`.

## Safety

The runner is safe because of what it can reach, not because of permission prompts:

- **GitHub token:** contents, pull-requests and issues write, plus `id-token: write` and `actions: read`. The action needs `id-token` to authenticate the Claude GitHub App via OIDC; it mints an identity token and grants no repository access. `actions: read` lets a babysit pass read failed CI logs. The `main` ruleset already blocks direct pushes and requires 6 checks.
- **No production secrets.** The workflow gets no Doppler `prd` token and no Neon or Stripe production credentials, so it cannot read or write production. If tests need secrets, use a dedicated Doppler config with development values only.
- **`merge: auto` stays disabled.** The `production` environment has a wait timer and a branch policy but **no required reviewers**, and a push to `main` deploys both Workers and Pages to production. Until production requires a reviewer, the human merge is the only human gate before a production deploy, so the runner never merges.
- **"Never merges" is enforced, not just instructed.** Two layers:
  - **Ruleset:** the `main` ruleset requires 1 approving review, with a bypass for the repository admin role only. Factory PRs are authored by the Claude GitHub App, which cannot approve its own PR and has no bypass, so even `gh pr merge` or an enabled auto-merge waits for the owner's approval. The owner's own PRs merge through the admin bypass, as today.
  - **Tool deny-list:** `claude_args` passes `--disallowedTools` for `Bash(gh pr merge:*)`, `Bash(gh pr review:*)` and `Bash(gh api:*)`. The runner gets `gh pr`, `gh issue` and `gh run` subcommands only.
  - **Dependabot:** `dependabot-auto-merge.yml` relies on 0 required approvals, so it must either approve its PR (requires "Allow GitHub Actions to create and approve pull requests") or have Dependabot added to the ruleset bypass. This is decided in task 0.4.
- **PRs must trigger CI.** A PR opened with the default `GITHUB_TOKEN` does not trigger other workflows. The runner pushes and opens PRs as the Claude GitHub App, so the required checks run.

## Autonomy

```yaml
merge: human
no_go:
  - .github/** # every workflow, including factory.yml itself and migration-prep.yml
  - database/migrations/**
  - scripts/database-backup.sh
  - scripts/check-no-go.js # the check itself
  - .claude/** # skills, hooks and settings the runner follows
  - AGENTS.md
  - CLAUDE.md
```

The list above is a fixed baseline, hard-coded in `scripts/check-no-go.js`. A change's own `no_go` entries are added to it and never replace it, so no proposal can drop a protected path. The guard reads the change's entries from `main`'s copy of `proposal.md`, so a PR cannot remove an entry its own change added. The agent's own rules are on the baseline, so a manipulated run cannot rewrite the instructions or the check that constrain later runs.

`no_go` is enforced in two places, and only the second is a gate:

1. **Agent self-check.** `run-spec` and `babysit-pr` run `git diff --name-only --no-renames origin/main...HEAD` before pushing. `--no-renames` lists a renamed file under both its old and new path, so renaming a protected file away cannot hide it. They diff against the merge base, so files that changed only on `main` never count. On a match they refuse with `needs-human`. This saves a wasted PR but is only an instruction.
2. **Required guard check.** `.github/workflows/no-go-guard.yml` runs on `pull_request_target`, so GitHub always uses `main`'s copy of the workflow and of `scripts/check-no-go.js`; a PR cannot edit the check that judges it. It never checks out PR code. It reads the PR's file list from the API (`gh api repos/{owner}/{repo}/pulls/{n}/files --paginate`), checking both `filename` and `previous_filename` so a rename out of a protected path is caught, and fails a factory PR (labelled `factory:*` or authored by the Claude App) that touches a `no_go` path. It is added to the `main` ruleset's required checks, so such a PR cannot merge.

**Workflow edits on a factory branch.** The guard blocks the merge, but a pushed workflow file could still run in CI before merge. The action's FAQ says the Claude App has no write access to workflows, so GitHub would reject that push. Its security doc, though, lists Workflows read & write as requested for future use. Task 0.2 therefore verifies the installed app's permissions. If Workflows write is granted, the runner must use its own `github_token` from an app without it.

## Out of scope

- Running tasks in parallel. One task per change at a time; independent tasks can come later.
- `merge: auto` (blocked as described under Safety).
- Tasks an operator must do: vendor consoles, production migrations, deploys. `run-spec` refuses them with `needs-human`.

## Manual setup (owner)

1. Run `claude setup-token`, then store the result as repository secret `CLAUDE_CODE_OAUTH_TOKEN`.
2. Install the Claude GitHub App on the repository (`/install-github-app`).
3. Create the labels `factory:run`, `needs-human` and `factory:<id>` (the workflow can create `factory:<id>` itself).
4. Set the `main` ruleset to require 1 approving review with an admin-role bypass, and decide how Dependabot auto-merge gets past it.

## Pilot

Phase 1 is proven on a new, small change written for the factory: `add-agent-route-map-and-tooling-polish`. Its three low-risk tasks avoid every `no_go` path:

- `scripts/route-map.js`, which prints a route-to-line map of `workers/src/index-minimal.ts`, with tests so the map cannot go stale
- `pr-feedback.js --summary`, a one-line verdict (settled, waitingOn, actionable count) for logs and the daily digest
- `cleanup-merged.js` prints the manual delete command for each branch it keeps

Its setting is `merge: human`. The retro's ESLint required-check job is not a pilot task. It edits `.github/**`, so it stays interactive work for the owner. The retro skill is third-party (`skills-lock.json`), so it is not edited here.
