# Tasks: Retire Express, Prisma, and SQLite — unify on the Worker + Postgres

> **Phase 0 Decision Gate: CLEARED — GO (2026-07-24).** Phase 1 (migration foundation) may begin;
> Phases 3–4 (Worker parity, deletion) stay gated on Phases 1–2, and each production cutover keeps its
> own verification/rollback gate.
>
> **Direct path:** there is no intermediate "Express on Postgres" state. Express + Prisma + SQLite stay
> untouched as the rollback backend until Worker parity and the migration runner are proven, then all
> three are deleted together (Phase 4).
>
> **Deletion invariant:** nothing under `backend/` is removed unless it appears in the Phase 3 rehoming
> checklist with either a verified replacement or an explicit, recorded retirement decision.

## Phase 0 — Decision Gate (required before any code)

- [x] 0.1 Confirm the trigger — **MET (2026-07-24)**. The unmeasurable ">30 minutes of mechanical sync"
      clause was revised to a git-observable proxy: a schema change touches **≥5 of the 5–7 triplication
      artifacts** AND the base + production Prisma schemas receive a **byte-identical edit** (mechanical
      mirroring, not business logic). Evidence: **#390** (credit-scoped markdown) and **#394** (catalogue
      provenance) each touched **7/7** artifacts with byte-identical dual-Prisma edits (verified via
      `git show` diff comparison). The proposal Decision Gate criterion 1 carries the revised wording.
- [x] 0.2 Sole-Worker dev API — **APPROVED (2026-07-24)** by the product owner (jatwell93): run the
      Worker (`wrangler dev`) as the sole local dev API and retire Express as a dev backend.
- [x] 0.3 Local/CI DB story — **CONFIRMED (2026-07-24)** by the product owner (jatwell93):
  - Express dev/test → stays on **SQLite, untouched** until deletion (the rollback backend; no new local DB).
  - Worker + conformance tests → **pglite** (already a dependency).
  - Worker local dev → `wrangler dev` against a developer-owned **Neon branch**. PGlite remains the
    offline test/conformance engine; it is not claimed as a `wrangler dev` database adapter.
  - Migration-runner PR CI → an ephemeral PostgreSQL service with **no production secrets**. A separate
    scheduled job uses an isolated, auto-created Neon branch to exercise provider-specific behaviour.
  - No local Docker or heavyweight local Postgres server is required; hosted CI may use a service
    container internally.
- [x] 0.4 Go/no-go — **GO (2026-07-24)**. All Phase 0 prerequisites are recorded (0.1 trigger met, 0.2
      sole-Worker approved, 0.3 DB story confirmed, sequencing resolved to the direct path). **Phase 1
      (migration foundation) is unparked and may begin.** Phases 3–4 (Worker parity, deletion) remain gated
      on Phases 1–2 completing, and every production cutover keeps its own verification/rollback gate.

## Phase 1 — Establish the authoritative PostgreSQL migration foundation (before anything is deleted)

> Highest-priority, highest-value work: it replaces the single most load-bearing thing Prisma owns
> (`npm run migrate:prod`), survives regardless of the rest, and directly de-risks production. After
> task 1.1 captures the current migration contract, the remaining work may run in parallel with the
> Phase 2 audit.

- [x] 1.1 Inventory **all backend-owned migration scripts** before choosing their replacement:
      `migrate-production-doppler.js` (the authoritative `npm run migrate:prod`),
      `migrate-production-simple.js`, `migrate-production.ts`, `migrate.js`, `verify-migration.js`,
      `list-migrations.ts`, plus the runtime SQLite migration runner
      (`backend/src/migrations/{migrate.ts,migration.service.ts,migration.model.ts}` and the numbered
      `*-*.migration.ts` files). Record the current production command's full contract—schema push,
      required tier/reference seed, and post-migration verification—and mark every script **replace, do
      not delete** until the successor reproduces or explicitly retires its responsibility. **Captured in
      `design.md` under “Phase 1.1 migration ownership inventory” (2026-07-24), including the additional
      migration/backfill and preflight executables, every package migration/reset entry point, all 19
      active embedded SQLite migrations, four standalone numbered files, supporting seed/preflight
      dependencies, and the complete contents of both backend-owned SQL-history families.**
- [x] 1.2 Choose an executable Postgres migration runner for Neon that does **not** depend on Prisma.
      Relocate `backend/prisma/neon-sql/*.sql` to a permanent path outside `backend/` and promote the
      relocated files—not the runner alone—to the authoritative migration history. Require forward
      migration plus an explicit recovery mechanism appropriate to each migration's declared
      reversibility/data-loss class, an applied-migration ledger with identity/checksum validation,
      ordering checks, and explicit transaction rules. Use a dedicated `schema_migrations` ledger;
      reconcile/retain the legacy `migrations` table. Acquire a PostgreSQL advisory lock, make
      transactional DDL plus ledger write atomic, bound lock/statement timeouts, and define resume/repair
      for explicit non-transactional migrations. **Implemented at the repo root with `pg`
      (`src/database/migrations/`), with the authoritative history and strict manifest relocated to
      `database/migrations/`. Focused contract tests cover ordering, undeclared/missing files, checksums,
      locking, atomic rollback, and interrupted non-transactional state. Every inherited down is explicitly
      manual-only/destructive; 0004 is partial. The legacy `migrations` table is retained but not
      reinterpreted, and the apply CLI remains fail-closed until task 1.3 installs the canonical baseline.**
