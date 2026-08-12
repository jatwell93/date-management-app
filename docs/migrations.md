# Database Migrations — The Authoritative Path

**This document describes the only supported mechanism for changing the production database
schema.** Every factual claim below cites the repo path that implements it; if the code and this
document disagree, the code is right and this document is a bug.

Scope note: `docs/database-migrations.md` describes the legacy Prisma/SQLite path used by the
Express backend (`backend/`), which is retained only as the rollback backend until it is deleted.
`npx prisma db push` and `prisma migrate deploy` are **not** how production schema changes are
applied.

---

## 1. What owns migrations

| Concern | Location |
| --- | --- |
| Runner + CLIs | `src/database/migrations/` |
| Authoritative history (SQL + manifest) | `database/migrations/` |
| Ledger table | `schema_migrations` (created by `ensureLedger`, `src/database/migrations/runner.ts:402`) |
| Catalog fingerprints | `database/migrations/catalog-fingerprint.json` (+ `catalog-fingerprint.0009.json` for adoption at a historical point) |

The history is a set of `NNNN_name.up.sql` / `NNNN_name.down.sql` pairs plus
`database/migrations/manifest.json`, which is the declaration of intent for each migration.
`0000_baseline` through `0011_add_subscription_period_fields` are installed today.

Each manifest entry declares an exact key set — `id`, `forward`, `transaction`, `compatibility`,
`dataLoss`, `recovery`, `backfill`, `contract` — and the loader rejects anything else
(`assertManifest`, `src/database/migrations/runner.ts:151`, via `assertExactKeys` at
`runner.ts:135`). Unknown or missing fields are a load-time failure, not a silently ignored key.

The legacy `migrations` table left behind by the Prisma-era backend is retained but is **not**
read or reinterpreted by this runner. `schema_migrations` is the ledger.

### The ledger is a check, not a log

`validateLedger` (`src/database/migrations/runner.ts:429-464`) fails closed on four separate
conditions before anything is applied:

1. a ledger row whose ID is absent from the authoritative history (`ledger-inconsistent`);
2. a checksum that does not match the recomputed history entry (`checksum-mismatch`);
3. a row still in state `applying` — a migration interrupted outside a transaction, which must be
   repaired explicitly before resuming (`ledger-inconsistent`);
4. applied IDs that are not a **contiguous prefix** of history — a skipped or hand-stamped
   migration fails here even when every individual checksum is valid (`ledger-inconsistent`).

Ledger columns (`src/database/migrations/runner.ts:404-416`) record `checksum`, `state`,
`transaction_rule`, `data_loss_class`, `recovery_strategy`, `migration_name`, `deployment_sha`,
`started_at`, `applied_at` and `runner_version`. `deployment_sha` and `started_at` are preserved on
re-stamp (`recordMigration`, `runner.ts:467-500`) so the original attempt stays auditable.

---

## 2. The ordered commands

The authoritative command list is the `migrate:*` scripts in the **root** `package.json`. Each
compiles first (`npm run compile`) and runs the built CLI from `build/`.

| Command | Entry point | Mutating? |
| --- | --- | --- |
| `npm run migrate:status` | `src/database/migrations/status-cli.ts` | no |
| `npm run migrate:preflight` | `src/database/migrations/preflight-cli.ts` | no |
| `npm run migrate:apply` | `src/database/migrations/cli.ts` | **yes** |
| `npm run migrate:seed` | `src/database/migrations/seed-cli.ts` | **yes** |
| `npm run migrate:verify` | `src/database/migrations/verify-cli.ts` | no |
| `npm run migrate:adopt -- --dry-run` \| `-- --apply` | `src/database/migrations/adopt-cli.ts` | dry-run no, apply **yes** |

`migrate:adopt` is the **one-time** command that stamps an existing database into the ledger
without executing its history. It is not part of a routine deploy.

The ordered sequence for a deploy is **status → preflight → apply → seed → verify**, which is
exactly what `.github/workflows/migration-prep.yml:125-235` runs.

### Environment variables

