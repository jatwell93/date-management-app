# Proposal: Plan in a session, build without the owner

## Why

The 2026-10-29 retro of the `factory-per-change-pr` sessions (51dbffed, 346a0342) found that the owner still steps in outside planning and merging:

- **Starting a change.** The factory starts only on `gh workflow run factory.yml -f change_id=<id>`. In the 1.3 proof the owner had to say "dispatch the proof".
- **Archiving a change.** `run-spec` never archives (`.claude/skills/run-spec/SKILL.md:39`), so every change ends with an interactive session. The `factory-per-change-pr` archive found the spec delta stale ("draft", "merge starts nothing") and fixed it by hand.
- **A commit pushed to `main`.** Something switched the checkout to `main` between `git switch -c` and the commit, and the owner's ruleset bypass let the push through. The only guard is a memory note.
- **`memory.jsonl` left dirty.** `scripts/mem-log.js` appends to a tracked file after the commit, so the tree was dirty, two stashes piled up and the owner had to drop them.

The planning itself is also weak where the factory is most sensitive: `tasks.md` is written freehand, with no check that each task is a vertical slice that fits one fresh context window. The `/to-tickets` skill (mattpocock/skills, https://www.aihero.dev/skills-to-tickets) does that slicing, quizzes the owner on it, and publishes tickets with native blocking links.

## What changes

- **`to-tickets` for OpenSpec (planning).** A new repo skill `.claude/skills/to-tickets/`, adapted from mattpocock/skills, slices a change's `proposal.md`, `design.md` and spec deltas into vertical tasks and quizzes the owner on granularity and blocking edges before anything is written.
  - `tasks.md` stays the source of truth: the router, owner tasks, per-change ticking and `no_go` are all built on it. The skill writes the approved slices into `tasks.md`, each task with a `Demo:` line, a `Blocked by:` line where it has one, `(owner)` where it applies, and its issue number.
  - It publishes one issue per task as a sub-issue of the change's tracking issue, with native blocking links (`gh issue create --parent <n> --blocked-by <a,b>`, `gh` 2.94+), blockers first so their numbers exist.
  - `run-spec` puts `Closes #<n>` for each task it lands in the PR body, so the owner's merge closes the ticket. A per-change PR closes all its tickets on its one merge.
  - The factory still runs one task at a time. Building every unblocked ticket in parallel is out of scope.
- **The owner's approval starts the build.** `factory.yml` adds `issues: labeled`. When the owner adds `factory-ready` to a change's tracking issue, the router starts the change's first unchecked task, as a dispatch does today. The router ignores the label when anyone but the owner adds it. `to-tickets` adds it as its last step, after the owner approves the slices.
- **The factory archives a finished change.** When no unchecked task is left, the next step is an archive run instead of the owner's: it re-checks the spec delta against `openspec/specs/` and what the tasks built, fixes stale wording, runs `openspec validate` and `openspec archive -y`. On a per-change PR it commits on the PR branch before `WIP:` is dropped, so the owner reviews the archive in the merge they already make. On a per-task change it opens one archive PR. The archive commit closes the tracking issue (`Closes #<n>`).
- **No agent commit on `main`.** A PreToolUse hook (`.claude/hooks/main-guard.sh`) refuses a Bash `git commit` or `git push` while `HEAD` is `main`, and a `git push` whose refspec targets `main`. It replaces the `verify-branch-before-commit` memory as the guard.
- **`mem-log` writes on feature branches only.** `scripts/mem-log.js` refuses to write while `HEAD` is `main`, with a message to switch branch. The `handover` and `resume` skills log before they commit, so the entry lands in the same commit as the work.

## Safety

- The factory still never merges. The archive run only edits `openspec/**`, which is not on the `no_go` baseline, and the owner reviews it in a PR.
- `factory-ready` is honoured only from the owner, like the `needs-human` removal (`scripts/factory-route.js`).
- `.claude/**`, `.github/**`, `AGENTS.md` and the factory scripts stay on the `no_go` baseline, so this change is built in interactive sessions, not by the factory.

## Out of scope

- Parallel builds of unblocked tickets (a change-level concurrency group stays).
- Cloud babysitting of PRs the owner's sessions open (retro item 4): the router's Claude-App-author check needs a security review first.

## Autonomy

```yaml
merge: human
```

Not for the factory: it edits `.github/**`, `.claude/**`, `AGENTS.md` and the factory's own scripts.