- [x] 1.3 Build a canonical PostgreSQL baseline because the current Neon SQL series assumes an older
      schema already exists. Prove empty database → baseline → all migrations → latest schema fingerprint,
      covering tables, columns, constraints, indexes, defaults, functions, checks, and partial indexes.
      **Implemented (2026-07-24): the canonical baseline `0000_baseline.up.sql` is generated from the
      Prisma production schema at commit `ae26d623~1` (the parent of the commit that introduced the first
      neon-sql delta, 0001) via `prisma@5.22.0 migrate diff --from-empty --to-schema-datamodel` (Prisma
      version pinned to the historical lockfile; `CREATE SCHEMA IF NOT EXISTS "public"` added manually
      since Prisma 5 does not emit it). The baseline is declared in `manifest.json` with
      `transaction: required`, `compatibility: expand`, `dataLoss: none`, and a
      manual-only/destructive/complete `rollback-sql` recovery (`0000_baseline.down.sql`) that drops only
      the 20 baseline tables — not objects from later migrations or the runner's ledger, to avoid coupling
      the immutable 0000 checksum to future migrations. A pglite fingerprint test
      (`src/database/migrations/baseline.fingerprint.test.ts`) provides three layers of proof: (1) a
      checked-in catalog fingerprint (`database/migrations/catalog-fingerprint.json`) deep-compares every
      table, column/type/nullability/default, index definition, constraint definition, function, and
      trigger after replaying 0000→0009; (2) a baseline-only cross-comparison applies 0000 to pglite A and
      the Prisma-generated SQL from `ae26d623~1` to pglite B, then compares catalogs structurally; (3) a
      full-series cross-comparison applies 0000→0009 to pglite A and the current Prisma production schema
      SQL to pglite B, comparing structurally with an explicit allowlist for known differences.
      `@electric-sql/pglite` is now a root devDependency; `test:migrations` runs all migration tests with
      `--test-concurrency=1` (pglite is WASM, memory-intensive). The runner test's expected history now
      includes 0000.**
- [x] 1.4 Build an explicit one-time adoption command for the existing production-shaped database.
      `adopt --dry-run` performs read-only catalog-definition checks, refuses mismatches, emits a reviewable
      report, and only a separate approved adoption stamps baseline/checksum metadata. Adoption never treats
      "object already exists" as proof the object is correct. **Implemented (2026-07-24, hardened after
      adversarial review): the adoption command lives at `src/database/migrations/adopt.ts` with a CLI
      entry point at `adopt-cli.ts` (`npm run migrate:adopt -- --dry-run` or `-- --apply`). It uses the
      same `validateMigrationTarget` guard and advisory lock as `migrate:apply`. Key hardening:

      (1) **Read-only dry-run.** Dry-run queries `information_schema.tables` for ledger existence (does
      NOT call `ensureLedger`), wraps introspection in a ROLLBACK-only transaction, and creates no schema
      objects — verified by a dedicated test asserting the table does not exist before and after.

      (2) **Strict adoption comparison profile.** `ADOPTION_COMPARISON` requires all migration-owned
      indexes (including partial indexes like `uploads_one_active_catalogue_per_org`) and all CHECK/UNIQUE
      constraints (like `suppliers_credit_type_check`). The broad Prisma-vs-migration exception rules
      (any `updated_at` default, any timestamptz/timestamp(3) difference) apply ONLY to the fingerprint
      test's `TEST_COMPARISON` profile. Adoption column exceptions must be exact
      `AdoptionColumnException` tuples (table, column, expected/actual type, not-null, default). By
      default the exception list is empty.

      (3) **Explicit flags and confirmation.** Unknown CLI args are rejected (`--dryrun` is NOT silently
      treated as authorization). Exactly one of `--dry-run`/`--apply` is required. `--apply` mode requires
      `MIGRATION_ADOPT_CONFIRMATION="ADOPT <host>/<database> AT <migration-id>"` — a separate,
      adoption-specific confirmation distinct from `MIGRATION_CONFIRM_PRODUCTION`.

      (4) **Single-transaction introspection and stamping.** The approved adoption performs catalog
      introspection and ledger stamping inside one `BEGIN ISOLATION LEVEL REPEATABLE READ` transaction —
      the snapshot used for verification is the same one the stamp writes to. A schema-change deployment
      freeze must be in effect (documented in design.md) because the advisory lock only serializes the
      migration runner.

      (5) **Lock release in finally.** The advisory lock is released in a `finally` block — no early
      return bypasses it. Both primary and unlock failures are preserved as `MigrationExecutionError`.

      The structural comparison logic (`computeStructuralKeys`, `compareCatalogs`, `formatCatalogDiff`,
      `ComparisonConfig`, `TEST_COMPARISON`, `ADOPTION_COMPARISON`, `AdoptionColumnException`) lives in
      `src/database/migrations/catalog-comparison.ts`. 15 pglite-backed tests cover: matching dry-run,
      read-only dry-run (no table creation), partial-database refusal, approved stamping, checksum
      verification, explicit confirmation required, wrong confirmation rejected, no-stamp-on-mismatch,
      one-time guard, wrong-definition refusal, missing-table refusal, missing-CHECK-constraint refusal
      (strict), missing-partial-index refusal (strict), invalid SHA rejection, and exact-column-exception
      acceptance.**
- [x] 1.5 Provide separate ordered commands outside `backend/` for migration status/preflight/apply,
      required idempotent reference-data seed, and schema/data verification. Require a dedicated DDL
      migration role, allowlisted target identity, redacted output, explicit production confirmation,
      and rejection of development/restore/pooled application targets.
      **Done (2026-07-25):** added `migrate:status`, `migrate:preflight`, `migrate:seed`,
      `migrate:verify` npm scripts backed by `status.ts`, `preflight.ts`, `seed.ts`, `verify.ts`
      (+ `-cli.ts` entrypoints) under `src/database/migrations/`. Shared guards live in `target.ts`:
      `assertTargetKind` (rejects `development`/`restore-drill` for mutating commands; only `primary`
      is allowed for apply/seed) and `verifyMigrationRole` (dedicated DDL role must equal
      `current_user`). `migrate:apply` and `migrate:adopt` were extended with the same role +
      target-kind guards. Output is JSON/text with redacted target identity (host + database only,
      no password). Production confirmation is required for `migrate:seed` via
      `MIGRATION_SEED_CONFIRMATION=SEED <host>/<db>`. Seed is idempotent (upsert + verify) and
      converges pre-existing incorrect rows. Verify checks table presence, `tier_feature_flags` row
      count + values, and catalog-vs-fingerprint drift. **Pre-existing schema/data inconsistency
      surfaced and fixed:** `tier_feature_flags.limit_value` was `integer` (int4) but the declared
      `storage_bytes` tier limits (10 GB / 100 GB) exceed int32, so the backend Prisma seed could
      not have ever inserted them. Added migration `0010_alter_tier_feature_flags_limit_value_to_bigint`
      (expand-compatible, forward-fix recovery) and regenerated `catalog-fingerprint.json`. The
      bigint-vs-integer divergence is allowlisted in `catalog-comparison.ts` until the Prisma schema
      is updated (Phase 4). Tests: `commands.test.ts` covers all guards + commands (25 new tests,
      pglite-backed); existing `adopt.test.ts`/`runner.test.ts`/`baseline.fingerprint.test.ts`
      updated for 0010. `npm run test:migrations` → 61/61 pass.
