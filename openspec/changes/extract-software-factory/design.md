# Design: Extract the factory into a reusable software-factory repo

## 1. Inventory of repo-specific lines (task 1.2)

Scope: the 38 tracked files that move: `.github/workflows/factory*.yml`, `no-go-guard.yml`, `scripts/factory-*.js` (with tests), `check-no-go.js`, `babysit-round.js`, `pr-feedback.js`, `cleanup-merged.js`, `install-git-hooks.js`, `.githooks/*`, the five skills `run-spec`, `to-tickets`, `babysit-pr`, `handover`, `resume-change`, and `docs/factory-guide.md`. Counted on 2026-11-09 by a script that greps each file for the patterns below; line numbers are in the files at that date.

| # | Coupling | Where | Config key (or fate) |
|---|---|---|---|
| 1 | Owner login `jatwell93` for the @-mention, owner-only labels and escalation | `scripts/factory-route.js:607`, `scripts/factory-digest.js:15`, `run-spec` (2 lines), `babysit-pr` (2 lines) | `owner` |
| 2 | Spec framework: `openspec/changes/...`, `tasks.md`, `proposal.md` Autonomy block, `openspec archive` | `factory-route.js` (11 lines), `factory-escalate.js`, `factory-issue.js`, `factory-retry.js`, `factory-ticket.js`, `factory-sweep.js`, `factory-digest.js`, `babysit-round.js`, `check-no-go.js`, `factory.yml` (6), `factory-ci-relay.yml`, `no-go-guard.yml`, `.githooks/*`, `run-spec` (18), `to-tickets` (7), `handover` (7), `resume-change` (6) | `spec_source`, read through the adapter (task 2.2) |
| 3 | Gate commands: `npm run test:frontend:diff`, `npm run test:db`, `(cd workers && npm run typecheck)`, `npm run test:tooling`, `npm run lint` | `run-spec` (4 lines), `babysit-pr` ("run the diff-scoped gate") | `gates`: list of `{when: <path globs>, run: <command>}` |
| 4 | Repo protected paths: `database/migrations/**`, `scripts/database-backup.sh`, `eslint.config.js`, `eslint.ignores.js`, `eslint.complexity-baseline.js`, `scripts/complexity-baseline.test.js` | `BASELINE` in `scripts/check-no-go.js` (6 lines) | `protected_paths` (extra to the six generic ones) |
| 5 | Factory scripts listed in `BASELINE` (`scripts/factory-*.js`, `babysit-round.js`, `pr-feedback.js`, `check-no-go.js`, `install-git-hooks.js`) | `BASELINE` | Dropped: they run from the pinned checkout. `install-git-hooks.js` and `.githooks/**` move with the factory and `.githooks/**` joins the generic baseline |
| 6 | Default branch `main` hardcoded: merge-base diff `origin/main...HEAD` and `--base origin/main` (`check-no-go.js:199`), `origin/main` fetch, diff, merge and checkout (`factory.yml:194-197,216-217`, plus the "Checkout main" steps), `--ref main` (`factory-ci-relay.yml:73`), `github.ref == 'refs/heads/main'` (`no-go-guard.yml:47`), the `'main'` fallback in `factory-escalate.js:48`, `PROTECTED`, `origin/main` and `checkout main` in `cleanup-merged.js`, and `main` in `.githooks/pre-commit` and `.githooks/pre-push` | `default_branch` (the hooks read it from the installer) |
| 7 | Review bots allowed to start a run: `sentry[bot]`, `codescene-delta-analysis[bot]`, `copilot-pull-request-reviewer[bot]`, plus the always-needed `claude[bot]` and `github-actions[bot]` | `factory.yml:260` (`allowed_bots`) | `review_bots` (the three review bots); `claude[bot]` and `github-actions[bot]` stay built in |
| 8 | Bot behaviour, not only names: Sentry resolves its own threads, CodeScene posts a review per push and reports "Gates Failed", Copilot may say "quota limit" | `pr-feedback.js` (7 lines), `babysit-pr` (8 lines) | Bot profiles shipped in the factory; `review_bots` picks which apply. An unknown bot is treated as a plain review author |
| 9 | App-specific check excluded from "pending" lists: `Deploy Frontend to Cloudflare Pages` | `pr-feedback.js:99`, `factory-ci-relay.yml:23` | `ignored_checks` |
| 10 | Runner setup: Node 22, `npm ci` | `factory.yml` (12 lines), `factory-digest.yml` (2) | `runner.node_version`, `runner.install` (a command, so Python or other stacks can supply theirs) |
| 11 | Spend cap `--max-budget-usd 20`, `--max-turns 200`, step timeout, retry watchdog | `factory.yml` | `spend_cap_usd`, `max_turns`, `timeout_minutes` |
| 12 | `--allowedTools` entries that name `npm run`, and `--disallowedTools` entries that name this repo's commands (`npm run test:prod`, `doppler`) next to the generic ones (`gh pr merge`, `gh pr review`, `gh api`, forced pushes, `curl`, `wget`) | `factory.yml:274-275` | Allowed list derived from `gates` and `runner.install`. The generic denials are built in; this repo's two go to `forbidden_commands` (see row 14) |
| 13 | Memory scripts `mem-log`, `mem-recall`, `memory.jsonl` | `handover` (3), `resume-change` (2) | Optional step, skipped when the scripts are absent (task 2.4) |
| 14 | Product names in prose: "No Doppler, Neon, Stripe or Cloudflare credential" (`factory.yml:38`); "never run `npm run test:prod` or use Doppler" (`run-spec:178`) | `factory.yml`, `run-spec` | Reword the comment generically. Move the Doppler and `test:prod` ban to `forbidden_commands` in config |
| 15 | Guide examples naming `database/migrations/**` and `AGENTS.md` | `docs/factory-guide.md` | Genericise when moved (task 5.2) |
| 16 | Tests that assert on this repo's YAML and paths | `factory-workflows.test.js` (6), `check-no-go.test.js` (18 repo paths), `pr-feedback.test.js` | Move with fixtures, not with this repo's real files |
| 17 | Factory-owned names that stay fixed so required checks keep working: status `factory/no-go-guard`, labels `factory:<id>`, `factory-ready`, `factory-retry`, `needs-human` | workflows, router | Defaults, overridable under `labels`; the check name does not change |
| 18 | `to-tickets` embeds the licence text of its upstream (mattpocock/skills) | `to-tickets/SKILL.md:133` | Keep the attribution and licence text when the skill moves |
| 19 | The "Use main's copy of the factory's own rules" step hardcodes a list: `.claude`, `AGENTS.md`, `CLAUDE.md` and ten factory scripts, so a babysit pass cannot be steered by edits on the PR branch | `factory.yml:210-222` | With a pinned checkout the ten scripts need no restore. The step stays for the consumer-owned rules (`.claude`, `AGENTS.md`, `CLAUDE.md`, `factory.config.yml`) and takes that list from the generic baseline |

