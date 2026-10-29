# Tasks: Plan in a session, build without the owner

Built in interactive sessions: every task touches a `no_go` path.

## 1. Checks

- [x] 1.1 Check what the plan depends on and record each answer in `handover.md`:
  - `gh issue create --parent` and `--blocked-by` exist and work on this repo (local `gh` is 2.86.0; the article says 2.94+). Upgrade local `gh` and note the version the Actions runner ships.
  - The licence of mattpocock/skills allows adapting `to-tickets` into this repo, and what attribution it needs.
  - `openspec archive -y` runs headless in the factory job (no prompt, no network), and `openspec/specs/**` and `openspec/changes/archive/**` are outside the `no_go` baseline (they are as of 2026-10-29).
  - A label the skill adds through the owner's local `gh` login fires `issues: labeled` with the owner as `sender` (the router's owner check depends on it).

## 2. Guards

- [x] 2.1 Git hooks in `.githooks/`, installed by the root `prepare` script (`scripts/install-git-hooks.js` sets `core.hooksPath`): `pre-commit` refuses a commit while the branch is `main`; `pre-push` refuses any push whose remote ref is `refs/heads/main`. Git reports the real branch and target ref, so nothing parses shell commands. (A PreToolUse command parser was tried first; Seer found a new bypass in each of four review rounds on #743, so the owner chose git hooks.) They also stop the owner's own commits and pushes to `main`; `--no-verify` skips them.
      Demo: on `main`, `git commit --allow-empty -m x` is refused; on a feature branch it runs.
      Acceptance: a test runs the hook on a `main` and a feature checkout and on each refspec form; removing the `main` check fails it. Remove the `verify-branch-before-commit` memory once merged.
- [x] 2.2 `scripts/mem-log.js` refuses to write while `HEAD` is `main` (exit 1, message: switch to the feature branch first). The `handover` skill (step 4 before step 5) and the `resume` skill's "When the task is done" log before committing, so the entry is in the task's commit.
      Demo: on `main`, `node scripts/mem-log.js WORKFLOW a b` exits 1 and `memory.jsonl` is unchanged.
      Acceptance: mem-log test for `main` (refused, file untouched) and a feature branch (appended).

## 3. Tickets

- [x] 3.1 `.claude/skills/to-tickets/SKILL.md`, adapted from mattpocock/skills `to-tickets`: read the change's `proposal.md`, `design.md` and spec deltas; slice into vertical tasks (expand-migrate-contract for wide refactors); quiz the owner (granularity, real blocking edges, a demo per task); then write `tasks.md` and publish the issues, blockers first, as sub-issues of the tracking issue (`node scripts/factory-issue.js <id>`) with `--blocked-by`. Each task line ends with its issue, e.g. `(#812)`. Last step: open the plan PR labelled `factory:<id>` and `factory-ready` (task 4.2 makes its merge start the build). Tickets never carry `factory:<id>`, which marks the tracking issue.
      Demo: run on a small change; `tasks.md` and the sub-issues match, blocking links visible on GitHub (exercised by 6.1).
      Blocked by: 1.1.
- [x] 3.2 `run-spec` adds `Closes #<n>` to the PR body for each task line it lands that carries an issue number; on a per-change PR, each task adds its line to the body.
      Demo: merging a factory PR closes its ticket.
      Acceptance: a test of the issue-number parse (in `scripts/factory-issue.js` beside `issueFromProposal`).
      Blocked by: 3.1.

## 4. Auto-start

- [x] 4.1 `factory.yml` adds `issues: [labeled]` (beside `unlabeled`). The label is `factory-ready`, not `factory:ready`: `changeFromLabels` would read `factory:ready` as the change id `ready`. The router routes `factory-ready` added by the owner on a `factory:<id>` tracking issue as a dispatch of `<id>`, and ignores it from anyone else, on an issue without `factory:<id>`, or while `needs-human` or `factory-retry` is on it. A change with an open factory PR routes to `none` (the PR's own events drive it).
      Demo: adding the label starts the first task with no `gh workflow run`.
      Acceptance: router tests for each case; `factory-workflows.test.js` for the trigger. AGENTS.md "Factory" names the label as the way to start a change.
- [ ] 4.2 The owner merging the plan PR starts the build. `tasks.md` must be on `main` before the router can read it, so a `factory-ready` label on the tracking issue added before the plan merges finds no task. Instead `to-tickets` labels its plan PR `factory:<id>` and `factory-ready`, and `mergedRoute` starts change `<id>` when such a PR merges with the owner as `merged_by`, whoever authored it. A factory PR keeps its current merge route; an unmerged or non-owner merge starts nothing. Found while writing 3.1 (2026-10-29).
      Demo: merging a labelled plan PR starts the first task with no other owner action.
      Acceptance: router tests for an owner merge, a non-owner merge, a closed-unmerged PR and a plan PR without `factory-ready`; AGENTS.md "Factory" names both ways to start.
      Blocked by: 4.1.

## 5. Archive

- [ ] 5.1 When no unchecked task is left, the router routes `mode: archive` (a Claude run) instead of marking the PR ready. `run-spec` gets an archive section: reconcile the spec delta with `openspec/specs/` and what was built, `openspec validate <id>`, `openspec archive <id> -y`, `Closes #<tracking issue>` in the PR body. Per-change: commit on the PR branch, then the route job drops `WIP:` as today. Per-task: open one archive PR labelled `factory:<id>`. A failed validate escalates.
      Demo: the last task of a change leads to an archive commit without an owner session.
      Archiving moves the change folder, so `tasks.md` leaves `openspec/changes/<id>/`: `nextTask` (contents API on the PR branch, file on `main`), the sweep, the `(owner)` check, `factory-escalate.js` and `mergedRoute` treat an existing `openspec/changes/archive/*-<id>/` as "finished, no task left" instead of failing on the 404.
      Acceptance: router tests for both modes, for an already-archived change (`none`), for an archived per-change branch (marked ready, no task) and for a merged archive PR on `main` (`none`); a sweep test for an archived branch; the per-change spec requirement's "marking the PR ready" is updated to follow the archive step (MODIFIED delta re-checked against `openspec/specs/agent-factory-runner/spec.md` at build time).

## 6. Live proof

- [ ] 6.1 A throwaway two-task `pr: per-change` change goes from `/to-tickets` to an archived change: the owner approves the slices, the label starts it, both tasks and the archive land on one PR, the merge closes both tickets and the tracking issue. Owner input: the quiz and one merge.
      Blocked by: 2.1, 2.2, 3.2, 4.1, 4.2, 5.1.