- [ ] 1.6 Prove the runner end-to-end against isolated PostgreSQL/Neon targets: fresh install,
      existing-schema adoption, concurrent invocation refusal, interruption/recovery, checksum/catalog
      drift, safe down migration, forward fix, Worker rollback with expanded schema, and restore recovery.
      **Perform at least one real schema change with a working rollback on a Neon dev branch** — this is the
      gate that lets Prisma be removed in Phase 4.
      **Split into automatable (A) and operator-driven (B) subtasks (2026-07-25):**
      - [x] **1.6.A** Automated e2e suite against real PostgreSQL. `src/database/migrations/e2e.test.ts`
            (run via `npm run test:migrations:e2e`) covers fresh install, existing-schema adoption at
            `MIGRATION_ADOPTION_POINT=0009`, concurrent invocation refusal (advisory lock held externally),
            interruption/recovery (a real partial non-transactional DDL — a temp `transaction: forbidden`
            migration whose third statement fails after a visible CREATE TABLE + INSERT, proving the
            partial schema is committed and the ledger is stuck at `applying`; resume refused; explicit
            repair drops the partial table, deletes the ledger row, fixes the SQL, re-applies), checksum
            drift (tampered migration file in temp dir → status + apply refuse), catalog drift (manual
            `ALTER TABLE` after apply → verify fails), safe down migration (execute 0010 down SQL directly
            → schema reverts to int4 → verify fails with only the `limit_value` diff), and forward fix
            (delete 0010 ledger row → re-apply → schema returns to bigint → verify passes). The suite
            **fails closed** (non-zero exit, no skip) when `MIGRATION_E2E_DATABASE_URL` is unset, and
            enforces a **dedicated-target policy**: requires a second env var
            `MIGRATION_E2E_CONFIRMATION` matching the exact token `DROP <dbname> AT <host>` derived from
            the URL, refuses production-shaped host/db names, and verifies `current_database()` matches
            the URL before any DROP. Temp dirs are cleaned in `finally`; the schema is dropped in an
            `after` hook. CI workflow `.github/workflows/migrations-e2e.yml` runs the suite against an
            ephemeral `postgres:17.10-trixie` service container **pinned by amd64 digest** (matching
            production Neon PG 17, verified via Neon MCP + Docker Hub API 2026-07-25). The workflow has
            **no trigger-level `paths:` filter** (matches `backend-test.yml` — a required check must
            always report); path detection is done inside the `changes` job, and the `gate` job is the
            required check that passes when migration files are unchanged. The `test:migrations` script
            was changed from a glob to explicit file listing so the e2e suite's fail-closed throw does
            not break the pglite test run.
      - [x] **1.6.B-runbook** Operator runbook for the Neon dev-branch gate.
            `docs/migrations-e2e-runbook.md` documents the guarded procedure: **two** branch creations
            via `neonctl` — a FRESH branch (schema dropped, for the empty-DB fresh-install replay) and
            an ADOPTION branch (production-shaped schema, for adoption + rollback + old-Worker checks);
            fresh install proof; real schema change with working rollback (0010 down via guarded psql
            with an **executable confirmation guard** that refuses to invoke `psql` unless
            `MIGRATION_DOWN_CONFIRMATION` matches the exact token — no `migrate:down` CLI per decision);
            forward-fix recovery; restore-to-new-branch drill via Neon PITR; old-Worker-against-expanded-
            schema check (actually checks out `OLD_WORKER_SHA`, builds, deploys via `wrangler`, points
            the Worker at the post-0010 branch via `NEON_CONNECTION_STRING` — the env var the Worker
            reads — and smoke-tests real endpoints `/health` and `/api/subscription/current`); teardown;
            and a sign-off section for operator evidence. Connection strings are not echoed in full
            (passwords redacted). The stale `storage_bytes` oversized-row expectation was corrected:
            the current 48-row seed's largest `limit_value` is 250000, so the down succeeds cleanly on
            a fresh branch (the destructive classification is forward-looking).
      - [ ] **1.6.B-execute** Operator-driven Neon gate execution. The runbook must be exercised
            end-to-end on a real Neon dev branch and the sign-off section filled with evidence (CI run
            URL, psql output, restore verification, old Worker smoke test). **Task 1.6 is not complete
            until this subtask is done.** Outstanding evidence from this session: the e2e suite compiles
            and fails-closed correctly but was not executed against a real Postgres locally (Docker daemon
            not running on the Windows dev machine); CI will exercise it on PR open.
