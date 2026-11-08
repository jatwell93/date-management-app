# Proposal: Extract the factory into a reusable software-factory repo

## Why

The factory (`.github/workflows/factory*.yml`, `scripts/factory-*.js`, `pr-feedback`, `babysit-round`, `check-no-go`, and the `run-spec`, `to-tickets`, `babysit-pr`, `handover` and `resume-change` skills) now runs a change from plan merge to archive with the owner only merging. The owner wants the same setup in other projects: drop it in, run a setup, start using it.

Today that is not possible, because the factory is welded to this repo. The 2026-11-09 retro found these couplings:

- `BASELINE` in `scripts/check-no-go.js` names `database/migrations/**`, `scripts/database-backup.sh` and this repo's ESLint files next to the generic paths.
- `run-spec` and `babysit-pr` hardcode `npm run test:frontend:diff`, `npm run test:db` and `(cd workers && npm run typecheck)` as the gate.
- `handover` and `resume-change` call `scripts/mem-log.js` and `scripts/mem-recall.js`, which only this repo has.
- `factory.yml` assumes Node 22 and `npm ci`, and names the review bots (Seer, CodeScene, Copilot).
- `scripts/factory-workflows.test.js` asserts on this repo's own YAML.
- The factory rules live in `AGENTS.md` section 5, and the required check names (`factory/no-go-guard`, `Workers CI Gate`) are this repo's.
- The planning step assumes OpenSpec: the router reads `tasks.md` and the `## Autonomy` block of `proposal.md`.

The same retro also found four gaps that touch files which move anyway, so they are fixed in the new repo instead of here:

- Copilot comments land after the owner merges (#776, #777). A `factory/reviews-settled` commit status should stay pending until the quiet window ends and the Copilot review has posted.
- `openspec validate` accepts a change id with capitals that the router rejects (`standardise-on-camelCase`). A check should reject it at plan time.
- `dcg` blocks shell scaffolding of change folders. A scaffolding command removes the need.
- The `--max-budget-usd 20` cap is a guess. The digest should report cost and duration per run.

## What changes

- **A new public repo, `software-factory`** (owner: jatwell93). It holds the workflows, scripts, skills, tests and docs, released with version tags. It is the single source of the factory.
- **A `factory.config.yml` in each target repo** replaces every hardcoded value: gate commands per package, extra protected paths, review bots and their wait timeout, runner setup steps (Node version, install command), spend cap, branch prefix, label names, default branch, and which spec source to use. The built-in protected baseline keeps only generic paths: `.github/**`, `.claude/**`, `AGENTS.md`, `CLAUDE.md` and `factory.config.yml`. Migrations, the backup script and lint gates become config entries in this repo.
- **Pinned checkout, not copied files.** A target repo holds thin caller workflows that use the factory's reusable workflows at a pinned commit SHA, or at a release tag that the factory repo protects against moving or deletion (task 1.1 sets the tag rule; `doctor` warns about a branch or an unprotected tag). The runner checks the factory's scripts and skills out into a temp directory. The agent cannot edit them, so the list of factory scripts leaves the baseline, and `upgrade` is a one-line pin bump. Required check names stay stable across the move.
- **A spec-source adapter.** The factory no longer reads OpenSpec directly. It reads a small interface: list the active changes, list a change's tasks with their done, owner and blocked-by marks, read a change's autonomy settings, tick a task, archive a change. Each spec framework supplies an adapter.
  - **OpenSpec** is the only adapter in this change. It is the current behaviour moved behind the interface, with no change for this repo.
  - **PAUL, GSD and a bespoke setup** are planned adapters. They are not built here. This change only fixes the interface they need and records what each would require (task 6.1), so adding one later is a new change in the factory repo, not a rewrite. The format of PAUL and GSD has not been checked yet, so no field mapping is promised here.
- **A setup CLI**, run straight from the GitHub repo at a pinned ref, `npx github:jatwell93/software-factory#<sha-or-protected-tag> <command>` (nothing is published to npm, so a bare `npx software-factory` is not used anywhere):
  - `init` detects the stack, proposes gate commands, writes `factory.config.yml`, the caller workflows and a marked pointer block in `AGENTS.md`, runs the chosen adapter's setup (`openspec init` for OpenSpec), creates the labels, and prints or applies the ruleset and the secret steps (`claude setup-token`, `gh secret set`, the Claude GitHub App link).
  - `doctor` checks the secret, labels, ruleset, app, config and pin, and names what is missing.
  - `upgrade` bumps the pin and shows what changed.
  - A `new-change` command scaffolds a change folder through the adapter, so agents do not use `printf` and heredocs.
- **Memory is optional.** Without `mem-log`, `handover` writes the handover file only and `resume-change` skips the recall step.
- **This repo becomes the first consumer** (dogfood): its vendored factory files are replaced by the pinned reference and a `factory.config.yml`, with the same behaviour and the same required check names.

## Safety

- The factory still never merges and still has no production secrets. Only `CLAUDE_CODE_OAUTH_TOKEN` and `GITHUB_TOKEN` are used, as today.
- The protected baseline can be added to by a config or a change, never shrunk by either. The no-go guard still runs the default branch's copy of the check, now from the pinned factory ref, so a PR cannot change it.
- Moving to a public repo exposes the factory's workflows, scripts and skills. Nothing in them is secret, but task 1.2 checks that the inventory has no token, hostname, internal URL or tenant data before the first push.
- Pinned reusable workflows run with the caller's permissions. The caller workflows keep today's explicit `permissions:` blocks, and the pin is a SHA, so a factory release cannot change what runs in a target repo until the owner bumps it.
- Most files moved are on this repo's `no_go` baseline: `.github/**`, `.claude/**`, `scripts/check-no-go.js`, `scripts/babysit-round.js`, `scripts/pr-feedback.js` and the `scripts/factory-*.js` scripts. Tasks 1.2, 1.3, 5.2 and 6.1 edit only `design.md`, new-repo files and docs, which are not protected. This change is built in interactive sessions with the owner by choice, not by the baseline, and it is never started with `factory-ready`.
- `factory/reviews-settled` cannot hang: it also turns to success once a configured timeout (`reviews_timeout_minutes`, default 30, counted from the last push) has passed, and names the bots that never posted.

## Out of scope

- PAUL, GSD and bespoke adapters (a follow-up change each, after task 6.1).
- Non-GitHub hosts and non-Claude agents.
- Agents merging, parallel tasks, and a hosted or paid service.
- Publishing to npm. The CLI runs from the GitHub repo at a pinned ref.

## Autonomy

```yaml
merge: human
```

Not for the factory: it edits `.github/**`, `.claude/**`, `AGENTS.md` and the factory's own scripts.
