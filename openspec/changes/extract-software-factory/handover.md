# Handover: extract-software-factory

Updated: 2026-11-14 · main at 7a6896998

## State

Groups 1, 2 and 4 and tasks 3.1 and 3.2 are done. `jatwell93/software-factory` (main at `b049bc9`, 25 PRs) holds the config schema, the adapter contract and OpenSpec adapter, every script ported onto them, the reusable workflows, the five skills, the run-record digest and the setup CLI (`factory-init.js`, `factory-doctor.js`, `factory-upgrade.js`, `factory-new-change.js`). This repo runs it: `factory.yml` and five other workflows are thin callers pinned to `1b55a7946865384265a3fe07b8f53f400420f6e1` (#782, then pin bumps #785, #786, #787, #790); `factory.config.yml` is in place. The live proof ran on the pinned ref: change `factory-pinned-proof` went route, task 1.1, task 1.2, archive, `WIP:` dropped. Its PR #789 merged. Task 3.2 removed the 11 vendored factory scripts and their tests (`babysit-round`, `check-no-go`, `cleanup-merged`, `factory-*`, `pr-feedback`), their `test:tooling` entries, their `eslint.complexity-baseline.js` and `.claude/settings.json` allow entries, and shrank the `AGENTS.md` factory section to a pointer. The five skills stay as installed copies. `scripts/install-git-hooks.js`, `.githooks/**` and `git-hooks.test.js` stay: `prepare` runs the installer and the hooks chain this repo's secret scan.

## Next

Task 5.1 (owner): run the setup CLI on a second repo, ideally not a monorepo and with a different gate, and count every touch of the keyboard. Steps, from that repo's root with `gh` logged in and `FACTORY_DIR` set to a checkout of `jatwell93/software-factory`:

1. `node "$FACTORY_DIR/scripts/factory-init.js" --dry-run`, then without `--dry-run`. Pass `--gate "<cmd>"` and `--ci-workflow "<name>"` if it asks. Note every flag, prompt and warning.
2. `node "$FACTORY_DIR/scripts/factory-doctor.js"`: do each `fix:` line it prints and the owner steps `init` printed (secret, ruleset with `factory/no-go-guard` and `factory/change-ids`, Block force pushes, the Claude GitHub App, the approval policy). Rerun until no `FAIL`.
3. Commit the written files in one PR and merge it.
4. `node "$FACTORY_DIR/scripts/factory-new-change.js" <id> --title "<title>"`, fill in the proposal and specs, then `/to-tickets <id>` and merge the plan PR.
5. Let one small change run to a merged PR. Write each gap (a step that was unclear, a flag you had to guess, a wrong check) into this file under "5.1 gaps".

After that: 5.2 (quickstart, built from those gaps) and 6.1 (PAUL/GSD research, independent of 5.1).

## Open PRs

- None for this change.

## Waiting on the user

- Rulesets: also require `factory/change-ids` (and optionally `factory/reviews-settled`, after it refreshes itself, see Learnings); enable "Block force pushes" on `main`.
- Actions approval gate: later pushes by `github-actions[bot]` on a factory PR run as `action_required` until the owner clicks "Approve and run workflows". Same in #755 and #756, so not caused by the extraction. `approval_policy` is `first_time_contributors`; `first_time_contributors_new_to_github` may stop it (unchecked). Owner's call.
- Whether a run that ends with denied tool calls and no PR should fail the job (today it reads `success`).

## Learnings

- **First live runs fixed five things**, all invisible to static tests: the denied-tool log lines (software-factory #18), read-only helpers and one command per call (#19), no shell variable in an agent command, so the prompt gives the literal `${{ runner.temp }}/software-factory` path (#20), and the router ignoring the factory's own pending `factory/reviews-settled` status (#21). Read `denied:` lines in the run log first when a run ends `success` with no PR.
- The route job reads `factory.config.yml` from the default branch, so a PR that adds or changes it shows a red `Route the event` and `settle` check until it merges (#782). Expected, not a bug.
- `package.json`, `package-lock.json` and `.npmrc` are in `protected_paths`: `npm ci` runs on the PR branch at runner setup. A factory task that needs a new dependency or npm script is an owner task.
- `factory/reviews-settled` stays pending after its quiet window: no event re-runs the settle job, and the hourly `schedule` trigger had not fired in this repo. The router no longer waits on it. A fix (refresh from the sweep) is not built.
- A per-change PR gets no event when the quiet window ends: dispatch `gh workflow run factory.yml -f pr=<n>` to advance it. `gh workflow run factory.yml` with no inputs does nothing (`a change id is empty`).
- One agent task run cost about $0.12 to $0.16 and 30 to 60 seconds (`factory-run-record` artifact); the agent action exposes `execution_file` with `total_cost_usd`.
- `check-change-ids` flags `use-cloudflare-r2-and-a-serverless-database`: 43 characters, limit 42. The factory cannot run it; rename it before it is ever built that way.
- `design.md` row 8 and the schema's `review_bots` description said bot profiles ship in the factory. None are built: the skill's notes are generic. Row 8 is corrected here and the schema text in software-factory (#22).
- `doctor` run on this repo found `factory/change-ids` not yet required on `main`: the owner step above. Its first draft also flagged "Actions may not create pull requests", which was wrong (the agent opens PRs with the Claude app token), so that check was removed.
- Two bugs bot reviews found in software-factory's setup CLI are worth remembering as classes: matching `error.message` of a failed `gh` call reads the command line (use `stderr`; a pin SHA containing `404` fooled it), and a value written into `proposal.md` can write the Autonomy block if it holds U+2028 or U+2029 (multiline regexes treat them as line ends).
- Tooling quirks: dcg blocks heredocs and `node -e` with redirects (use the Write tool); the Bash tool halves backslashes (global CLAUDE.md); a prettier hook rewrites files on save.

## 5.1 gaps

None recorded yet.