- [ ] 1.7 Integrate migrations into deployment: validate history; store dry-run/status output as an
      artifact; verify Neon PITR/backup readiness; apply expand-compatible schema; verify postconditions;
      seed/verify prerequisites; deploy Worker; run real database readiness plus schema-dependent smoke
      tests; observe a canary window with explicit stop/rollback thresholds. Migration-only changes must
      trigger this workflow, and manual deploy commands must not bypass compatibility checks.
      **Runtime role separation prerequisite (2026-07-26):** the Worker
      must not run with the schema owner's credentials. The existing
      schema owner (`neondb_owner`) remains the schema owner and becomes
      the migration-only identity (`MIGRATION_ROLE=neondb_owner`,
      `DATABASE_URL_UNPOOLED` = direct neondb_owner URL). The
      application is moved to a restricted runtime identity
      (`app_runtime`) that has DML privileges but no DDL.
      `app_runtime` is created via SQL `CREATE ROLE` (not Neon's "Add
      Role" button, which auto-inherits `neon_superuser`), with the
      password set interactively via `\password`. Grants + an explicit
      `REVOKE ALL PRIVILEGES ON TABLE schema_migrations FROM app_runtime`
      (so the runtime role has zero access to the migration ledger) +
      `ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner` are a one-time
      operator provisioning procedure (role administration, not schema
      DDL — not in the migration history). Provisioning is proven on a
      temporary `migration-role-check` Neon branch first via
      `scripts/verify-runtime-role.js` (68 unit tests, mocked `pg`
      Client) in **active-probe mode** (`RUNTIME_ROLE_ACTIVE_PROBE=1`)
      and a Worker preview deploy smoke test, then applied on main and
      verified in **read-only mode** (no write or ALTER attempt against
      production). The verifier checks: not a `neon_superuser` member;
      cannot create tables; does not own any public table and is not a
      member of any table's owner role (catalog proof of
      non-alterability); [active only] cannot alter (ALTER attempt must
      fail with SQLSTATE 42501; success or any other SQLSTATE is a
      failure — catches the old undefined-column false-success bug);
      can DML on all `public` tables **except** `schema_migrations`; has
      **no** privileges on `schema_migrations` (all seven denied); can
      use sequences (USAGE/SELECT, catalog only — no `nextval`); can
      execute functions; [active only] can write (transactional
      INSERT/UPDATE/DELETE with `id = -1` so no serial sequence is
      advanced, then ROLLBACK). The previous Worker connection secret is
      retained until the canary passes. A prior malformed
      `" migration_runner"` role (leading space, created via Neon
      Console) is deleted from main after confirming it owns no objects
      — it is unnecessary under this model. See design.md "Runtime role
      separation" and the runbook's "Runtime role separation" section
      for the full procedure.
      **Split into automatable (A) and operator-driven (B) subtasks (2026-07-25):**
      - [x] **1.7.A** Automated CI workflow + scripts. A reusable
            `migration-prep.yml` workflow (called by `workers-deploy.yml` via
            `workflow_call`) runs the full sequence as **one job with
            sequential steps**: `migrate:status` → `migrate:preflight` →
            Neon PITR readiness check → `migrate:apply` → `migrate:seed` →
            `migrate:verify`, each uploading its stdout as a CI artifact
            (30-day retention). Consolidating into one job ensures the
            protected production environment gate (15-min wait timer +
            branch policy) is applied exactly once, Doppler CLI is installed
            once, and checkout/compile happen once on a single revision.
            `workers-deploy.yml` now triggers on `database/migrations/**`
            and `src/database/migrations/**` paths (migration-only changes
            trigger the workflow); `deploy-production`
            `needs: [migration-prep-production]` and `deploy-development`
            `needs: [migration-prep-preview]` (validate-only mode: status +
            preflight, no mutations on the shared dev database). A `canary`
            job after `deploy-production` runs `scripts/post-deploy-smoke.js`
            (round 1), waits `CANARY_WAIT_MINUTES` (default 15), re-runs
            smoke (round 2), and checks Sentry for new fatal/critical
            issues (queries `level:[fatal,critical]`; fails open if
            `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` are unset).
            `scripts/check-neon-pitr.js` verifies a Neon restore point
            exists within `PITR_MAX_AGE_HOURS` (default 2) for the target
            branch via the Neon REST API — it resolves the branch first
            (fail closed if not found), filters snapshots by `branch_id`,
            evaluates only the filtered collection, and rejects implausible
            future timestamps. `scripts/post-deploy-smoke.js` probes
            `/health?deep=true` (requires DB readiness pass) and
            `/api/subscription/current` with latency budgets. The
            authenticated endpoint is exercised by
            `scripts/run-authenticated-smoke.js`, which mints a fresh
            Clerk session token (via `CLERK_SECRET_KEY` +
            `SMOKE_USER_ID` from Doppler) and sends
            `Authorization: Bearer <minted-JWT>` on each request (a 401
            is NOT treated as success); the session is revoked in a
            `finally` block after each round. All four scripts have
            unit tests (23 + 21 + 16 + 29 tests, mocked fetch),
            totalling 89. The fourth script,
            `scripts/neon-poll-operations.js`, polls Neon restore
            operation IDs to a terminal state with a bounded deadline
            and per-request AbortSignal timeout (used by the runbook
            PITR drill and catastrophic rollback).
            **Runtime role separation script (2026-07-26):**
            `scripts/verify-runtime-role.js` (68 unit tests, mocked
            `pg` Client) verifies the restricted `app_runtime` role
            has exactly the privileges it needs (DML on all `public`
            tables **except** `schema_migrations`, sequence access,
            function execution) and nothing more (not a
            `neon_superuser` member, cannot CREATE tables, does not
            own any public table and is not a member of any table's
            owner role — catalog proof of non-alterability, has **no**
            privileges on `schema_migrations`). Two modes: read-only
            (default, for main — catalog checks only, no mutations) and
            active-probe (`RUNTIME_ROLE_ACTIVE_PROBE=1`, for the
            temporary branch — additionally runs a rolled-back write
            probe with `id = -1` so no serial sequence is advanced, and
            an ALTER-denial probe that must fail with SQLSTATE 42501;
            success or any other SQLSTATE is a failure). The `nextval`
            probe was removed (non-transactional, permanently advances
            the sequence). Connects via `RUNTIME_ROLE_URL` and redacts
            the password from all output, including nested probe error
            messages. Regression tests cover ledger-access denial,
            undefined-column false-success (42703 must fail), sequence
            non-use, identifier quoting, and nested-error redaction.
            Total script tests: 179 (95 existing + 68 runtime-role +
            16 Worker-binding/isolation; the 95 existing tests include
            89 across the four migration scripts + 6 across
            `validate-stripe-deployment-config` and
            `mem-memory-scripts`).
            **Worker secret binding on deploy (2026-07-26):**
            `NEON_CONNECTION_STRING` is a Worker secret
            (`wrangler.toml:168`, `workers/src/types/env.d.ts:35`), not
            a `[env.production.vars]` entry, so `wrangler deploy` does
            NOT upload the surrounding-shell env var as a Worker secret
            binding — `doppler run -- npx wrangler deploy` alone would
            leave the Worker bound to whatever
            `NEON_CONNECTION_STRING` was last `secret put`'d (potentially
            a stale pre-cutover `neondb_owner`-as-runtime credential).
            The production deploy job has an explicit
            `Bind NEON_CONNECTION_STRING secret to worker` step
            (analogous to the existing `FRONTEND_URL` binding step) that
            re-binds the value from Doppler via `wrangler secret put`
            BEFORE `wrangler deploy` runs, so a Doppler update (the
            `app_runtime` cutover, or a rollback to the previous
            credential) takes effect on the next deploy with no manual
            `wrangler secret put`. The runbook's preview role-check
            Worker (separately-named, own secret store) is bound the
            same way, with an explicit cleanup step that deletes the
            Worker (and its secrets) after the cutover. A static
            regression test,
            `scripts/verify-workers-deploy-bindings.test.js` (16 tests,
            dependency-free line-based YAML scanner), parses
            `workers-deploy.yml` and asserts the binding step exists
            and precedes `wrangler deploy`. It also verifies that the
            dedicated `role_check` Wrangler environment exists, uses
            the isolated Worker name, exposes only a workers.dev URL,
            declares no routes, queues, Hyperdrive, R2, KV, or Analytics
            bindings, and is used consistently by the runbook (with no
            nonexistent `--env preview` references). It runs as a
            pre-deploy CI step in both `deploy-development` and
            `deploy-production`, so a PR that reorders/removes the
            binding or weakens role-check isolation fails before any
            deploy runs. The runbook's interactive psql
            provisioning step was also corrected: it previously used
            `psql ... -c "SELECT current_user;"` which exits
            immediately, leaving no session for the `CREATE ROLE` /
            `\password` instructions that followed; it now starts a
            plain `psql "$OWNER_URL"` session and runs the SQL +
            meta-commands inside it.
            Expand-only compatibility is enforced by the
            runner at load time (`runner.ts:224` refuses non-expand
            migrations), so the "apply expand-compatible schema" requirement
            is enforced by the runner itself. **Concurrency serialization:**
            all production deploys share a fixed concurrency group
            (`workers-deploy-production`) with `cancel-in-progress: false`
            so a push or dispatch cannot cancel or overlap an in-flight
            apply/seed/verify sequence; PR deploys keep ref-specific
            cancellation. **Credential-level enforcement:** production
            GitHub environment secrets (`DOPPLER_TOKEN`, `NEON_API_KEY`,
            `SENTRY_AUTH_TOKEN`) are scoped to the protected `production`
            GitHub environment (branch policy + 15-min wait timer +
            `can_admins_bypass: false`). The canary's `CLERK_SECRET_KEY`
            and `SMOKE_USER_ID` are **not** GitHub secrets — they live in
            Doppler production config and are injected via `doppler run`
            so the canary can mint short-lived Clerk session tokens.
            **Production safety switch:** push-to-main production deploys
            are gated by the repository variable
            `PRODUCTION_AUTO_DEPLOY_ENABLED` (defaults to disabled; set
            to `'true'` to enable auto-deploy). `workflow_dispatch` from
            `main` is the supported manual deploy and is never gated by
            the variable; direct local
            `wrangler deploy --env production` requires break-glass
            credentials — documentation alone is not enforcement.
      - [x] **1.7.B-runbook** Operator runbook for the production deploy gate.
            `docs/migrations-deploy-runbook.md` documents: the pre-deploy PITR
            drill (snapshot-restore to a new preview branch via the Neon
            REST API
            `POST /api/v2/projects/{project_id}/snapshots/{snapshot_id}/restore`
            with `finalize_restore: false` — `neonctl@2.27.0` has no
            `snapshots` subcommand, so the drill uses the REST API
            directly, with operation-ID polling delegated to
            `scripts/neon-poll-operations.js` (a tested Node script that
            reads the restore response on stdin, extracts the operation
            IDs itself, and polls
            `GET /api/v2/projects/{project_id}/operations/{op_id}` with a
            bounded 15-minute deadline until terminal state before
            connecting — replacing a Bash `while read` loop that ran in a
            subshell and could continue past a failed operation; RPO/RTO
            recording); the restored-branch connection string is resolved
            via Neon's official
            `GET /api/v2/projects/{project_id}/connection_uri` endpoint
            (not a hand-constructed `postgres://postgres@...` URI, which
            has no password and hardcodes the wrong role); the CI
            workflow sequence and artifact inventory; canary observation
            thresholds (smoke failure, Sentry fatal/critical issues,
            error rate, latency); three-layer rollback procedure (Worker
            rollback → forward fix → Neon snapshot restore with
            `finalize_restore: true` + `target_branch_id` to preserve
            the production connection string, with explicit warning
            that destructive down migrations are NOT the default; the
            orphaned `main (old)` branch is recorded as the exact
            pre-restore `MAIN_BRANCH_ID` and **retained until recovery is
            explicitly verified** — never auto-deleted by name match);
            post-deploy verification (authenticated smoke via
            `scripts/run-authenticated-smoke.js`, not bare curl); the
            single-job migration-prep architecture; the concurrency
            serialization model; the credential-level enforcement model;
            the `PRODUCTION_AUTO_DEPLOY_ENABLED` repository variable
            safety switch (defaults to disabled; push-to-main gated,
            manual dispatch always available); smoke-test identity
            provisioning (two identities: a **custodian admin** that
            bootstraps the dedicated smoke organization, then the
            **smoke identity** added second as `team_member` — because
            `bootstrap-handler.ts:302-314` makes the first active user
            in a new org an admin, a single-user provisioning flow
            would produce an admin smoke identity, violating least
            privilege; a verification query confirms the smoke identity
            maps to a non-deleted application user with
            `role = 'team_member'` and a valid `subscription_tiers` row
            before its Clerk ID is stored as `SMOKE_USER_ID`; both
            identities recorded in sign-off); secrets/variables
            reference (`NEON_API_KEY`, `SENTRY_AUTH_TOKEN`,
            `SENTRY_ORG`, `SENTRY_PROJECT`, `CANARY_WAIT_MINUTES` in
            GitHub; `PRODUCTION_AUTO_DEPLOY_ENABLED` as a repository
            variable; `CLERK_SECRET_KEY`, `SMOKE_USER_ID` in Doppler);
            and a structured sign-off section for operator evidence
            including the smoke-test identity record.
            **Runtime role separation section (2026-07-26):** the
            runbook now documents the `app_runtime` provisioning
            procedure as a Phase 1.7 prerequisite — create the role
            via SQL `CREATE ROLE` (not Neon's "Add Role" button, which
            auto-inherits `neon_superuser`), set the password
            interactively via `\password`, grant DML/sequence/function
            privileges, explicitly `REVOKE ALL PRIVILEGES ON TABLE
            schema_migrations FROM app_runtime` (so the runtime role
            has zero access to the migration ledger) + `ALTER DEFAULT
            PRIVILEGES FOR ROLE neondb_owner`, verify via
            `scripts/verify-runtime-role.js` in **active-probe mode**
            (`RUNTIME_ROLE_ACTIVE_PROBE=1`) on a `migration-role-check`
            branch first and in **read-only mode** on main, test the
            Worker against the branch first, then provision on main and
            cut over. The Doppler config table reflects the role
            separation: `DATABASE_URL_UNPOOLED`/`MIGRATION_ROLE` use
            `neondb_owner`; `NEON_CONNECTION_STRING` uses the pooled
            `app_runtime` URL. A role-cutover rollback procedure is
            documented (retain previous Worker connection secret until
            canary passes; on missing-grant failure: restore previous
            credential, redeploy known-good Worker, add grant via
            forward fix, re-verify in read-only mode). Cleanup steps
            delete the `migration-role-check` branch and the malformed
            `" migration_runner"` role from main. The sign-off section
            includes runtime role separation (with REVOKE on
            schema_migrations) and cleanup fields.
            **Runbook hardening (2026-07-26):** every runbook `curl` now
            uses `--fail-with-body --silent --show-error` so HTTP 4xx/5xx
            responses exit non-zero instead of being piped into `jq` as
            if they were success bodies; resolved IDs and URIs are
            validated non-empty before continuing; the snapshot-create
            call sends `name` as a query parameter (not a JSON body
            field) per the Neon create-snapshot API; the
            `connection_uri` request includes the required `role_name`
            parameter (not just `database_name`); and the lengthy
            operation-polling shell sequences were extracted into the
            tested `scripts/neon-poll-operations.js` (29 unit tests,
            mocked fetch, including per-request AbortSignal timeout
            tests) so the duplicated, subshell-prone polling logic is no
            longer embedded only in Markdown. The catastrophic rollback
            (Step 4c) records the orphaned `main (old)` branch ID as the
            PRE-restore `MAIN_BRANCH_ID` (not `.branch.id` from the
            restore response, which is the newly restored active main),
            and the deletion step (8) verifies the recorded ID differs
            from the current main, the branch is still named
            `main (old)…`, and the operator types the exact ID to
            confirm — preventing accidental deletion of the active
            production branch.
            **Canary authentication redesign (2026-07-25):** the original
            `SMOKE_AUTH_TOKEN` design (static GitHub secret) was replaced
            because `authenticateApiRequest` → `verifyToken` verifies Clerk
            session JWTs (~60s lifetime) — a static token would expire
            within a minute. The canary now mints a fresh session token
            per round via `scripts/run-authenticated-smoke.js` (create
            session → mint JWT → probe → revoke in `finally`), using
            `CLERK_SECRET_KEY` + `SMOKE_USER_ID` from Doppler. The JWT
            and secret are never printed or stored. Revocation failure
            fails the canary (security signal) without masking an earlier
            probe failure. Investigation confirmed Clerk does not offer a
            suitably restricted Backend API credential for session minting
            (M2M tokens and user API keys are wrong token types for the
            existing `verifyToken` path), so the full production
            `CLERK_SECRET_KEY` is used with blast-radius controlled by the
            protected GitHub `production` environment and the
            `team_member`-role provisioning of the smoke identity.
      - [ ] **1.7.B-execute** Operator-driven production deploy execution.
            The runbook must be exercised end-to-end on a real production
            deploy and the sign-off section filled with evidence (CI run URL,
            PITR drill output, migration artifacts, canary evidence, post-deploy
            verify). **Task 1.7 is not complete until this subtask is done.**
            Outstanding: the CI workflow and runbook are merged; the first
            real production deploy with this workflow has not yet been
            executed. Prerequisites before the first run: (1) complete
            task 1.6.B-execute (Neon dev-branch exercise); (2) merge the
            completed Phase 1 slice through 1.7.A into main; (3) configure
            the protected GitHub `production` environment (branch policy +
            15-min wait + `can_admins_bypass: false`) with secrets
            `NEON_API_KEY`, `SENTRY_AUTH_TOKEN` and variables `SENTRY_ORG`,
            `SENTRY_PROJECT`, `CANARY_WAIT_MINUTES`; (4) add `CLERK_SECRET_KEY`
            and `SMOKE_USER_ID` to Doppler production config; (5) provision
            the dedicated smoke-test identity **pair** (custodian admin
            that bootstraps the dedicated smoke org, then the smoke
            identity added second as `team_member` — see the runbook's
            Smoke-test identity provisioning section for why a
            single-user flow would produce an admin); verify with the
            runbook's SQL query that the smoke identity maps to a
            non-deleted application user with `role = 'team_member'` and
            a real `subscription_tiers` row; store only the smoke
            identity's Clerk ID as `SMOKE_USER_ID`; record both
            identities in the runbook sign-off); (6) set the repository
            variable `PRODUCTION_AUTO_DEPLOY_ENABLED` to `'true'` only
            when ready to allow push-to-main deploys (leave unset to
            require manual `workflow_dispatch` for the first run);
            (7) complete the runtime role separation — provision
            `app_runtime` on a `migration-role-check` branch first
            (create via SQL `CREATE ROLE`, set password via
            `\password`, grant DML/sequence/function privileges,
            explicitly `REVOKE ALL PRIVILEGES ON TABLE schema_migrations
            FROM app_runtime`, run `ALTER DEFAULT PRIVILEGES FOR ROLE
            neondb_owner`), verify with `scripts/verify-runtime-role.js`
            in **active-probe mode** (`RUNTIME_ROLE_ACTIVE_PROBE=1`),
            test the Worker against the branch, then provision on main
            and verify in **read-only mode** (no
            `RUNTIME_ROLE_ACTIVE_PROBE`), and update Doppler config
            (`DATABASE_URL_UNPOOLED`/`MIGRATION_ROLE` = `neondb_owner`,
            `NEON_CONNECTION_STRING` = pooled `app_runtime` URL); see
            the runbook's "Runtime role separation" section; (8) after
            the canary passes, delete the `migration-role-check`
            branch and the malformed `" migration_runner"` role from
            main (cleanup steps in the runbook).
            Evidence is committed
            in a small follow-up PR after the run — do not pre-edit the
            runbook sign-off as though evidence existed before deployment.