Required by every command (each CLI's own header comment is the source, e.g.
`src/database/migrations/status-cli.ts:1-19`):

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL_UNPOOLED` | direct (non-pooled) PostgreSQL connection string |
| `MIGRATION_ALLOWED_HOST` | allowlisted hostname; a mismatch aborts |
| `MIGRATION_ALLOWED_DATABASE` | allowlisted database name |
| `MIGRATION_ENVIRONMENT` | `development` \| `test` \| `staging` \| `production` |
| `MIGRATION_TARGET_KIND` | `primary` \| `development` \| `restore-drill` |
| `MIGRATION_ROLE` | dedicated DDL role; must equal `current_user` |
| `MIGRATION_CONFIRM_PRODUCTION` | `APPLY <host>/<database>` — production only |

Additional, per command:

| Variable | Required by |
| --- | --- |
| `MIGRATION_DEPLOYMENT_SHA` | `migrate:apply` (`src/database/migrations/cli.ts:32`) and `migrate:adopt` |
| `MIGRATION_SEED_CONFIRMATION` | `migrate:seed` on production — `SEED <host>/<database>` (`src/database/migrations/seed-cli.ts:52`) |
| `MIGRATION_ADOPT_CONFIRMATION` | `migrate:adopt --apply` — `ADOPT <host>/<database> AT <migration-id>` |
| `MIGRATION_ADOPTION_POINT` | optional; adopt at a historical migration ID (for example `0009`) |

The pooled endpoint is rejected by `validateMigrationTarget` — migrations run through the direct
connection only. (Related operational gotcha: `scripts/verify-runtime-role.js` also requires the
direct URL; PgBouncer plus the extended protocol produces false negatives.)

### What each command actually checks

- **`migrate:status`** — read-only ledger report against the authoritative history. No advisory
  lock, no writes (`src/database/migrations/status.ts`).
- **`migrate:preflight`** — readiness of the target. Verifies the connected role via
  `verifyMigrationRole` (`src/database/migrations/preflight.ts:65`) and write capability using a
  `TEMPORARY` table that is session-local and auto-dropped, so it leaves no persistent object.
- **`migrate:apply`** — takes the advisory lock, applies pending migrations in order, stamps the
  ledger. Refuses to run before the canonical baseline is installed
  (`src/database/migrations/cli.ts:39`).
- **`migrate:seed`** — idempotently upserts the authoritative 54-row `tier_feature_flags`
  reference set (`src/database/migrations/seed.ts:38`) and verifies the result. This is the single
  source of truth for tier flags; both `backend/scripts/` seeders are superseded by it.
- **`migrate:verify`** — three fail-closed checks (`src/database/migrations/verify.ts:1-20`):
  every expected table exists; `tier_feature_flags` is exactly 54 rows all matching the declared
  set; and the live catalog structurally matches the checked-in fingerprint under the strict
  `ADOPTION_COMPARISON` profile, so any column/index/constraint/function/trigger drift fails.

`preflight`, `seed` and `verify` signal failure by setting `process.exitCode` **without throwing**,
and each emits an explicit failure event — a failing gate cannot log success.

---

## 3. Safety model

| Guard | Implementation |
| --- | --- |
| Pooled-host rejection, host/database allowlist, environment, production confirmation | `validateMigrationTarget` (`src/database/migrations/runner.ts`) |
| Target-kind declaration; mutating commands refuse non-`primary` targets | `assertTargetKind` (`src/database/migrations/target.ts:39`) |
| Connected role must equal `MIGRATION_ROLE` | `verifyMigrationRole` (`src/database/migrations/target.ts:67`) |
| Single writer | `pg_try_advisory_lock` (`src/database/migrations/runner.ts:552`) |
| Bounded blocking | `SET lock_timeout = '10s'` (`src/database/migrations/runner.ts:397`) |
| Manifest shape, enum domains, backfill/contract consistency | `assertEntrySemantics` (`src/database/migrations/runner.ts:281-317`) |
| Expand always ships before its contract | `assertContractTargets` (`src/database/migrations/runner.ts:324-338`) |
| History filenames cannot escape the directory | `assertSafeHistoryFile` (`src/database/migrations/runner.ts:226`) |

Two of these deserve expanding:

**Role separation.** DDL privileges belong to a dedicated migration role (`neondb_owner` in
production), which is *not* the restricted runtime role the Worker connects as (`app_runtime`). A
leaked or reused application credential therefore cannot mutate the schema. The check is a live
`SELECT current_user`, not a configuration assertion.

**Compatibility phases.** Every manifest entry declares `compatibility` as `expand`, `migrate` or
`contract`. The runner does **not** forbid contract migrations; what it enforces is that a
migration declaring `contract.planned` names a contract migration that exists in the manifest and
has a **later** ID (`runner.ts:324-338`) — so a removal can never be deployed before or alongside
the expand it depends on. The deploy workflow's apply step is labelled "expand-compatible schema"
(`.github/workflows/migration-prep.yml:189`) to reflect the intended discipline; the mechanical
guarantee is the ordering rule, not a ban.

`pg_try_advisory_lock` is deliberately the non-blocking variant: a second concurrent runner fails
immediately with a typed `lock-unavailable` error rather than hanging until a CI timeout.

### Structured logging and error classes

Each command emits one JSON line per phase — `start`, `success`, `failure` — carrying command,
migration ID, redacted host/database, environment, deployment SHA, duration and error class
(`src/database/migrations/log.ts`). Errors are classified by type, not by message matching:
`MigrationCodedError` + `classifyMigrationError` in `runner.ts` produce `lock-unavailable`,
`checksum-mismatch`, `ledger-inconsistent`, `target-rejected`, `catalog-drift`, or the
`execution-failure` fallback. Alerting is the structured line plus a failing CI job — no logging
SDK is loaded into the migration path.

---

## 4. How migrations reach production

`.github/workflows/migration-prep.yml` is a **reusable** workflow (`on.workflow_call`) called by
`.github/workflows/workers-deploy.yml`. It runs migrations *before* the Worker deploys.

Inputs (`migration-prep.yml:36-72`): `environment`, `deployment_sha`, `mode`, `neon_project_id`,
`neon_branch`, `pitr_max_age_hours`, `pitr_min_retention_hours`. Secrets: `DOPPLER_TOKEN`
(required) and `NEON_API_KEY`.

Two modes:

- **`validate`** — `status` → `preflight` only, read-only. Used for PR previews.
- **`full`** — `status` → `preflight` → PITR readiness → `apply` → `seed` → `verify`.

Every step uploads its captured output as a build artifact (`migration-status-<sha>`,
`migration-preflight-<sha>`, `pitr-evidence-<sha>`, `migration-apply-<sha>`, `migration-seed-<sha>`,
`migration-verify-<sha>`), so a deploy leaves reviewable evidence.

Callers (`workers-deploy.yml:41-79`):

| Job | Trigger | Environment / mode |
| --- | --- | --- |
| `migration-prep-preview` | pull request (non-fork, non-dependabot) | `preview` / `validate` |
| `migration-prep-production` | push to `main` **only** when repo variable `PRODUCTION_AUTO_DEPLOY_ENABLED == 'true'`, **or** any `workflow_dispatch` from `main` | `production` / `full` |

`PRODUCTION_AUTO_DEPLOY_ENABLED` defaults to unset, so pushing to `main` does not deploy.
**Manual `workflow_dispatch` from `main` is the supported production path** and is never gated by
that variable — it is also the break-glass/rollback route.

> `NEON_API_KEY` must be **declared** under `on.workflow_call.secrets` in `migration-prep.yml`
> *and* threaded explicitly from `workers-deploy.yml`. A reusable workflow only surfaces
> environment secrets it declares; omitting either half makes the PITR gate throw
> `NEON_API_KEY is required`.

After deploy, a post-deploy canary (`workers-deploy.yml:364`) runs two authenticated rounds via
`scripts/run-authenticated-smoke.js` and checks for new fatal/critical Sentry issues in the canary
window. Missing Sentry configuration is a **hard failure**, not a skipped step. Note that canary
runs from GitHub-hosted runners can be edge-blocked by Cloudflare (a 403 there is a false negative,
not a production outage) — see `docs/migrations-deploy-runbook.md`.

The step-by-step operator procedure, including confirmation strings and sign-offs, is
`docs/migrations-deploy-runbook.md`.

---

## 5. Testing

| Command | What it runs | Where |
| --- | --- | --- |
| `npm run test:migrations` | `runner`, `adopt`, `baseline.fingerprint`, `commands`, `log` suites under `node --test` against pglite | local + CI |
| `npm run test:migrations:e2e` | `e2e.test.js` against a real PostgreSQL engine | CI only, `.github/workflows/migrations-e2e.yml` |

Both compile first. The two lists are **explicit file lists in the root `package.json`** —
`test:migrations` does not glob, and deliberately excludes `e2e.test.ts`. A new test file is not
picked up until it is added to the script.

`migrations-e2e.yml` pins `postgres:17.10-trixie` by amd64 digest to match the production Neon
project's PG major version; the digest makes the image immutable so a registry republish cannot
change the engine underneath the proof. It runs on **every** pull request and push to `main` with
no `paths:` filter — a required status check that never runs never reports, which would block every
PR that does not touch migration files. Path detection happens in the `changes` job inside the
workflow instead.

---

## 6. Recovery

**Do not restate the recovery policy here.** It is measured and recorded in:

- `docs/neon-backup-restore.md` — the measured Neon configuration and the accept-no-upgrade
  decision. See ["Recovery policy: the 6-hour window, and what it costs us"](./neon-backup-restore.md).
- `docs/migrations-deploy-runbook.md`, section **"Recovery policy sign-off (task 1.9)"** — the
  drill evidence and operator sign-off.

The operating figures:

| | |
| --- | --- |
| **Operating RPO** | **6 hours** — the Neon PITR retention window (`history_retention_seconds = 21600`, free tier) |
| Planned-migration recovery floor | ~3 s — *not* the operating RPO |

The 3-second figure recorded in the 1.9 sign-off is the floor for a **planned** migration only,
because the drill takes its recovery point immediately before restoring. An unplanned incident has
no fresh snapshot waiting, so the reachable recovery point is bounded by the retention window.
**A recovery point older than 6 hours is unreachable** — corruption discovered after 6 hours
cannot be rolled back by PITR.

The retention floor is **CI-enforced**, not asserted in prose: `scripts/check-neon-pitr.js` runs as
the PITR readiness gate in `migration-prep.yml` (full mode) and fails the deploy if the newest
restore point is too old or the retention window has been reduced. Drill procedure:
`scripts/pitr-drill.sh`. Neon's free plan permits exactly one manual snapshot per project, so
repeat drills replace the existing snapshot rather than adding one.

---

## Related documents

- `docs/migrations-deploy-runbook.md` — operator procedure, confirmations, sign-offs
- `docs/neon-backup-restore.md` — measured recovery policy and restore procedures
- `docs/migrations-e2e-runbook.md` — the real-PostgreSQL proof
- `docs/database-migrations.md` — legacy Prisma/SQLite path (Express backend only, retained until deletion)
