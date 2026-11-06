# Proposal: Format Worker files before the factory pushes

## Why

Live proof #772 (`standardise-on-camelcase`) failed CI at `Workers Tests` > `Check formatting`: prettier flagged `workers/src/inventory-item-handlers.test.ts`. The factory could not fix it. Two passes ended with `needs-human` on the tracking issue, because the command the run tried (`npm --prefix workers exec -- prettier ...`, then `cd workers && npx prettier ...`) needed approval in the runner sandbox. The owner ran prettier by hand and removed `needs-human`.

The runner already has a command it may run: `npm run format` in `workers/package.json` formats `src/**/*.ts` and the config files with the exact-pinned prettier from workers' own lockfile, and `Bash(npm run:*)` is on the `--allowedTools` list in `.github/workflows/factory.yml`. Nothing tells the run to use it. The gate in `.claude/skills/run-spec/SKILL.md` lists tests, typecheck and lint, but no format step, and the handover learning says `npx prettier --write`, a command the runner's sandbox did not allow in that form. CI runs `npm run format:check` (`.github/workflows/workers-test.yml`), so `npm run format` is the matching write command.

## What changes

- The gate step in `.claude/skills/run-spec/SKILL.md` adds, for a change that touches `workers/`, `npm run format --prefix workers` before the commit, and says not to use `npx prettier` there.
- `.claude/skills/babysit-pr/SKILL.md` adds the same command to its one-shot review-fix pass, before it pushes, because that pass is a separate skill and can otherwise push an unformatted Worker fix.
- `AGENTS.md` §4 (the quality gate) lists the same command for Workers changes, so interactive sessions and the factory share one gate.
- The `agent-factory-runner` spec records that a Worker change is formatted with the package's own script before it is pushed.
- No workflow change: the allowlist already permits `npm run`.

## Out of scope

- Formatting for `frontend/` or `shared/`. The root `lint` gate already covers them.
- Changing the prettier pin or `format:check` in `workers-test.yml`.
- Widening the `--allowedTools` list.

## Autonomy

```yaml
merge: human
```

Every task edits `.claude/**` or `AGENTS.md`, both on the `no_go` baseline (`scripts/check-no-go.js`), so it is built in an interactive session.
