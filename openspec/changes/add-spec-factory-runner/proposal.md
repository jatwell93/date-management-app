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
  - Each babysit pass runs `scripts/check-no-go.js` before pushing, like `run-spec`. Its round count survives between runs: every babysit commit carries a `Babysit-Round: N` trailer, the next pass reads the highest N from the PR's commits, and at 5 it stops with `needs-human`.
- **A `run-spec` skill** used by the runner. It runs `/resume <id>` and implements exactly one task. It then runs the gate, pushes, opens a PR labelled `factory:<id>`, ticks the task, and updates `handover.md`.
- **Escalation, not stalling.** A task that needs a decision, or that touches a `no_go` path, gets the `needs-human` label and an `@`-mention to the owner, and its decision is recorded in `handover.md`. Every later task waits for it, so the run stops until the owner answers. A run never merges.
- **An `## Autonomy` block in `proposal.md`** (already described in AGENTS.md §5) is extended with `no_go` paths. `merge` defaults to `human`.

## Safety

The runner is safe because of what it can reach, not because of permission prompts:

- **GitHub token:** contents, pull-requests and issues write only. The `main` ruleset already blocks direct pushes and requires 6 checks.
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
```

`no_go` is checked against the diff, not trusted to the prompt: `run-spec` runs `git diff --name-only origin/main...HEAD` (against the merge base, so files that changed only on `main` never count) before pushing and refuses (with `needs-human`) if any path matches. The default for a change with no `no_go` list is the list above.

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
- in `babysit-pr`, background waits run a pinned copy of `pr-feedback.js`, so a branch switch cannot change the script mid-wait
- `cleanup-merged.js` prints the manual delete command for each branch it keeps

Its setting is `merge: human`. The retro's ESLint required-check job is not a pilot task. It edits `.github/**`, so it stays interactive work for the owner. The retro skill is third-party (`skills-lock.json`), so it is not edited here.