- [ ] 1.8 Require expand/migrate/contract metadata for every schema change, including compatibility,
      reversibility/data-loss class, backfill/resume plan, and the later contract deployment. Do not use
      destructive down migrations as the default rollback.
- [ ] 1.9 Verify production recovery before first migration: active Neon retention/PITR, named
      pre-migration recovery point, restore-to-new-branch drill, application verification, RPO/RTO, and
      responsible operator.
- [ ] 1.10 Add structured migration logs/status and alerts for failure, advisory-lock timeout, checksum
      mismatch, drift, duration, target identity, migration ID, and deployment SHA. Make Worker health
      execute a real database readiness query and verify Cloudflare observability/Sentry are enabled.
- [ ] 1.11 Document the new authoritative path and its recovery policies (the golden-rule rewrite itself lands in
      Phase 5).

> **Integration checkpoint — end PR 360 here.** PR 360 contains only the approved proposal and Phase 1
> migration foundation. Once Phase 1 is complete and its focused verification passes, update the PR
> summary, obtain review, and merge it to `main`. Do not add Phase 2–5 implementation to PR 360.
> Publish Phase 2 from a new short-lived branch based on the latest `main`.

## Phase 2 — Responsibility & parity audit (parallel with Phase 1; before removing anything)

Inventory **everything `backend/` owns**, not just HTTP routes. For each item, record a target: a Worker
equivalent, a relocated home, or an explicit retirement decision.

