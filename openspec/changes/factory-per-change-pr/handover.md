# Handover: factory-per-change-pr

Updated: 2026-10-27 · main at bd56cdd0

## State

Task 1.1 done: Seer skips draft PRs, so 1.2 opens a ready PR titled `WIP:` instead of a draft.
`factory-one-merge-per-change` is archived (#728), so its retry check and owner tasks are on `main`.

What runs on a draft PR:

- Required checks: all run. Draft #689 (2026-10-22) reported every required context: `Scan for secrets`, `CodeQL`, `Check npm supply chain`, `Frontend CI Gate`, `Workers CI Gate`, `Database Conformance Gate`, `factory/no-go-guard`.
- CodeScene: runs. It approved #689 twice while it was a draft.
- Seer (`sentry[bot]`): skips drafts. Sentry's AI Code Review docs say a review starts when the PR is opened or moved to ready, then runs on every commit, and is skipped while the PR is a draft. On a ready PR it re-reviews each push (three reviews on #724).
- Copilot: skips drafts. The `main` ruleset has `copilot_code_review` with `review_draft_pull_requests: false` and `review_on_push: false`. So Copilot reviews a PR once: when it opens ready, or the first time a draft is marked ready.

## Next

1.2: add `pr: per-change` to the Autonomy block. First step: read `scripts/factory-issue.js` (where `issue:` is parsed) and `scripts/factory-route.js` `nextTask()`/`prView`.

## Open PRs

- None for this change yet (1.1 PR pending).

## Waiting on the user

- Copilot on a per-change PR. With `review_on_push: false`, Copilot reviews only the first task's commits; later tasks get Seer and CodeScene only. Options: (a) accept that; (b) turn on "Review new pushes" in the `main` ruleset (a review on every push, which uses more Copilot requests). Recommendation: (a) for now, because Seer already reviews every push. 1.2 does not depend on this choice.

## Learnings

- Copilot's draft and push settings live in the `main` ruleset (id 14671588), not in a file: `gh api repos/{owner}/{repo}/rulesets/14671588`.
