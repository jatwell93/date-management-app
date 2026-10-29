---
name: run-spec
description: >-
  Implement exactly one unchecked task of an OpenSpec change, unattended, and open
  a PR for it: check nothing is already in flight, read the handover and the task,
  implement and test it, run the gate and the no_go check, tick the task, update
  handover.md, push and open a PR labelled factory:<id>. Escalate with needs-human
  instead of guessing. Used by the factory runner (.github/workflows/factory.yml)
  as "/run-spec <change-id>"; also usable locally to dry-run the factory.
---

# Run one spec task

You are running without a human at the keyboard. Nobody will answer a question.
When you would normally ask, escalate (below) and stop. Never merge: the owner's
merge is the only gate before production.

## 1. Check nothing is in flight

- `gh pr list --state open --label "factory:<id>" --json number,url`. If any PR is
  listed, print "factory:<id> PR already open: <url>" and stop. One task per change
  at a time. Exception: a per-change run (below) continues the PR it names.
- Read `openspec/changes/<id>/handover.md`. If "Waiting on the user" lists a
  decision that blocks the next task, and the tracking issue (below) has no
  answer to it, stop and say which.
- Read the tracking issue: `n=$(node scripts/factory-issue.js <id>)`, then
  `gh issue view "$n" --comments`. If it still has `needs-human`, stop: the
  owner has not answered. If the owner (`jatwell93`) commented after the
  factory's last escalation, that comment is the decision. Follow it for this
  task, and record it in `handover.md` under "Decisions" (the question, the
  answer, and a link to the comment) in this task's PR.

## 2. Pick the task

- Read the first unchecked task (`- [ ]`) in `openspec/changes/<id>/tasks.md`,
  the `proposal.md` sections it cites, and `AGENTS.md`.
- **No unchecked task left:** archive the change ("Archive a finished change",
  below) instead.