- [ ] 2.1 Generate a mounted-route matrix from `backend/src/index.ts` plus router mount prefixes—not
      filenames. For every Express and Worker method/path, record mounted/reachable status, frontend or
      operator consumer, auth type, role, tenant derivation, feature/usage limits, validation, rate limit,
      raw-body needs, request/response/status contract, side effects, and keep/replace/retire decision.
      Classify mounted+consumed, mounted+unconsumed, unmounted/dead, and Worker-only routes. Re-derive the
      full list; known gaps include Stripe webhook, invitations, storage quota, subscription
      checkout/cancel/portal/convert-trial, logout, health/metrics/alerts, product export/update/delete/
      legacy-upload, advanced reports, and backup create/list/restore. Do not implement the currently
      unmounted `admin.metrics.routes.ts` merely because its file exists.
- [ ] 2.2 Produce a test-coverage manifest mapping every backend test file/behaviour to an existing
      Worker equivalent, a **Worker-shaped rewrite** (Phase 3.2), or an explicit retirement. Preserve named
      gates for tenant isolation, penetration, concurrency, feature limits, webhook security, scheduled-job
      idempotency, authorization precedence, and negative/error cases; zero rows may remain unresolved at
      deletion. The Express test suite is **not ported to Postgres** — it keeps running on SQLite until
      deletion; this manifest is what its coverage maps onto in the Worker suite.
