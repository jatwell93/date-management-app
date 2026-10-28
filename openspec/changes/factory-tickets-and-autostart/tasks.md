# Tasks: Plan in a session, build without the owner

Built in interactive sessions: every task touches a `no_go` path.

## 1. Checks

- [ ] 1.1 Check what the plan depends on and record each answer in `handover.md`:
  - `gh issue create --parent` and `--blocked-by` exist and work on this repo (local `gh` is 2.86.0; the article says 2.94+). Upgrade local `gh` and note the version the Actions runner ships.
  - The licence of mattpocock/skills allows adapting `to-tickets` into this repo, and what attribution it needs.
  - `openspec archive -y` runs headless in the factory job (no prompt, no network), and `openspec/specs/**` and `openspec/changes/archive/**` are outside the `no_go` baseline (they are as of 2026-10-29).
  - A label the skill adds through the owner's local `gh` login fires `issues: labeled` with the owner as `sender` (the router's owner check depends on it).

## 2. Guards

- [ ] 2.1 `.claude/hooks/main-guard.sh`, registered as a Bash PreToolUse hook in `.claude/settings.json`: block `git commit` and `git push` while `HEAD` is `main`, and any `git push` whose refspec targets `main` (`origin main`, `HEAD:main`, `:main`). Exit with a message naming the branch to create.
      Demo: on `main`, `git commit --allow-empty -m x` is refused; on a feature branch it runs.
      Acceptance: a test runs the hook on a `main` and a feature checkout and on each refspec form; removing the `main` check fails it. Remove the `verify-branch-before-commit` memory once merged.
- [ ] 2.2 `scripts/mem-log.js` refuses to write while `HEAD` is `main` (exit 1, message: switch to the feature branch first). The `handover` skill (step 4 before step 5) and the `resume` skill's "When the task is done" log before committing, so the entry is in the task's commit.
      Demo: on `main`, `node scripts/mem-log.js WORKFLOW a b` exits 1 and `memory.jsonl` is unchanged.
      Acceptance: mem-log test for `main` (refused, file untouched) and a feature branch (appended).

## 3. Tickets

- [ ] 3.1 `.claude/skills/to-tickets/SKILL.md`, adapted from mattpocock/skills `to-tickets`: read the change's `proposal.md`, `design.md` and spec deltas; slice into vertical tasks (expand-migrate-contract for wide refactors); quiz the owner (granularity, real blocking edges, a demo per task); then write `tasks.md` and publish the issues, blockers first, as sub-issues of the tracking issue (`node scripts/factory-issue.js <id>`) with `--blocked-by`. Each task line ends with its issue, e.g. `(#812)`. Last step: add `factory:ready` to the tracking issue (task 4.1).
      Demo: run on a small change; `tasks.md` and the sub-issues match, blocking links visible on GitHub.
      Blocked by: 1.1.
- [ ] 3.2 `run-spec` adds `Closes #<n>` to the PR body for each task line it lands that carries an issue number; on a per-change PR, each task adds its line to the body.
      Demo: merging a factory PR closes its ticket.
      Acceptance: a test of the issue-number parse (in `scripts/factory-issue.js` beside `issueFromProposal`).
      Blocked by: 3.1.

## 4. Auto-start

- [ ] 4.1 `factory.yml` adds `issues: [labeled]` (beside `unlabeled`). The router routes `factory:ready` added by the owner on a `factory:<id>` tracking issue as a dispatch of `<id>`, and ignores it from anyone else, on an issue without `factory:<id>`, or while `needs-human` or `factory-retry` is on it. A change with an open factory PR routes to `none` (the PR's own events drive it).
      Demo: adding the label starts the first task with no `gh workflow run`.
      Acceptance: router tests for each case; `factory-workflows.test.js` for the trigger. AGENTS.md "Factory" names the label as the way to start a change.

## 5. Archive

- [ ] 5.1 When no unchecked task is left, the router routes `mode: archive` (a Claude run) instead of marking the PR ready. `run-spec` gets an archive section: reconcile the spec delta with `openspec/specs/` and what was built, `openspec validate <id>`, `openspec archive <id> -y`, `Closes #<tracking issue>` in the PR body. Per-change: commit on the PR branch, then the route job drops `WIP:` as today. Per-task: open one archive PR labelled `factory:<id>`. A failed validate escalates.
      Demo: the last task of a change leads to an archive commit without an owner session.
      Acceptance: router tests for both modes and for an already-archived change (`none`); the per-change spec requirement's "marking the PR ready" is updated to follow the archive step (MODIFIED delta re-checked against `openspec/specs/agent-factory-runner/spec.md` at build time).

## 6. Live proof

- [ ] 6.1 A throwaway two-task `pr: per-change` change goes from `/to-tickets` to an archived change: the owner approves the slices, the label starts it, both tasks and the archive land on one PR, the merge closes both tickets and the tracking issue. Owner input: the quiz and one merge.
      Blocked by: 2.1, 2.2, 3.2, 4.1, 5.1.
