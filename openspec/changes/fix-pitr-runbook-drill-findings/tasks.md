# Tasks: Fix PITR + runbook drill findings

> All tasks are implemented on branch `fix/pitr-runbook-drill-findings`.
> Verification commands are in the final phase.

## Phase 1 — Code fixes (PITR gate)

- [x] 1.1 Add `neon_branch` input (default `production`) to
      `.github/workflows/migration-prep.yml` and pass it as
      `NEON_BRANCH` to `check-neon-pitr.js` in the `pitr-check` step.
- [x] 1.2 Change the default `NEON_BRANCH` in
      `scripts/check-neon-pitr.js` from `main` to `production`.
- [x] 1.3 Normalize `branch_id ?? source_branch_id` in
      `extractSnapshots` in `scripts/check-neon-pitr.js` so the branch
      filter attributes a snapshot to the correct branch regardless
      of which key the Neon API used.
- [x] 1.4 Update existing `check-neon-pitr.test.js` tests that relied
      on the old `main` default to set `NEON_BRANCH: 'main'`
      explicitly, decoupling them from the default change.
- [x] 1.5 Add regression tests for the `branch_id ?? source_branch_id`
      normalization: unit tests for `extractSnapshots` (both keys,
      neither key, `branch_id` preferred) and `filterSnapshotsByBranch`
      (matches a `source_branch_id`-normalized snapshot).
- [x] 1.6 Add `main()` integration tests for the new default
      (`production`) and the `source_branch_id` shape: (a) default
      resolves `production` and a recent `main`-branch snapshot does
      NOT satisfy the gate; (b) a recent `source_branch_id`-attributed
      snapshot on the target branch satisfies the gate; (c) a
      cross-branch `source_branch_id` snapshot does NOT satisfy the
      gate for another branch.

## Phase 2 — Runbook fixes

- [x] 2.1 Replace Neon-branch `main` references with `production`
      throughout `docs/migrations-deploy-runbook.md` (prose, SQL
      comments, bash variables, REST API `search=` query params,
      orphaned-branch rename `production (old)`). Preserve Git branch
      `main` references (push-to-main, `workflow_dispatch from main`,
      `git push origin main`).
- [x] 2.2 Add "Pre-adoption acceptance criteria" callout to the
      Pre-adoption PITR gate section: replace `migrate:verify` PASS
      with (a) successful restore polling, (b) restored-state
      fidelity checks (pre-adoption table count), (c)
      `migrate:preflight` PASS. Cross-link from Step 1b's "Expected".
- [x] 2.3 Update the Step 1c record fields to capture drill type
      (regular vs pre-adoption) and the new acceptance criteria.
- [x] 2.4 Prepend `npm run build:workers` to the role-check Worker
      deploy step in step 5; pass `--config workers/wrangler.toml` to
      every `wrangler` invocation (deploy, secret put, delete).
      Document the `cd workers` alternative.
- [x] 2.5 Replace the `\password app_runtime` psql meta-command in
      step 1 with a history-protected `ALTER ROLE` procedure:
      `openssl rand -base64 32` to a `chmod 600` temp file, an
      EXIT/INT/TERM cleanup trap that validates the path is within
      TMPDIR and is a regular file before removing it, `\set pw`
      backtick expansion, `ALTER ROLE app_runtime PASSWORD :'pw';`,
      `\unset pw`, trap-secured temp file deletion. Add a "Why not
      `\password`" rationale callout. Add a "Do NOT hand-construct the
      `app_runtime` connection URI" callout (base64 `+`/`/`/`=`
      chars are not URL-safe — use Neon's `connection_uri` REST API).
- [x] 2.6 Add step 1d: history-safe procedure for obtaining the pooled
      `app_runtime` connection URI from Neon's `connection_uri` REST
      API and storing it in Doppler via stdin (`printf '%s' | doppler
      secrets set`) before the temp password file is destroyed by the
      EXIT trap. Update step 6 to reference the same procedure for the
      Neon `production` branch (production Doppler config, not
      `role_check`).
- [x] 2.7 Update the step 6 reference to "set password interactively"
      to point at the new history-protected `ALTER ROLE` procedure
      and the step 1d connection-URI capture.

## Phase 3 — OpenSpec + verification

- [x] 3.1 Create this OpenSpec change (`fix-pitr-runbook-drill-findings`)
      with proposal, tasks, and spec deltas.
- [x] 3.2 Run `npm run compile` (root `tsc`) — exits 0.
- [x] 3.3 Run `node --test scripts/check-neon-pitr.test.js` — all
      tests pass (30 tests: 23 original + 7 new).
- [x] 3.4 Run `npx eslint scripts/check-neon-pitr.js
      scripts/check-neon-pitr.test.js` (focused ESLint on the modified
      JS files only) — exits 0 with zero errors.
      **Note:** root `npm run lint` does NOT exit 0 — it reports
      ~48,952 pre-existing `prettier/prettier` `Delete ␍` (CRLF)
      errors across the entire codebase on the base branch (before
      any changes by this branch). This is a pre-existing
      `core.autocrlf=true` + Prettier `endOfLine` mismatch affecting
      every checked-in file, not an issue introduced by this change.
      The modified JS/test files were normalized to LF and passed
      through Prettier; focused ESLint on those two files exits 0.
      Root lint is out of scope for this fix branch.
- [x] 3.5 Run `npx prettier --check .github/workflows/migration-prep.yml
      scripts/check-neon-pitr.js scripts/check-neon-pitr.test.js` —
      all matched files use Prettier code style.
- [x] 3.6 Run `openspec validate fix-pitr-runbook-drill-findings
      --strict` — passes.
- [x] 3.7 Run `git diff --check` — no whitespace errors.