- [ ] 2.3 Produce an action-level schedule matrix from actual `SchedulerService` registrations and
      dormant job exports—not a six-file list. Include markdown recalculation, backup, trial expiration,
      dunning, Stripe sync, both credit-claim schedules, webhook monitoring, metrics, and report email.
      Record active/dormant/test-only status, cron/timezone, inputs/secrets, retries, overlap prevention,
      idempotency, observability, failure recovery, and Cron Trigger/Queue/retire target.
- [ ] 2.4 Operational scripts in `backend/scripts/` — seeds (`seed-users`, `seed-tier-feature-flags`),
      audits/backfills (`audit-org-ids`, `backfill-*`, `check-*-org-ids`), data export
      (`neon-to-sqlite`, `export-excess-products`), diagnostics (`diagnose-webhook`, `verify-neon*`,
      `test-r2-connection`), and `backup.sh`. Decide relocate / reimplement / retire for each. **Also
      decide the backup capability's home:** `backup.sh` + `backend/src/routes/database.backup.routes.ts`
      together implement operator-triggered backup — pick a Worker route, Neon-native backups, or a
      scheduled R2 export via a Cron Trigger, and put the backup route on the rehoming checklist.
- [ ] 2.5 Produce a single **rehoming checklist** mapping every endpoint, test, job, script, and the
      migration path to a target or a recorded retirement decision. Include middleware/runtime concerns
      (CORS, auth, tenant/role gates, rate limiting, error shape, Sentry, health/readiness, environment
      validation, shutdown), frontend network call sites, docs/runbooks, configuration, env templates,
      assets/generated files, package commands, workflows, and root tooling. This checklist gates all
      deletion in Phase 4.

> **Integration checkpoint — audit PR.** Keep the Phase 2 inventory and rehoming decisions in their own
> reviewable PR. Merge that PR to `main` before starting dependent Phase 3 implementation so every later
> branch uses the reviewed checklist as its deletion authority.

## Phase 3 — Worker parity + move dev/tests onto the Worker (gated on Phases 1–2)

> Build the Worker up beside the still-running SQLite Express backend. Coverage is written **once**,
> Worker-shaped — never the Express-shaped Postgres detour.

- [ ] 3.1 Implement Worker handlers + routes for each Express-only endpoint from the audit. **Must
      include the Stripe webhook inbound handler** (`POST /api/webhooks/stripe`) — the Worker handles Clerk
      webhooks only today, so this is net-new, not a port.
- [ ] 3.2 Write the migrated test coverage **once, against the Worker's `Request`/`Response` model** on
      pglite/Neon (there is no Express-shaped Postgres intermediate to port from). Reproduce the named gates
      from 2.2 — tenant isolation, penetration, concurrency, feature limits, webhook security,
      scheduled-job idempotency, authorization precedence — and get it green before any deletion.
- [ ] 3.3 Rehome the scheduled jobs per 2.3 (Cron Triggers / Queues) or execute their retirement; verify
      each fires on schedule. Add the Worker `scheduled()` dispatcher and Wrangler Cron Trigger
      declarations; test dispatch, overlap prevention, retry/idempotency, and alerting.
- [ ] 3.4 Relocate/reimplement the operational scripts kept in 2.4 (including the backup capability);
      execute retirement of the rest.
- [ ] 3.5 Initialize the pglite conformance harness from the **authoritative Phase 1 migrations/baseline**
      instead of its embedded `SCHEMA_SQL`, and drop the SQLite comparison arm — conformance becomes "raw
      SQL vs shared TS on Postgres". The conformance tests already live in `workers/src/__tests__/`
      (`database.conformance.node.test.ts`, `database.credit-claim.conformance.node.test.ts`,
      `database.supplier-policy.conformance.node.test.ts`, etc.), so this is a workers-side edit. Add a
      fresh-database drift test so the harness stops being an independent schema source.
- [ ] 3.6 Run the Worker locally (`wrangler dev`) as the dev API; verify the frontend works against it in
      local dev. Add the `wrangler dev` local config (`.dev.vars` / `wrangler.toml` dev section) pointing at
      a developer-owned Neon branch (vs production Hyperdrive), and document which behaviours need the Neon
      branch because pglite cannot model them.
- [ ] 3.7 Repoint the frontend dev API base URL from Express (port 3001) to the `wrangler dev` origin
      (port 8787): update the default in `frontend/src/lib/api.service.ts`, `frontend/.env.example`, and any
      `REACT_APP_API_URL` references in `vite.config.ts` / docs. Inventory every frontend network call and
      route it through the shared URL builder unless intentionally same-origin; browser-test frontend
      port 3002 → Worker port 8787 for storage quota, subscription checkout/cancel/portal, uploads, errors,
      and CORS.
