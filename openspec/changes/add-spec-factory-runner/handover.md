# Handover: add-spec-factory-runner

Updated: 2026-10-23 · main at 782b8ca0

## State

Phase 1 is built and merged except the first dispatch. #686 added the `run-spec` skill and `scripts/check-no-go.js`; #687 added `factory.yml` and `no-go-guard.yml`; #688 added the pilot change `add-agent-route-map-and-tooling-polish`. The guard was verified live on throwaway PR #689: `factory/no-go-guard` failed with a `.claude/**` file and passed once the file moved to `docs/`.

## Next

Task 1.4: dispatch `factory.yml` with `change_id=add-agent-route-map-and-tooling-polish`, once the owner's ruleset steps below are done. Then check that CI ran on the factory PR (the open question about `gh` and the app token) and record the PR and run links here.

## Open PRs

- #690 docs(openspec): record the no-go guard live test.

## Waiting on the user

- 0.4: the `main` ruleset now has Repository admin in its bypass list, but still reports `required_approving_review_count: 0` (checked 2026-10-23). Set Required approvals to 1 and save. Until then a factory PR could be merged without your approval.
- Add the status `factory/no-go-guard` to the `main` ruleset's required status checks.

## Learnings

- The `production` environment has `wait_timer` and `branch_policy` but no required reviewers. A push to `main` deploys Workers and Pages to production with no further human gate (`.github/workflows/pages-deploy.yml:147-151`, `.github/workflows/workers-deploy.yml:73`). Do not enable `merge: auto` until that changes.
- A PR opened with the default `GITHUB_TOKEN` does not trigger other workflows. The factory must push and open PRs as the Claude GitHub App. In agent mode the action rewrites the git remote to use the app token; whether `gh` inside the run also uses the app token is unverified. Task 1.4 checks that CI ran on the factory PR.
- In agent mode (`prompt` set), `claude-code-action` allows no Bash unless `--allowedTools` lists it, so `factory.yml` needs an allow-list, not only the deny-list.
- A `pull_request_target` run's check is attached to the base commit, so `no-go-guard.yml` posts the commit status `factory/no-go-guard` on the head SHA. Opening a PR with a label fires `opened` and `labeled` together; the guard's concurrency group cancels the first run, which is expected.
- The Claude GitHub App's slug is `claude`, so factory PRs are authored by `claude[bot]`.
- The guard applies every active change's `no_go` list. While the pilot is active, `workers/src/**` and `frontend/**` are protected from every factory PR; archive the pilot to lift that.
- Squash merges break stacked PRs: after the base PR merges, merge `origin/main` into the stacked branch and keep its side of the add/add conflicts (it is a superset), rather than rebasing and force-pushing.