Not in the factory files and so not moved: the required check `Workers CI Gate` (it lives in `workers-test.yml`; the consumer's ruleset names it) and the `AGENTS.md` factory section, which becomes a pointer to the factory docs (task 3.2).

## 2. Secret and sensitivity scan (task 1.2)

The 38 files were scanned for: GitHub, OpenAI-style, AWS and Slack token prefixes; private-key headers; JWT-shaped strings; database connection strings with credentials; email addresses; and any URL that is not a GitHub, Anthropic, CodeScene, Node, npm, OpenSpec or licence-source link.

Result: no hits. The only non-vendor URLs are test fixtures (`https://github.com/o/r/...`, `https://example.com/runs/1`). Product names appear only in prose comments (row 14). The one personal identifier is the owner login in row 1, which is already public on the repo.

The new repo starts from a fresh history: files are copied, not pushed with this repo's history, so no earlier commit can carry anything this scan would have caught in a later version.

## 3. Open design points for tasks 1.3 and later

- **Config schema and adapter contract:** task 1.3 turns the keys above into a JSON schema, and the adapter operations in the spec into a typed contract.
- **Gates are by changed path, not by package.** `gates[].when` takes globs, so a monorepo can run `test:db` only for `workers/**` while a single-package repo has one entry with no `when`.
- **Bot profiles are code in the factory**, not config, because their behaviour differs. Adding a bot profile is a factory release; using an unknown bot needs no release.
