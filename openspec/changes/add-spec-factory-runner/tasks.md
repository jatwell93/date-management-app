# Tasks: Spec factory runner

## Phase 0 — Owner setup (manual)

- [ ] 0.1 Owner stores `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) as a repository secret.
- [ ] 0.2 Owner installs the Claude GitHub App on the repository.
- [ ] 0.3 Owner creates labels `factory:run` and `needs-human`.
- [ ] 0.4 Owner sets the `main` ruleset to require 1 approving review with an admin-role bypass, and picks the Dependabot path (workflow approves its own PR, or Dependabot joins the bypass).
      Acceptance: a Claude-App-authored test PR cannot be merged without the owner's approval.

## Phase 1 — One task, started by hand

- [ ] 1.1 Add `.claude/skills/run-spec/SKILL.md`. It runs `/resume <id>`, implements exactly one unchecked task, gates, pushes, opens a PR labelled `factory:<id>`, ticks the task, and updates `handover.md`. It refuses operator tasks with `needs-human`, and before pushing runs `scripts/check-no-go.js`, which fails if `git diff --name-only origin/main...HEAD` (merge base, not the moving tip) matches a `no_go` pattern (default: `.github/**`, `database/migrations/**`, `scripts/database-backup.sh`).
      Acceptance: the skill names every step above; `check-no-go.js` has tests for matching, non-matching and default patterns.
- [ ] 1.2 Add `.github/workflows/factory.yml` with a `workflow_dispatch` input `change_id`. It runs `claude-code-action@v1` with `prompt: /run-spec <change_id>`, with no production secrets, token permissions limited to contents, pull-requests and issues write, and `--disallowedTools` for `Bash(gh pr merge:*)`, `Bash(gh pr review:*)` and `Bash(gh api:*)`. New-task runs share the concurrency group `factory-<change_id>` with `cancel-in-progress: false`, and `run-spec` exits without changes when an open `factory:<id>` PR already exists.
      Acceptance: the workflow passes `actionlint` locally; a static test asserts it references no `prd`, `PRODUCTION` or `NEON_API_KEY` secret, carries the deny-list, and sets the per-change concurrency group.
- [ ] 1.3 Write the pilot change `add-agent-route-map-and-tooling-polish` (3 tasks, `merge: human`, no task touching a `no_go` path) and validate it with `--strict`.
- [ ] 1.4 Dispatch the factory on the pilot. One PR is opened by the Claude App, CI runs on it, and `handover.md` is updated.
      Acceptance: the PR link and run link are recorded in `handover.md`.

## Phase 2 — Chain and babysit on events

- [ ] 2.1 Add a `pull_request: closed` trigger: when a `factory:<id>` PR merges, start the next task.
- [ ] 2.2 Add `pull_request_review`, `pull_request_review_comment` and `workflow_run: completed` (listing the CI workflows; `check_suite` does not fire for Actions-created suites) triggers that run one `babysit-pr` pass for `factory:<id>` PRs. Use `allowed_bots: sentry[bot],codescene-delta-analysis[bot],copilot-pull-request-reviewer[bot]`, and a concurrency group per PR. Update `babysit-pr` so each pass runs `scripts/check-no-go.js` before pushing, adds a `Babysit-Round: N` trailer to its commits, and stops with `needs-human` once the PR's highest trailer reaches 5.
      Acceptance: a static test asserts the concurrency group and the bot allowlist; a test for the round reader covers no trailers, rounds 1–4, and 5.
- [ ] 2.3 Run the pilot's remaining two tasks through the chain without the owner typing anything except merges.

## Phase 3 — Escalation and digest

- [ ] 3.1 `needs-human`: label, `@`-mention the owner, record the decision in `handover.md`, and stop the run (later tasks wait for the decision).
- [ ] 3.2 Add a daily scheduled job that posts open `factory:*` PRs and `needs-human` items as one comment on the tracking issue.

## Phase 4 — Close out

- [ ] 4.1 Update AGENTS.md §5 (factory usage, `no_go`) and the store of memories.
- [ ] 4.2 `openspec validate add-spec-factory-runner --strict`; archive once merged.
