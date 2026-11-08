# Tasks: Extract the factory into a reusable software-factory repo

Built in interactive sessions: every task moves or edits a `no_go` path. Tasks in the new repo are built in that repo's own PRs; this repo's tasks.md tracks them.

## 1. Ground work

- [x] 1.1 (owner) Create the public repo `jatwell93/software-factory` with a licence, branch protection on `main`, the same required-review rule as this repo, and a tag rule that blocks moving or deleting `v*` release tags.
      Demo: the repo exists, is public, an empty PR cannot merge without review, and moving a `v*` tag is refused.
- [x] 1.2 Inventory every line in this repo's factory files that is specific to this repo, and check every file that will move for secrets, hostnames, internal URLs and tenant data. Write the result into `design.md`: one row per coupling with its config key, plus a clean-scan result.
      Demo: `design.md` lists each coupling named in the proposal with a config key, and states the scan found nothing sensitive.
- [ ] 1.3 Define the `factory.config.yml` schema and the spec-source adapter interface in `design.md`, with a JSON schema file and a typed adapter contract in the new repo. The contract includes the adapter's project setup operation that `init` calls.
      Demo: a sample config for this repo validates against the schema; a stub adapter that implements the contract passes the contract test.
      Blocked by: 1.2.

## 2. Extract

- [ ] 2.1 Move the factory scripts and their tests into the new repo. Make `check-no-go` take its baseline from the generic six paths (`.github/**`, `.claude/**`, `.githooks/**`, `AGENTS.md`, `CLAUDE.md`, `factory.config.yml`) plus the config. Move the main-branch git hooks (`pre-commit`, `pre-push`) and a rewritten installer with it, so `init` installs them: no git-secrets case in the installer, any extra hook chained from `hooks.chain` in config. The git-secrets scripts and relay hooks stay in the consumer (`design.md` row 21). Add the change-id check as a function and as a CI check on PRs that add a change folder.
      Demo: `check-no-go` on a fixture with a config-listed path fails and names it; a config that removes a baseline path is a usage error; a PR adding a capitalised change folder fails the id check.
      Blocked by: 1.3.
- [ ] 2.2 Move the OpenSpec reads and writes in `factory-route`, `factory-issue`, `factory-ticket` and `run-spec` behind the adapter interface, and ship the OpenSpec adapter.
      Demo: the router's existing test suite passes unchanged against the OpenSpec adapter; no router or guard file mentions `openspec/`.
      Blocked by: 2.1.
- [ ] 2.3 Convert `factory.yml`, `factory-digest.yml`, `factory-ci-relay.yml` and `no-go-guard.yml` to reusable workflows driven by the config, with the gate, setup steps, bots and spend cap read from it. Add `factory/reviews-settled` (with the `reviews_timeout_minutes` fallback) and cost and duration in the digest.
      Demo: a fixture consumer's run reads its gate and Node version from config; the status stays pending until a fixture Copilot review posts, and turns to success with the bot named after the timeout when it never does.
      Blocked by: 2.2.
- [ ] 2.4 Move the five skills into the new repo, taking gate commands and bot names from the config, and make the memory steps optional.
      Demo: in a fixture without memory scripts, `handover` and `resume-change` finish without a memory error.
      Blocked by: 2.2.

## 3. Dogfood

- [ ] 3.1 Add `factory.config.yml` to this repo with its gates, migrations, backup script and lint gates as config, and switch its workflows to the pinned reusable ones. Keep `factory/no-go-guard` and `Workers CI Gate` as the check names.
      Demo: a factory run on a small change in this repo opens a PR with the same checks and labels as before.
      Blocked by: 2.3, 2.4.
- [ ] 3.2 Delete the vendored factory scripts, skills and tests from this repo, and shrink the `AGENTS.md` factory section to a pointer to the factory docs.
      Demo: `npm run test:tooling` and `npm run lint` pass; `git grep factory-route` finds no script.
      Blocked by: 3.1 and one clean factory run on the pinned ref.

## 4. Setup CLI

- [ ] 4.1 `init`: detect stack, propose gates, write config, caller workflows and the `AGENTS.md` block, run the adapter setup, create labels, print the ruleset and secret steps. Idempotent.
      Demo: on an empty fixture repo `init` writes the files; a second run changes nothing.
      Blocked by: 2.4.
- [ ] 4.2 `doctor` and `upgrade`: `doctor` checks secret, labels, ruleset, app, config and pin (warning on a branch or unprotected tag) and prints the fix command for each gap; `upgrade` bumps the pin and shows the diff.
      Demo: `doctor` on a half-set-up fixture lists exactly the missing items.
      Blocked by: 4.1.
- [ ] 4.3 `new-change`: scaffold a change folder through the adapter, refusing an invalid id. Make `to-tickets` run the same id check before it writes `tasks.md`.
      Demo: it creates a valid change for OpenSpec with no shell redirects; `new-change Fix-Thing` and `to-tickets` on a folder with that name both refuse and write nothing.
      Blocked by: 2.2.

## 5. Proof

- [ ] 5.1 (owner) Choose a second repo, ideally not a monorepo and with a different gate. Run `init`, complete the owner steps `doctor` lists, and run one small change through the factory. Count every time you touch the keyboard and write the gaps into `handover.md`.
      Demo: one change merged in the second repo with the owner only planning, merging and doing the listed setup steps.
      Blocked by: 4.2, 3.1.
- [ ] 5.2 Write the quickstart (install, `init`, first change) and move `docs/factory-guide.md` into the new repo.
      Demo: someone who has not seen this repo follows the quickstart to a first factory PR, using 5.1's gaps as the test.
      Blocked by: 5.1.

## 6. Next adapters

- [ ] 6.1 Research PAUL and GSD: read each one's real task, status and archive format and write, for each, whether the adapter interface covers it and what it lacks. Draft what a bespoke adapter needs. Open one follow-up change per adapter. Build none here.
      Demo: `design.md` has a section per framework with a yes or no for each interface method, and the follow-up changes are open.
      Blocked by: 1.3.
