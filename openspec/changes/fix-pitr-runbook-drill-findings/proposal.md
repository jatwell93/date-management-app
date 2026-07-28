# Proposal: Fix PITR + runbook drill findings (2026-07-28 production drill)

> **Status: IMPLEMENTED (2026-07-28).** All seven findings from the
> production PITR drill are addressed on branch
> `fix/pitr-runbook-drill-findings`. Tasks 1–6 are code/doc changes;
> Task 7 is this OpenSpec change + verification.

## Why

A production PITR drill on 2026-07-28 surfaced seven findings that
would have caused a real rollback to fail or to operate against the
wrong Neon branch. None are hypothetical — each was observed during
the drill or in the surrounding runbook review:

1. **`migration-prep.yml` could not target the Neon `production`
   branch.** The workflow had no `neon_branch` input, so the PITR
   check always filtered against the default branch name baked into
   `check-neon-pitr.js` (which was `main`). The Neon production branch
   is named `production`, not `main` — the two are distinct (one is a
   Neon branch, the other is a Git branch), and the gate was silently
   checking the wrong one.
2. **`check-neon-pitr.js` did not normalize `branch_id` vs
   `source_branch_id`.** The Neon snapshots API exposes the
   originating branch under two different keys depending on the
   response shape. Snapshots materialized via the snapshot-restore /
   branch-creation path use `source_branch_id`; project-snapshot
   listings use `branch_id`. The filter only read `branch_id`, so
   cross-branch snapshots from the restore path were silently
   misattributed (or dropped), and a recent dev-branch snapshot could
   satisfy the gate for the production branch.
3. **The runbook referred to the Neon production branch as `main`
   throughout.** Operators following the runbook would resolve and
   restore the wrong branch. The Git branch `main` and the Neon
   branch `production` are different objects with different IDs.
4. **The pre-adoption PITR drill acceptance criteria were wrong.**
   Step 1b expected `migrate:verify` PASS, but a pre-adoption snapshot
   predates the `schema_migrations` ledger and migration `0010`, so
   `migrate:verify` cannot pass on it. Treating its failure as a drill
   failure would block adoption on a perfectly good restore.
5. **The role-check Worker procedure skipped the build step and did
   not pass `--config` to Wrangler.** `wrangler deploy` does not build
   for you; without `npm run build:workers` it deploys a stale or
   empty artifact. Without `--config workers/wrangler.toml` (or
   `cd workers`), Wrangler run from the repo root cannot find
   `wrangler.toml`.
6. **The `\password app_runtime` psql meta-command is fragile.** It
   relies on psql's interactive no-echo prompt, which mishandles in
   some terminal environments (e.g., Git Bash on Windows) and cannot
   be used in a semi-automated procedure. The password also had to be
   typed by hand, with no strength guarantee.

## What changes

Seven targeted fixes, each with a regression test or a verifiable
runbook change:

1. **`migration-prep.yml`** — add a `neon_branch` workflow input
   (default `production`) and pass it through as `NEON_BRANCH` to
   `check-neon-pitr.js` in the `pitr-check` step.
2. **`scripts/check-neon-pitr.js`** — default `NEON_BRANCH` to
   `production` (not `main`), and normalize
   `branch_id ?? source_branch_id` in `extractSnapshots` so the branch
   filter attributes a snapshot to the correct branch regardless of
   which key the Neon API used. New regression tests cover the
   normalization, the new default, and the cross-branch rejection
   case end-to-end through `main()`.
3. **`docs/migrations-deploy-runbook.md` (Neon branch references)** —
   replace every Neon-branch `main` reference with `production`
   (prose, SQL comments, bash variables, REST API `search=` query
   params, and the orphaned-branch rename `production (old)`). Git
   branch `main` references (push-to-main, `workflow_dispatch from
   main`, `git push origin main`) are intentionally preserved — they
   refer to the Git branch, not the Neon branch.
4. **`docs/migrations-deploy-runbook.md` (pre-adoption PITR gate)** —
   add a "Pre-adoption acceptance criteria" callout that replaces
   Step 1b's `migrate:verify` PASS with: (a) successful restore
   polling, (b) restored-state fidelity checks (table count matches
   pre-adoption count, not post-0010), (c) `migrate:preflight` PASS
   (read-only, reports the ledger as not-initialized). Cross-link
   from Step 1b's "Expected" so operators doing the pre-adoption
   drill are not told to expect `migrate:verify` PASS. Update the
   Step 1c record fields to capture drill type and the new criteria.
5. **`docs/migrations-deploy-runbook.md` (role-check Worker)** —
   prepend `npm run build:workers` to the deploy step (matching the
   production deploy workflow), and pass
   `--config workers/wrangler.toml` to every `wrangler` invocation
   (deploy, secret put, delete) so Wrangler finds the config from the
   repo root. Document the `cd workers` alternative.
6. **`docs/migrations-deploy-runbook.md` (password procedure)** —
   replace the `\password app_runtime` meta-command with a
   history-protected `ALTER ROLE` procedure: generate the password
   to a `chmod 600` temp file via `openssl rand -base64 32`, install
   an EXIT/INT/TERM cleanup trap that validates the path is within
   TMPDIR and is a regular file before removing it, read the password
   into a psql variable via `\set` backtick expansion, run
   `ALTER ROLE app_runtime PASSWORD :'pw';`, then `\unset pw`. The
   trap securely deletes the temp file on shell exit, Ctrl-C, or
   SIGTERM. The password never appears in shell history, psql history,
   or process arguments. Add step 1d: a history-safe procedure for
   obtaining the pooled `app_runtime` connection URI from Neon's
   `connection_uri` REST API (NOT hand-constructed — base64 passwords
   contain `+`, `/`, `=` characters that are not URL-safe and must be
   percent-encoded) and storing it in Doppler via stdin before the
   temp password file is destroyed.
7. **This OpenSpec change** — proposal, tasks, spec deltas, and
   verification (compile, affected tests, focused ESLint on modified
   JS files, Prettier check on modified files, strict OpenSpec
   validation, `git diff --check`).

## Impact

- **Affected files:** `.github/workflows/migration-prep.yml`,
  `scripts/check-neon-pitr.js`, `scripts/check-neon-pitr.test.js`,
  `docs/migrations-deploy-runbook.md`.
- **No production data path changes.** The Worker, the migration
  runner, and the database schema are untouched. The fixes are to
  the PITR gate (which runs before migrations), the runbook (which
  operators follow), and the workflow input surface (which is
  additive — a new input with a default).
- **Backward compatibility.** The `neon_branch` workflow input
  defaults to `production`, so existing workflow_dispatch invocations
  that do not set it now target the correct Neon branch. The
  `check-neon-pitr.js` default change is the same direction. Existing
  tests that relied on the old `main` default were updated to set
  `NEON_BRANCH: 'main'` explicitly, so they still prove the `main`
  path works for non-production environments.
- **Risk.** Low. The most consequential change is the
  `branch_id ?? source_branch_id` normalization in
  `check-neon-pitr.js`; it is covered by four new unit tests and three
  new `main()` integration tests, and the existing 23 tests still
  pass.
- **Lint scope.** Root `npm run lint` does NOT exit 0 — it reports
  ~48,952 pre-existing `prettier/prettier` `Delete ␍` (CRLF) errors
  across the entire codebase on the base branch (before any changes by
  this branch). This is a pre-existing `core.autocrlf=true` + Prettier
  `endOfLine` mismatch affecting every checked-in file, not an issue
  introduced by this change. The modified JS/test files were
  normalized to LF and passed through Prettier; focused ESLint on
  those two files exits 0. Root lint is out of scope for this fix
  branch.
