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
  at a time.
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
- **No unchecked task left:** the change is complete. Comment on its tracking
  issue (`node scripts/factory-issue.js <id>`) that every task is done and the
  change is ready for the owner to archive, then stop. Never archive it
  yourself.
- **Operator tasks are not yours.** A task for the owner (phase 0 style "Owner
  ..."), a vendor console, a production migration, a deploy, or anything needing
  production credentials: escalate.
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
   owner's merge.
5. Print the PR URL and stop. Review handling runs as separate `babysit-pr`
   passes started by review and CI events; do not wait for CI here.

## Escalate

1. Find the change's tracking issue: `n=$(node scripts/factory-issue.js <id>)`.
   It reuses the issue labelled `factory:<id>`, else adopts the issue the
   proposal names, else creates one.
2. `gh issue edit "$n" --add-label needs-human`, then comment: `@jatwell93` and
   the task number, what blocks it, the options you see, and your
   recommendation. End with: "Answer here, then remove `needs-human` to resume."
3. If a PR already exists for the task, add `needs-human` to it as well.
4. Stop. No task of this change starts while the issue has `needs-human`
   (`scripts/factory-route.js`); the owner removing it resumes the change, and
   the next run reads the answer (section 1).

## Never

- Merge, approve, or enable auto-merge; call `gh api`.
- Push to `main`, force-push, or rewrite pushed commits.
- Edit a `no_go` path, even to fix a failing check.
- Read `.env` files or secrets, run `npm run test:prod`, or use Doppler.
