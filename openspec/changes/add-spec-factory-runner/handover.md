# Handover: add-spec-factory-runner

Updated: 2026-10-23 · main at cdfb9974

## State

The proposal merged (#678). Phase 0 is done except the ruleset: the secret, the Claude GitHub App (Workflows permission is read-only, so the app cannot push workflow files) and the labels are in place, and #680 settled Dependabot (7-day cooldown, owner merges). Task 1.1 (#686) adds the `run-spec` skill and `scripts/check-no-go.js`. Tasks 1.2 and 1.2a are on `feature/factory-workflow-and-no-go-guard`, stacked on #686: `factory.yml`, `no-go-guard.yml` and their static test.

## Next

After both PRs merge: open a throwaway PR labelled `factory:test` that touches `.claude/**`, confirm `factory/no-go-guard` fails on it, close it, and tick 1.2a. Then 1.3, the pilot change.

## Open PRs

- #686 feat(tooling): add the run-spec skill and the no_go path check.
- Tasks 1.2 and 1.2a PR, based on #686's branch (GitHub retargets it to `main` when #686 merges).

## Waiting on the user

- 0.4: the `main` ruleset still reports `required_approving_review_count: 0` and an empty bypass list (checked 2026-10-23 with `gh api repos/{owner}/{repo}/rulesets/14671588`). Set Required approvals to 1, add Repository admin to the bypass list, and save. Task 1.4 (first dispatch) must wait for this.
- After the guard's live test passes: add the status `factory/no-go-guard` to the ruleset's required checks.

## Learnings

- The `production` environment has `wait_timer` and `branch_policy` but no required reviewers. A push to `main` deploys Workers and Pages to production with no further human gate (`.github/workflows/pages-deploy.yml:147-151`, `.github/workflows/workers-deploy.yml:73`). Do not enable `merge: auto` until that changes.
- A PR opened with the default `GITHUB_TOKEN` does not trigger other workflows. The factory must push and open PRs as the Claude GitHub App. In agent mode the action rewrites the git remote to use the app token; whether `gh` inside the run also uses the app token is unverified. Task 1.4 checks that CI ran on the factory PR.
- In agent mode (`prompt` set), `claude-code-action` allows no Bash unless `--allowedTools` lists it, so `factory.yml` needs an allow-list, not only the deny-list.
- A `pull_request_target` run's check is attached to the base commit, so it may not satisfy a required check on the PR head. `no-go-guard.yml` therefore posts the commit status `factory/no-go-guard` on the head SHA.
- The Claude GitHub App's slug is `claude`, so factory PRs are authored by `claude[bot]`.