- **Operator tasks are not yours.** A task for the owner (phase 0 style "Owner
  ..."), a vendor console, a production migration, a deploy, or anything needing
  production credentials: escalate. A task marked `(owner)` right after its
  number (`- [ ] 2.3 (owner) ...`) is the owner's by definition: escalate it
  without reading further. The router normally escalates these itself
  (`scripts/factory-escalate.js`) and never starts a run for them.
- **no_go paths are not yours.** If the task can only be done by editing a path
  that `node scripts/check-no-go.js --change <id>` protects (the baseline plus the
  change's `## Autonomy` list), escalate before writing code.
- If the task is ambiguous enough that two reasonable readings give different
  behavior, escalate with both readings.

## 3. Implement it

- `git switch -c feature/factory-<id>-<task-number>` from an up-to-date `main`.
- Do exactly this one task. Reuse existing code; add or adjust tests for what you
  touch, and make sure each new test fails without your change.
- Keep functions small and flat. CodeScene's PR gate fails on complex or deeply
  nested functions, and you cannot run it here; `npm run lint` only catches the
  worst cases (`complexity` 8, `max-depth` 3). Aim for single-purpose functions
  with one level of nesting, and early returns over nested branches.
- Parse with an existing parser (the TypeScript compiler API, `JSON.parse`,
  `URL`) instead of writing a tokenizer or a regex-driven parser. The first
  factory PR (#691) needed two fix rounds because of a hand-written tokenizer.
- Run the gate for the packages you changed (`AGENTS.md` §4):
  `npm run test:frontend:diff`, `npm run test:db`,
  `(cd workers && npm run typecheck)`, `npm run test:tooling`, and always
  `npm run lint`. Fix failures; do not skip or weaken a test to pass.
- Tick the task in `tasks.md` and rewrite `handover.md` with the `handover`
  skill's template (skip its memory-log step: the runner has no memory store).
- Commit with conventional messages.

## 4. Check, push, open the PR

1. `node scripts/check-no-go.js --change <id>`. On any non-zero exit, do not
   push. Escalate with the listed paths (exit 1) or the error (exit 2, for
   example an unreadable `no_go` list).
2. `git push -u origin HEAD`.
3. Create the label if it is missing:
   `gh label create "factory:<id>" --color 5319E7 --description "Factory task for <id>"`
   (ignore "already exists").
4. `gh pr create --base main --label "factory:<id>" --title "<conventional title>" --body-file <file>`,
   with the body written in the `pr` skill's template. Say in the body that this
   is a factory PR for task `<task-number>` of `<id>` and that it waits for the
   owner's merge. Add the line that
   `node scripts/factory-ticket.js <id> <task-number>` prints (`Closes #<n>`, or
   nothing when the task has no ticket), so the merge closes the task's ticket.
5. Print the PR URL and stop. Review handling runs as separate `babysit-pr`
   passes started by review and CI events; do not wait for CI here.

## One PR per change (`pr: per-change`)

A change whose `## Autonomy` block says `pr: per-change` keeps every task on one
PR, which the owner merges once. The prompt says when a run is one of these, and
names the PR, its branch and the task.

- **First task** (no PR named): as above, but title the PR `WIP: <conventional
title>` and say in the body that later tasks land on this PR. Not a draft:
  Seer and Copilot skip drafts. The router drops `WIP:` when the last task is
  done and reviews have settled.
- **Later task** (PR named): re-check the state first, because the run may have
  waited in the queue. The PR must still be open, and the task named in the
  prompt must still be the first unchecked task in the branch's `tasks.md`. If
  not, print why and stop. Work on the checked-out PR branch; do not create a
  branch or a new PR. The workflow has already merged `main` into it when it
  could; if the prompt says the base is older, say so in the PR body.
- **Every task commit** ends with the trailer `Factory-Task: <task-number>`
  (beside `Co-Authored-By`). `scripts/babysit-round.js` counts babysit rounds
  only after the newest one, so each task gets its own 5 rounds.
- Push with `git push`, then update the PR body (`gh pr edit <n> --body-file`)
  to list the tasks done so far. Keep each task's `Closes #<n>` line from
  `scripts/factory-ticket.js`: the PR closes every ticket it lands.

## Archive a finished change

The prompt says when a run is an archive run: every numbered task in
`tasks.md` is ticked. Archiving moves `openspec/changes/<id>/` to
`openspec/changes/archive/<date>-<id>/` and merges its spec deltas into
`openspec/specs/`.

1. **Re-check.** `openspec/changes/<id>/tasks.md` must still exist and have no
   unchecked numbered task. If not, print why and stop.
2. **Branch.** On a per-change PR (the prompt names it), work on the checked-out
   PR branch. Otherwise `git switch -c feature/factory-<id>-archive` from an
   up-to-date `main`.
3. **Check `no_go` first:** `node scripts/check-no-go.js --change <id>`. After
   the archive, the change's own `no_go` list has moved and no longer applies,
   so this is the last check against it. On any non-zero exit, escalate.
4. **Reconcile the spec deltas.** For each `openspec/changes/<id>/specs/<capability>/spec.md`,
   compare it with `openspec/specs/<capability>/spec.md` and with the code the
   tasks built. Where the build differs from the delta, change the delta to
   say what was built. Never change code here. A `MODIFIED` requirement must use
   the exact header of the requirement in `openspec/specs/`, and must still
   carry every scenario of it that holds. If the build and the delta disagree
   on behaviour and you cannot tell which is right, escalate with both.
5. **Validate:** `npx openspec validate <id> --strict`. Fix what it reports in
   the delta, at most twice. If it still fails, escalate with its output and
   push nothing. A change with no `openspec/changes/<id>/specs/` folder (a
   tooling or doc-only change) has no delta to validate: skip this step,
   because strict validation rejects a change without deltas.
6. **Archive:** `npx openspec archive <id> -y`, or with no `specs/` folder
   `npx openspec archive <id> -y --skip-specs`. Check that `git status` shows
   the folder moved under `openspec/changes/archive/` and any merged
   `openspec/specs/` files, then `npx openspec validate --specs --strict`.
7. **Commit** `docs(openspec): archive <id>`. On a per-change PR, add the
   trailer `Factory-Task: archive` (beside `Co-Authored-By`), so the archive
   gets its own babysit rounds.
8. **Push and PR.** Run `node scripts/check-no-go.js` again (the baseline), then
   push.
   - Per-change PR: `git push`, then update the PR body with
     `gh pr edit <n> --body-file` to say the change is archived and add
     `Closes #<tracking issue>` (`node scripts/factory-issue.js <id>`). Keep
     every task's `Closes` line. The router drops `WIP:` and mentions the owner
     once reviews settle.
   - Otherwise: `gh pr create --base main --label "factory:<id>" --title "docs(openspec): archive <id>" --body-file <file>`.
     The body says this is the factory's archive PR for `<id>`, lists the
     spec deltas reconciled, and ends with `Closes #<tracking issue>`.
9. Print the PR URL and stop.

## Escalate

1. Find the change's tracking issue: `n=$(node scripts/factory-issue.js <id>)`.
   It reuses the issue labelled `factory:<id>`, else adopts the issue the
   proposal names in its `## Autonomy` block (`issue: N`), else creates one.
2. `gh issue edit "$n" --add-label needs-human`, then comment: `@jatwell93` and
   the task number, what blocks it, the options you see, and your
   recommendation. End with: "Answer here, then remove `needs-human` to resume."
3. If a PR already exists for the task, add `needs-human` to it as well, except
   on a per-change PR: there the tracking issue's label alone holds the change,
   so the owner's one removal resumes it.
4. Stop. No task of this change starts while the issue has `needs-human`
   (`scripts/factory-route.js`); the owner removing it resumes the change, and
   the next run reads the answer (section 1).

## Never

- Merge, approve, or enable auto-merge; call `gh api`.
- Push to `main`, force-push, or rewrite pushed commits.
- Edit a `no_go` path, even to fix a failing check.
- Read `.env` files or secrets, run `npm run test:prod`, or use Doppler.