- [ ] 3.8 Before implementation, record the currently registered production Stripe endpoint, the
      deployment that receives it, and the exact rollback target; do not assume the undeployed Express
      reference backend is reachable. Then cut Stripe webhooks over as a production change: add typed
      secret/config, raw-byte signature verification, supported-event contract, durable event
      idempotency/replay handling, Stripe endpoint registration, shadow/dev verification, monitored
      cutover, and rollback. Keep a deployable rollback receiver—normally the previous Worker
      deployment/route, or a deliberately temporary receiver—until Stripe delivery to the new Worker
      handler is confirmed.
- [ ] 3.9 Add one required database-conformance workflow triggered by `workers/**`, `shared/**`,
      authoritative migrations/schemas, and relevant root package/lock files. Run the Worker PGlite
      conformance job and the migration-runner job against an ephemeral PostgreSQL service with no
      production secrets; combine them in an always-reporting required gate. Fail rather than skip when
      the database is unavailable. Add a separate scheduled compatibility job against an isolated,
      auto-created Neon branch with guaranteed cleanup.

> **Integration checkpoint — parity PRs.** Implement Phase 3 as one or more independently safe,
> reviewable PRs based on the latest `main`; split by coherent responsibility when that reduces review
> risk. Every merged slice must leave the existing Express backend usable. Merge all Phase 3 PRs and
> satisfy the Phase 1–3 gates before opening the Phase 4 deletion PR.

## Phase 4 — Delete Express + Prisma + SQLite together (gated on Phases 1–3)

- [ ] 4.0 Tag the last Express+SQLite-capable revision immediately before the retirement commit so the
      fallback is recoverable by `git revert`/checkout if a post-deletion regression appears. Document and
      test the exact recovery commands while the tagged revision is still present.
- [ ] 4.1 **Only once the rehoming checklist (2.5) is fully satisfied and the Phase 1 runner has proven a
      real reversible schema change and its down path (1.6)**, remove `backend/` in one controlled retirement: the Express
      server, Prisma client, `better-sqlite3`, the Prisma **base** (SQLite) schema, the runtime
      `src/migrations/` SQLite migration runner (`migrate.ts`, `migration.service.ts`, `migration.model.ts`,
      numbered `*-*.migration.ts`), and the Prisma **production** schema. Delete only the obsolete copies of
      Neon SQL after their history/checksums have been preserved in the authoritative Phase 1 location.
      **Also delete** `workers/src/index.ts` and `workers/src/express-adapter.ts` (the abandoned
      express-adapter entry point — `index-minimal.ts` is the real one).
- [ ] 4.2 Prune dependencies and scripts from the workspace: remove `express`, `@prisma/*`,
      `better-sqlite3`, and the backend Vitest project from `package.json` files (root, `backend/`, and any
      workspace-level). Remove the now-dead npm scripts (`migrate:prod`, `dev:backend`, `seed:*`, the
      superseded migration scripts from 1.1, etc.). Retire `.github/workflows/backend-test.yml` — its
      multi-tenant coverage (cross-tenant isolation, penetration, concurrency, feature-gate enforcement) is
      already rehomed onto the Worker suite in Phase 3.2, so removing it loses nothing.

> **Integration checkpoint — dedicated retirement PR.** Phase 4 is a separate, controlled deletion PR
> based on the latest `main`. Retain the full backend suite as its final regression gate, in addition to
> the replacement Worker and migration gates. Do not mix unrelated cleanup into the retirement commit;
> land optional closeout work in Phase 5.

## Phase 5 — Conventions & closeout

- [ ] 5.1 Rewrite `openspec/project.md` golden rules 5 & 6 for a single backend / single migration path,
      naming the Phase 1 runner as the authoritative mechanism (replacing `prisma db push`).
- [ ] 5.2 Update the PR/contribution checklist to drop the triplicated-schema and dual-backend-parity
      rules and replace them with the single-backend equivalents.
- [ ] 5.3 Update `workers/README.md` (remove the "reuse 100% of the backend via express-adapter" framing;
      document the Worker as the sole API, the local-dev-on-Postgres flow, and where jobs/scripts now live).
- [ ] 5.3a Update or explicitly retire all dual-environment/Express/SQLite guidance in root `README.md`,
      `AGENTS.md`, `docs/` developer, environment, QA, troubleshooting, security, deployment, backup and
      operational runbooks. Rehome still-valid material from `backend/docs/` before deleting the directory.
- [ ] 5.4 `npx openspec validate retire-express-unify-on-postgres --strict`.
- [ ] 5.5 Archive this change once merged and live.

## GSTACK REVIEW REPORT

| Review        | Trigger               | Why                  | Runs | Status         | Findings                                                                                                                                        |
| ------------- | --------------------- | -------------------- | ---: | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| CEO Review    | `/plan-ceo-review`    | Scope & strategy     |    0 | —              | Optional; no product expansion proposed                                                                                                         |
| Codex Review  | review feedback       | Independent review   |    2 | Addressed      | (1) Migration ownership + full backend audit added; (2) staged engine-swap identified as throwaway — plan re-sequenced to direct retirement     |
| Eng Review    | `/plan-eng-review`    | Architecture & tests |    1 | Addressed      | Phase 0 decisions cleared; migration dependency, CI target, Stripe rollback topology, recovery semantics, and deletion checkpoint made explicit |
| Design Review | `/plan-design-review` | UI/UX gaps           |    0 | Not applicable | Infrastructure/backend consolidation                                                                                                            |
| DX Review     | `/plan-devex-review`  | Developer experience |    0 | Covered here   | Local DB, CI, commands, rollback, and docs included                                                                                             |

- **RESOLVED:** staged-versus-direct retirement sequence (direct path); measurable friction trigger
  (0.1, met by #390/#394); sole-Worker product approval (0.2, 2026-07-24); local/CI database story
  (0.3, 2026-07-24); go/no-go (0.4, **GO** 2026-07-24).
- **UNRESOLVED:** none in Phase 0.
- **VERDICT:** **Phase 0 Decision Gate cleared — GO.** Phase 1 (migration foundation) is unparked;
  Phases 3–4 remain gated on Phases 1–2. Strict OpenSpec validation is required after every further
  edit, and each production cutover retains its own verification/rollback gate.
