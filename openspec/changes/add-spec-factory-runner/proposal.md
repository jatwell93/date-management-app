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
  - `pull_request_review`, `pull_request_review_comment` and `check_suite: completed` on a `factory:<id>` PR run a `babysit-pr` pass. One pass per PR runs at a time (concurrency group). Each PR gets at most 5 fix rounds.
  - `pull_request: closed` with `merged == true` on a `factory:<id>` PR starts the next task.
- **A `run-spec` skill** used by the runner. It runs `/resume <id>` and implements exactly one task. It then runs the gate, pushes, opens a PR labelled `factory:<id>`, ticks the task, and updates `handover.md`.
- **Escalation, not stalling.** A task that needs a decision, or that touches a `no_go` path, gets the `needs-human` label and an `@`-mention to the owner, and its decision is recorded in `handover.md`. Every later task waits for it, so the run stops until the owner answers. A run never merges.
- **An `## Autonomy` block in `proposal.md`** (already described in AGENTS.md §5) is extended with `no_go` paths. `merge` defaults to `human`.

## Safety

The runner is safe because of what it can reach, not because of permission prompts:

- **GitHub token:** contents, pull-requests and issues write only. The `main` ruleset already blocks direct pushes and requires 6 checks.
- **No production secrets.** The workflow gets no Doppler `prd` token and no Neon or Stripe production credentials, so it cannot read or write production. If tests need secrets, use a dedicated Doppler config with development values only.
- **`merge: auto` stays disabled.** The `production` environment has a wait timer and a branch policy but **no required reviewers**, and a push to `main` deploys both Workers and Pages to production. Until production requires a reviewer, the human merge is the only human gate before a production deploy, so the runner never merges.
- **PRs must trigger CI.** A PR opened with the default `GITHUB_TOKEN` does not trigger other workflows. The runner pushes and opens PRs as the Claude GitHub App, so the required checks run.

## Autonomy

```yaml
merge: human
no_go: [.github/workflows/workers-deploy.yml, .github/workflows/pages-deploy.yml]
```

## Out of scope

- Running tasks in parallel. One task per change at a time; independent tasks can come later.
- `merge: auto` (blocked as described under Safety).
- Tasks an operator must do: vendor consoles, production migrations, deploys. `run-spec` refuses them with `needs-human`.

## Manual setup (owner)

1. Run `claude setup-token`, then store the result as repository secret `CLAUDE_CODE_OAUTH_TOKEN`.
2. Install the Claude GitHub App on the repository (`/install-github-app`).
3. Create the labels `factory:run`, `needs-human` and `factory:<id>` (the workflow can create `factory:<id>` itself).

## Pilot

Phase 1 is proven on a new, small change written for the factory: `add-agent-navigation-and-lint-gate`. It has three low-risk tasks from the retro:

- a route-to-line map for `workers/src/index-minimal.ts`
- an ESLint job in the required checks
- removing the missing `writing-for-agents` step from the retro skill

Its setting is `merge: human`.
