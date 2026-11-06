# Tasks: Format Worker files before the factory pushes

Built in an interactive session: every task touches a `no_go` path (`.claude/**`, `AGENTS.md`).

## 1. Gate

- [ ] 1.1 The run-spec gate formats Worker changes: `.claude/skills/run-spec/SKILL.md` adds `npm run format --prefix workers` to the gate for a change that touches `workers/`, and to the review-fix pass in one-shot mode, and says not to use an inline `npx prettier`. `AGENTS.md` §4 lists the same command. The handover learning that names `npx prettier --write` is not repeated.
      Demo: a dry run of `/run-spec` on a task that edits a Worker test file leaves `npm run format:check --prefix workers` green with no manual fix.
      Acceptance: `openspec validate factory-format-before-push --strict` and `node scripts/check-no-go.js --change factory-format-before-push` run as expected; `npm run lint` passes; the next factory task that touches `workers/` passes `Check formatting` unaided.
