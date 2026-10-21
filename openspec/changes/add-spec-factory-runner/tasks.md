# Tasks: Spec factory runner

## Phase 0 — Owner setup (manual)

- [ ] 0.1 Owner stores `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) as a repository secret.
- [ ] 0.2 Owner installs the Claude GitHub App on the repository.
- [ ] 0.3 Owner creates labels `factory:run` and `needs-human`.

## Phase 1 — One task, started by hand

- [ ] 1.1 Add `.claude/skills/run-spec/SKILL.md`. It runs `/resume <id>`, implements exactly one unchecked task, gates, pushes, opens a PR labelled `factory:<id>`, ticks the task, and updates `handover.md`. It refuses `no_go` paths and operator tasks with `needs-human`.
      Acceptance: the skill names every step above and has a refusal rule for each case.
- [ ] 1.2 Add `.github/workflows/factory.yml` with a `workflow_dispatch` input `change_id`. It runs `claude-code-action@v1` with `prompt: /run-spec <change_id>`, with no production secrets and token permissions limited to contents, pull-requests and issues write.
      Acceptance: the workflow passes `actionlint` locally; a static test asserts it references no `prd`, `PRODUCTION` or `NEON_API_KEY` secret.
- [ ] 1.3 Write the pilot change `add-agent-navigation-and-lint-gate` (3 tasks, `merge: human`) and validate it with `--strict`.
- [ ] 1.4 Dispatch the factory on the pilot. One PR is opened by the Claude App, CI runs on it, and `handover.md` is updated.
      Acceptance: the PR link and run link are recorded in `handover.md`.

## Phase 2 — Chain and babysit on events

- [ ] 2.1 Add a `pull_request: closed` trigger: when a `factory:<id>` PR merges, start the next task.
- [ ] 2.2 Add `pull_request_review`, `pull_request_review_comment` and `check_suite: completed` triggers that run one `babysit-pr` pass for `factory:<id>` PRs. Use `allowed_bots: sentry[bot],codescene-delta-analysis[bot],copilot-pull-request-reviewer[bot]`, a concurrency group per PR, and a cap of 5 fix commits.
      Acceptance: a static test asserts the concurrency group and the bot allowlist.
- [ ] 2.3 Run the pilot's remaining two tasks through the chain without the owner typing anything except merges.

## Phase 3 — Escalation and digest

- [ ] 3.1 `needs-human`: label, `@`-mention the owner, record the decision in `handover.md`, and stop the run (later tasks wait for the decision).
- [ ] 3.2 Add a daily scheduled job that posts open `factory:*` PRs and `needs-human` items as one comment on the tracking issue.

## Phase 4 — Close out

- [ ] 4.1 Update AGENTS.md §5 (factory usage, `no_go`) and the store of memories.
- [ ] 4.2 `openspec validate add-spec-factory-runner --strict`; archive once merged.
