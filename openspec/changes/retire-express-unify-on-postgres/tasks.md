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
      **Hardening (2026-07-28, after the real Neon `migration-role-check`
      branch exercise surfaced two safety gaps):**
      - **Dry-run exit code.** The adopt CLI now exits **non-zero** on
        EVERY refusal — catalog mismatch OR a populated ledger — in BOTH
        dry-run and apply modes. `STATUS: READY` (and only that) exits 0.
        Previously a `--dry-run` refusal exited 0 (treated as
        "informational"), which let a refused dry-run pass a `set -e` /
        CI gate silently: the branch exercise ran
        `migrate:adopt -- --dry-run` against a production-shaped database
        missing migration `0001_queued_catalogue_imports`, the report
        printed `STATUS: REFUSED — catalog does not match expected
        schema`, but the process exited 0 and did not stop the sequence.
        The decision lives in `adoptExitCode(report)` (`adopt.ts`),
        consumed by `adopt-cli.ts`, with a unit test covering READY
        (exit 0), catalog mismatch (exit 1), and populated ledger
        (exit 1). The runbook's first-production adoption procedure
        (step B) now relies on this: the read-only dry-run is the
        operator gate, and a refusal MUST fail `set -euo pipefail`.
      - **First-production adoption procedure.** The runbook now
        documents the one-time adoption gate as a corrected, ordered
        sequence: preflight → reconcile-0001-if-required (read-only
        dry-run → review → guarded psql apply of the reviewed
        `0001_queued_catalogue_imports.up.sql` → re-dry-run until
        `STATUS: READY`) → adopt apply at `MIGRATION_ADOPTION_POINT=0009`
        (stamps `0000`–`0009`, leaves `0010` pending) → status (confirm
        only `0010` pending) → apply `0010` → status → seed → verify →
        re-REVOKE ledger access → runtime-role verification. The
        `0001` schema gap (15 missing `uploads` columns + the
        `uploads_one_active_catalogue_per_org` partial index) is
        reconciled by applying the reviewed 0001 SQL directly via a
        guarded psql confirmation token — it is NOT allowlisted
        (allowlisting would leave production with a schema that does
        not match the migration history, breaking every future
        `migrate:verify`). Adopt-at-0009 (not 0010) is documented with
        its rationale: `0010` is a real expand migration whose SQL has
        not yet run, so stamping it as `applied` would leave the column
        at `integer` while the ledger claims `0010` is done.
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
      is updated (Phase 4). Tests: `commands.test.ts` covers all guards + commands (26 new tests,
      pglite-backed); existing `adopt.test.ts`/`runner.test.ts`/`baseline.fingerprint.test.ts`
      updated for 0010. Current `npm run test:migrations` → 68/68 pass.
- [x] 1.6 Prove the runner end-to-end against isolated PostgreSQL/Neon targets: fresh install,
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
            (passwords redacted). The 54-row contract includes the six current `storage_bytes` limits,
            so the guarded down first proves that PostgreSQL refuses the five out-of-int4 values, then
            succeeds only after an explicit lossy preparation on the isolated branch; the forward fix
            widens the column and reseeds the declared values.
      - [x] **1.6.B-execute** Operator-driven Neon gate execution — **DONE 2026-08-05** (SHA
            `f2255486`, operator jatwell93). Runbook exercised end-to-end on isolated Neon dev
            branches (the production Neon project), all five steps PASS; sign-off + redacted
            evidence under `docs/evidence/2026-08-05-1.6b/`. Because production was cut over to 0011
            in 1.7.B and free-tier PITR is only 6h, the drill was **adapted** (documented inline in
            the runbook): (a) ADOPTION branch built **synthetically** — replay 0000→0009 via psql
            (pure DDL, no ledger), then adopt at 0009, then apply 0010+0011; (b) forward-fix deletes
            **both** 0010+0011 ledger rows because `validateLedger` enforces a contiguous prefix and
            0011 sits on top of 0010 (0011 is idempotent `ADD COLUMN IF NOT EXISTS`); (c) restore
            drill uses `neonctl branches restore <b> ^self@<LSN>` (LSN restore-in-place — this
            neonctl can't PITR a non-default branch, and second-precision timestamps were skew-prone);
            (d) old-Worker check is a lightweight driver-level compat proof (the Worker never reads
            `limit_value`; ran the pre-0011 `/api/subscription/current` column list + an int8 read via
            `@neondatabase/serverless` against the expanded schema — both OK) instead of a wrangler
            preview deploy. Also fixed several runbook bugs found during execution: role is
            `neondb_owner` not `postgres`, parent branch is `production` not `main`, `migrate:adopt`
            needs `-- --dry-run`/`-- --apply`, and the CLI reads `MIGRATION_ADOPT_CONFIRMATION` (no
            "ION"). CI `Migrations E2E Gate` ran green on PR #441 (run 31070788459); URL recorded in the runbook sign-off.
- [x] 1.7 Integrate migrations into deployment: validate history; store dry-run/status output as an
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
            unit tests (23 + 21 + 17 + 29 tests, mocked fetch),
            totalling 90. The fourth script,
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
            Total script tests: 183 (97 existing + 68 runtime-role +
            18 Worker-binding/isolation; the 97 existing tests include
            90 across the four migration scripts + 6 across
            `validate-stripe-deployment-config` and
            `mem-memory-scripts`, plus 1 root lifecycle test).
            **Ledger detection hardening (2026-07-28):**
            `checkCannotAccessLedger` now probes ledger existence via
            `pg_catalog` (`pg_class` joined to `pg_namespace`), NOT
            `information_schema.tables`. The old probe queried
            `information_schema.tables`, which only lists tables the
            current role has some privilege on — so once
            `REVOKE ALL PRIVILEGES ON TABLE schema_migrations FROM
            app_runtime` is applied, `information_schema.tables` HIDES
            the ledger and the existence check reported
            `ledgerExists: false`, passing vacuously without ever
            verifying that all seven privileges are denied. This is
            exactly the false negative observed during the real Neon
            `migration-role-check` branch exercise:
            `runtime-role-evidence.json` reported `ledgerExists: false`
            while a direct `pg_class` / `has_table_privilege` probe
            (`runtime-ledger-privileges-role-check.txt`) proved
            `ledger_exists=t` with all seven privileges denied.
            `pg_class` is a system catalog visible to every role
            regardless of table privileges, so an existing-but-
            inaccessible ledger is always detected. Three regression
            tests cover the inaccessible-ledger detection, the
            residual-granted-privilege failure (no vacuous pass), and a
            structural guard that the existence query hits
            `pg_class`/`pg_namespace` and does NOT hit
            `information_schema.tables`. Runtime-role script tests:
            71 (68 + 3 new).
            **Post-adoption REVOKE ordering (2026-07-28):** the
            provisioning-time `REVOKE ALL PRIVILEGES ON TABLE
            schema_migrations FROM app_runtime` is necessary but not
            sufficient — adoption runs `ensureLedger` as `neondb_owner`,
            and `ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN
            SCHEMA public GRANT ... ON TABLES TO app_runtime`
            auto-grants DML on the ledger the moment adoption creates
            it. A REVOKE applied before the ledger exists does not
            cover this auto-grant. The runbook's first-production
            adoption procedure (step F) re-applies the REVOKE
            immediately after adoption creates the ledger, and step G
            runs the corrected verifier (expecting `ledgerExists=true`)
            after that re-REVOKE. The runbook sign-off section now
            includes an Adoption sign-off block (adoption point,
            migrations stamped, `0010` applied, seed/verify PASS, 0001
            gap reconciled, ledger REVOKE re-applied, runtime-role
            verification PASS with `ledgerExists=true`).
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
            `scripts/verify-workers-deploy-bindings.test.js` (18 tests,
            dependency-free line-based YAML scanner), parses
            `workers-deploy.yml` and asserts the binding step exists
            and precedes `wrangler deploy`. It also verifies that preview
            migration validation uses the dedicated least-privilege
            `MIGRATION_DOPPLER_TOKEN`, not the broader development deployment
            token, and that the
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
            **Adoption safety hardening (2026-07-28):** nine findings
            from the `migration-role-check` branch exercise were
            addressed. (1) The adoption procedure is split into two
            tracks — a **branch proof track** (disposable
            `migration-role-check` branch, full manual A–G including
            `migrate:apply`/`migrate:seed`/`migrate:verify`) and a
            **production adoption track** (A–D, F–G, then hand off to
            the protected GitHub workflow which applies `0010`, seeds,
            verifies, deploys, and canaries inside the CI gate). Step E
            (manual apply/seed/verify) is branch-proof only — running it
            manually on production bypasses the protected workflow and
            is forbidden. (2) A **pre-adoption PITR gate** is mandatory
            before any production reconciliation or adoption DDL — a
            fresh restore-to-new-branch drill (Step 1) must pass within
            2 hours of starting step A on production; the branch proof
            track does not require this (the branch is disposable). (3)
            The direct `0001` reconciliation psql invocation is guarded
            with four checks: reuses `$DATABASE_URL_UNPOOLED` (no
            separately pasted URL), derives the confirmation token from
            the validated target, confirms `current_user = neondb_owner`
            before any DDL, prechecks for organizations with multiple
            active uploads (which would prevent the unique partial index
            from being created), and runs
            `psql --single-transaction -v ON_ERROR_STOP=1` so any error
            rolls back the entire migration. (4) The `set -e` conflict
            with the expected adoption dry-run refusal is fixed — the
            dry-run exit code is initialized to 0 then captured
            explicitly (`DRY_RUN_EXIT=0; ... || DRY_RUN_EXIT=$?`) and
            the script branches on `READY` (exit 0) versus `REFUSED`
            (exit 1) instead of letting `set -e` close the interactive
            shell on the expected refusal. (5) Thirteen operator
            evidence files from the branch exercise were moved outside
            the worktree (`~/migration-role-check-evidence/`) so they
            are not included in the source commit. (6) The precheck
            query was fixed to query only `status` (not `import_type`,
            which is one of the missing columns) — the original query
            failed silently with `column does not exist`, became
            `PRECHECK_SKIPPED`, and allowed execution to continue; the
            error suppression (`2>/dev/null || echo PRECHECK_SKIPPED`)
            and skip path were removed so any precheck error aborts. (7)
            The dry-run exit code is now initialized to `0` before each
            run (`DRY_RUN_EXIT=0`) so a stale value from a previous
            dry-run in the same shell cannot persist if the current one
            succeeds. (8) A one-time environment setup block (step 0)
            was added before step A — it securely exports
            `DATABASE_URL_UNPOOLED` and all migration guard variables
            (host, database, environment, role, confirmation token
            derived from the validated target) so subsequent steps A–G
            reuse them instead of redeclaring inline (which did not
            persist between blocks). (9) The URL prompt uses
            `read -r -s` (silent, no echo) so the production password
            is not visible in the terminal, and the deployment SHA is
            derived from `git rev-parse HEAD` instead of typed manually
            to prevent a typo or unrelated SHA from entering the
            adoption ledger. The sign-off section was updated to
            reflect the two-track structure (branch proof completion,
            pre-adoption PITR gate, production hand-off via workflow).
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
      - [x] **1.7.B-execute** Operator-driven production deploy execution.
            **DONE 2026-08-04.** The runbook was exercised end-to-end on the
            first real production deploy: `workflow_dispatch` run
            [30868236574](https://github.com/jatwell93/date-management-app/actions/runs/30868236574)
            completed `success` (SHA `b240631a`) — Migration prep (full)
            PITR ✓ → `migrate:apply ["0010","0011"]` (0000–0009 already
            applied via the 2026-07-31 adoption stamp) → `migrate:seed` 54
            rows → `migrate:verify` PASS; deploy-production ✓; post-deploy
            canary ✓ BOTH rounds. Sign-off section of
            `docs/migrations-deploy-runbook.md` filled with evidence
            (adoption at 0009, runtime-role separation PASS, smoke-identity
            record, CI/PITR/canary artifacts). Runtime-role cleanup complete
            (2026-08-04): `migration-role-check` branch + malformed
            `" migration_runner"` role deleted after the canary passed.
            `PRODUCTION_AUTO_DEPLOY_ENABLED` set to `'true'` on 2026-08-04
            (push-to-main auto-deploy enabled). Canary targets the
            `*.workers.dev` URL to bypass free-plan Bot Fight Mode (PR #436).
            Original prerequisites before the first run (all met): (1) complete
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
- [x] 1.8 Require expand/migrate/contract metadata for every schema change, including compatibility,
      reversibility/data-loss class, backfill/resume plan, and the later contract deployment. Do not use
      destructive down migrations as the default rollback.
- [x] 1.9 Verify production recovery before first migration: active Neon retention/PITR, named
      pre-migration recovery point, restore-to-new-branch drill, application verification, RPO/RTO, and
      responsible operator.
      Executed 2026-08-07 (operator `jatwell93`) as a **regular post-adoption**
      drill — production was already cut over to `0011` (1.7.B), so
      `migrate:verify` had to genuinely PASS rather than use the 1.7.B
      pre-adoption criteria. All clauses met: retention 6h (`21600s`, now
      enforced by the CI gate), named recovery point
      `pre-migration-20260807035216`, restore + 5 operations terminal-success,
      `migrate:verify` PASS (no production drift), application verification 6/6
      via the Worker's own driver, RPO 3s / RTO 13s. Evidence:
      `docs/evidence/2026-08-07-1.9/`; sign-off in
      `docs/migrations-deploy-runbook.md` ("Recovery policy sign-off").
- [x] 1.10 Add structured migration logs/status and alerts for failure, advisory-lock timeout, checksum
      mismatch, drift, duration, target identity, migration ID, and deployment SHA. Make Worker health
      execute a real database readiness query and verify Cloudflare observability/Sentry are enabled.
      **DONE 2026-08-08.** Delivered in four parts:
      (a) **Structured logs.** `src/database/migrations/log.ts` emits one JSON
      line per command phase (`start`/`success`/`failure`) carrying command,
      migrationId, redacted host/database, environment, deploymentSha,
      durationMs, errorClass and a redacted message. Wired into all six CLIs.
      Error classification is typed, not message-matched:
      `MigrationCodedError` + `classifyMigrationError` in `runner.ts` cover
      `lock-unavailable`, `checksum-mismatch`, `ledger-inconsistent`,
      `target-rejected`, `catalog-drift` and an `execution-failure` fallback,
      with every converted throw site keeping its message byte-identical.
      `preflight`, `seed` and `verify` signal failure via `process.exitCode`
      without throwing, so each emits an explicit failure event rather than a
      false success; `verify` maps an unverified report to `catalog-drift`.
      **Alerting is the structured line plus a failing CI job** — no Sentry SDK
      or logging dependency was added to the migration path (decision recorded
      2026-08-08).
      (b) **Worker readiness.** `workers/src/health.ts` previously reported
      `database: pass` whenever `NEON_CONNECTION_STRING` was a non-empty string
      and executed no query. It now runs a bounded `SELECT 1` through
      `@neondatabase/serverless`, fails closed on error or timeout, and redacts
      credentials from the reported error. Failure-path tests (throw, timeout,
      credential leak) are the point of the suite.
      (c) **Observability enforced, not attested.** Three silent-no-op paths were
      found and closed: `wrangler.toml` declared `[observability] enabled = false`
      while the nested logs/traces blocks declared `true` (the file is what
      `wrangler deploy` pushes, so a deploy could have disabled logging);
      `Sentry.withSentry` initialises with `dsn: undefined` when the secret is
      absent; and the canary skipped its Sentry step entirely when `SENTRY_*`
      were unset. `scripts/verify-observability-config.test.js` (static, runs
      pre-deploy in both deploy jobs) and `scripts/check-observability.js`
      (+39 unit tests) now gate these, and missing Sentry configuration is a hard
      canary failure on production. The Sentry API call itself still fails open —
      an outage is a third-party problem, missing configuration is ours.
      (d) **Live verification (2026-08-08, operator jatwell93).** Cloudflare
      Workers Logs confirmed enabled on `date-management-api-prod` and the
      wrangler master switch corrected to match. `WORKERS_SENTRY_DSN` was
      **found not bound at all** — the cause of an empty `node-cloudflare-workers`
      project — bound via `wrangler secret put`, and the two dead lookalikes
      (`SENTRY_DSN`, `WORKER_SENTRY_DSN`, read by nothing) retired. Ingest then
      verified: 66 transactions + 82 spans accepted into project
      `4510844953493504` in 24h. Sentry token moved to an Internal Integration
      with `org:read` + `project:read` + `event:read`; an Organization Auth Token
      carries only `org:ci` and cannot read this data.
      Two sign-offs citing `/health?deep=true` as database evidence are
      re-qualified in `docs/migrations-deploy-runbook.md` (1.7.B post-deploy
      verify line, and the Canary edge note).
      **Located during 1.9 (2026-08-07):** the readiness defect is
      `workers/src/health.ts` — the `?deep=true` database check reports
      `status: 'pass'` whenever `NEON_CONNECTION_STRING` is a non-empty string
      and **executes no query**, so it cannot detect an unreachable or
      unauthorised database. This is why 1.9's application verification queries
      through the driver directly (`scripts/verify-app-against-branch.js`)
      rather than calling the endpoint. It is also a **live caveat on two
      existing sign-offs** that cite `/health?deep=true → database pass` as
      database evidence: the 1.7.B production sign-off, and the runbook's
      "Canary edge note" (`docs/migrations-deploy-runbook.md:2388-2393`), which
      uses it to verify the custom-domain edge that the canary skips. Both
      claims are weaker than they read until this task lands; re-qualify them in
      the runbook when it does.
- [x] 1.11 Document the new authoritative path and its recovery policies (the golden-rule rewrite itself lands in
      Phase 5).
      **DONE 2026-08-11.** `docs/migrations.md` (new) is the authoritative-path
      document: what owns migrations (runner + `database/migrations/` history +
      the `schema_migrations` ledger and its four fail-closed invariants), the
      ordered `migrate:*` commands and their environment contracts read from the
      root `package.json` and each CLI header, the safety model, the reusable
      `migration-prep.yml` → `workers-deploy.yml` deploy path, testing, and a
      recovery section that **links** rather than restates. Operating RPO is
      stated as the 6-hour retention window, with the 1.9 sign-off's 3 s figure
      explicitly labelled the planned-migration floor.
      Cross-links added: a scope banner on `docs/database-migrations.md` (its
      `prisma db push` production instructions are now marked not-the-path),
      plus pointers in `docs/neon-workflow.md` and `docs/architecture.md`.
      **One correction beyond the brief:** `docs/disaster-recovery.md` declared
      "RPO: 1 hour maximum data loss" — an aspiration, not a measured
      capability, and wrong in the *dangerous* direction (same defect class as
      the "7-day retention" claim 1.9 fixed). Restated as bounded by the 6-hour
      PITR window, citing `docs/neon-backup-restore.md`.
      Two brief inaccuracies were **not** carried into the doc: there is no
      "expand-only enforcement" (contract migrations are permitted; what
      `runner.ts:324` enforces is that a planned contract names a later,
      existing migration), and `runner.ts:224` is `assertSafeHistoryFile`, not a
      compatibility guard. Every cited path, npm script and environment variable
      was mechanically verified against the repo before commit.
      **Partially delivered by 1.9 — do not redo.** The *recovery policy* half
      now exists: `docs/neon-backup-restore.md` records the **measured** Neon
      configuration (free tier, `history_retention_seconds = 21600` = 6h) and
      the accept-no-upgrade decision, replacing the previous "Starter plan,
      7-day retention" claim that was wrong by 28× in the dangerous direction;
      `docs/migrations-deploy-runbook.md` carries the "Recovery policy sign-off
      (task 1.9)" section and points Step 1 at `scripts/pitr-drill.sh`; and the
      retention floor is **CI-enforced** by `scripts/check-neon-pitr.js` rather
      than asserted in prose. What remains for 1.11 is the *authoritative path*
      half — one document describing the runner, the ordered commands (1.5), and
      the deploy workflow as the single migration mechanism — plus cross-links
      from the general docs to the recovery material above. State the operating
      RPO as the **6-hour retention window**, not the 3 s figure in the 1.9
      sign-off: that 3 s is the planned-migration floor (the drill takes its
      recovery point immediately before restoring) and an unplanned incident has
      no fresh snapshot waiting.

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
      **Finding acted on mid-audit (PR #462).** Part 4 established that
      `workers/src/__tests__/multi-tenant-isolation.test.ts` asserts nothing — all 8 tests are
      `expect(true).toBe(true)` under names describing real tenant-isolation properties (90 such
      tests across 8 Worker files). Following that to the code it claimed to cover found four live
      authenticated routes returning **every** tenant's rows: `GET /api/products`,
      `/api/products/:id`, `/api/inventory-items`, `/api/store-areas`. Six `Database` methods took
      no organization parameter at all. Fixed rather than filed, because it was live on `main` —
      `organizationId` is now a required first parameter (a forgetful call site fails to compile),
      covered by 11 real-SQL assertions in `database.tenant-isolation.pglite.node.test.ts` and
      proven by mutation. The same PR added `.github/workflows/workers-test.yml`: **the Worker
      suites previously ran in no workflow at all**, which is why two `health.test.ts` tests sat
      red on `main` from 2026-06-09 (`d11d1f97`) unnoticed. `Workers CI Gate` is now a required
      check. This does not close 2.2 — it removes two rows from 3.2's rewrite scope (see below)
      and leaves the rest of the manifest to finish.
- [x] 2.3 Produce an action-level schedule matrix from actual `SchedulerService` registrations and
      dormant job exports—not a six-file list. Include markdown recalculation, backup, trial expiration,
      dunning, Stripe sync, both credit-claim schedules, webhook monitoring, metrics, and report email.
      Record active/dormant/test-only status, cron/timezone, inputs/secrets, retries, overlap prevention,
      idempotency, observability, failure recovery, and Cron Trigger/Queue/retire target.
- [x] 2.4 Operational scripts in `backend/scripts/` — seeds (`seed-users`, `seed-tier-feature-flags`),
      audits/backfills (`audit-org-ids`, `backfill-*`, `check-*-org-ids`), data export
      (`neon-to-sqlite`, `export-excess-products`), diagnostics (`diagnose-webhook`, `verify-neon*`,
      `test-r2-connection`), and `backup.sh`. Decide relocate / reimplement / retire for each. **Also
      decide the backup capability's home:** `backup.sh` + `backend/src/routes/database.backup.routes.ts`
      together implement operator-triggered backup — pick a Worker route, Neon-native backups, or a
      scheduled R2 export via a Cron Trigger, and put the backup route on the rehoming checklist.
      **Two corrections from Phase 1 execution (2026-08-05/07):**
      (a) The seed inventory is incomplete and its decision is already made.
      `backend/scripts/` holds **two** seeders — `seed-tier-feature-flags.js`
      (listed above) and `seed-tier-flags.js` (not listed) — and **both are
      superseded**, not open decisions. The authoritative 54-row
      `tier_feature_flags` reference set now lives in
      `src/database/migrations/seed.ts:34`, is applied by `migrate:seed`, and is
      enforced by `migrate:verify`; 1.9's production drill verified it against
      restored data. Record both as **retire with the backend** rather than
      re-deciding. Note this when auditing: it was `seed-tier-flags.js` (not the
      similarly named `seed-tier-feature-flags.js`, which contains no
      `limit_value` at all) that historically owned the oversized `storage_bytes`
      values — a review comment during 1.9 cited the wrong file on exactly this
      confusion.
      (b) The backup-capability decision now has a **measured constraint**:
      Neon free-tier PITR reach is **6 hours**, and the Free plan allows exactly
      **one manual snapshot per project**. "Neon-native backups" alone therefore
      buys a 6-hour recovery window and a single retained restore point — weigh
      that against the scheduled-R2-export option rather than treating
      Neon-native as unbounded durability.
      (c) **2.3 measured what is being replaced** (schedule matrix row 3, Finding 12): the current
      scheduled backup file-copies the SQLite database to `backup-<timestamp>.sqlite`
      (`services/database.backup.service.ts:44`) and retains **30 days / 10 files** (`:11-15`).
      Combined with (b), "Neon-native backups" alone is therefore **not** like-for-like — it is a
      reduction from 30 days of restore points to a 6-hour window and one snapshot. Only the
      scheduled-R2-export option preserves the current posture. Note also that the backup service
      has no Postgres path whatsoever, so this is a reimplementation, not a relocation, and the
      scheduled half of it (`scheduler.service.ts:56`) is recorded as retire-with-the-backend.
- [x] 2.5 Produce a single **rehoming checklist** mapping every endpoint, test, job, script, and the
      migration path to a target or a recorded retirement decision. Include middleware/runtime concerns
      (CORS, auth, tenant/role gates, rate limiting, error shape, Sentry, health/readiness, environment
      validation, shutdown), frontend network call sites, docs/runbooks, configuration, env templates,
      assets/generated files, package commands, workflows, and root tooling. This checklist gates all
      deletion in Phase 4.
      **Pre-recorded "keep" entries (Phase 1 output).** Phase 1 added operational
      tooling in **root `scripts/`**, outside `backend/` and therefore outside
      2.4's inventory. It must be entered on this checklist as **keep** so it is
      not swept up as unaudited root tooling in Phase 4:
      `check-neon-pitr.js` (CI PITR + retention gate), `pitr-drill.sh` (runbook
      Step 1), `neon-poll-operations.js`, `verify-runtime-role.js`,
      `verify-app-against-branch.js`, and `run-authenticated-smoke.js` (canary
      session minting) — each with unit tests beside it. Their docs
      (`docs/migrations-deploy-runbook.md`, `docs/migrations-e2e-runbook.md`,
      `docs/neon-backup-restore.md`) and the `docs/evidence/` sign-off
      directories are likewise keep, not dual-backend material.
      **Delivered:** `audit/2.5-rehoming-checklist.md` — thirteen sections (§A–§M).
      §A–§D roll up 2.1–2.4 by decision class rather than restating 1,977 test rows
      and 135 route rows; §E–§M enumerate at row level the categories no prior task
      covered (migration path, middleware/runtime, frontend call sites, docs,
      config/env, assets/generated, package commands, workflows, root tooling).
      Findings 21–24 recorded there.
      **Four things must clear before Phase 4 opens**, all named in the deletion-gate
      summary: (i) Josh's review pass over every `PROPOSED:` row in 2.1–2.5 — this
      checklist is not authoritative until reviewed; (ii) Finding 18's read-only
      production query (operator work, discharges five 2.4 rows); (iii) the **#477**
      decision on webhook monitoring (unblocks three 2.3 rows); (iv) the four reserved legacy-auth
      endpoint decisions from 2.1, plus the customer-facing export gap in Finding 26 (filed as
      **#482**). This clause read "23 open endpoint decisions", then 42; the real figure is **44**,
      all worked through on 2026-08-28 with **40 settled and 4 reserved**. Both miscounts came from
      ad-hoc extraction scripts rather than from the matrix, and are recorded as 2.5 Finding 27 —
      read it before writing any tooling against these tables, because one of the two faults
      (escaped pipes shifting the column index) will silently skip rows for anyone who repeats it.
      **The per-decision split lives in §A of `audit/2.5-rehoming-checklist.md` and is deliberately
      not restated here.** It was restated once and went stale within a day, when Finding 26
      reversed two rows from retire to rehome. The checklist's own preamble gives the rule — a
      second copy of a derived number drifts from the first — and a count in `tasks.md` is exactly
      that second copy. Read §A for the numbers; this file records only that 40 are settled and 4
      are reserved.
      **Five capabilities have no owner in either backend** and are net-new build
      work rather than relocation: business-rule integrity (`data-integrity.middleware.ts`,
      used by three mounted route groups), usage limits (already **#471**), security
      headers (`helmet` has no live Worker equivalent), environment validation
      (`config/environment.ts` fail-fast has no live Worker equivalent), and the
      backup capability (Finding 17).

> **Integration checkpoint — audit PR.** Keep the Phase 2 inventory and rehoming decisions in their own
> reviewable PR. Merge that PR to `main` before starting dependent Phase 3 implementation so every later
> branch uses the reviewed checklist as its deletion authority.

## Phase 3 — Worker parity + move dev/tests onto the Worker (gated on Phases 1–2)

> Build the Worker up beside the still-running SQLite Express backend. Coverage is written **once**,
> Worker-shaped — never the Express-shaped Postgres detour.

- [ ] 3.1 Implement Worker handlers + routes for each Express-only endpoint from the audit. **Must
      include the Stripe webhook inbound handler** (`POST /api/webhooks/stripe`) — the Worker handles Clerk
      webhooks only today, so this is net-new, not a port.
      **Two routes are documented to customers and must be rehomed, not retired (2.5 Finding 26).**
      `GET /api/products/export-excess` and `DELETE /api/products/{id}` are steps 2 and 4 of the
      documented tier-downgrade remediation flow (`docs/tier-downgrade-guide.md:174-178` and
      `:148-153`), and the export is repeated in `docs/trial-expiration-faq.md:218` and in
      in-product copy at `frontend/src/components/TrialFAQ.tsx:67`. Neither has a code call site,
      which is why 2.1 first classified them `mounted+unconsumed`; the consumer is a customer
      following instructions. Retiring them would 404 a documented procedure at the moment a
      locked-out customer is most likely to follow it. The `export-excess-products.ts` script is an
      operator tool and is not a substitute for a customer-invoked endpoint.
      **From 2.5 §F — rehome into the live path, never into the dead one.** `workers/build.js:11`
      bundles `index-minimal.ts`; anything reachable only from `workers/src/index.ts` is not
      deployed (Finding 22). Where the live implementation is inline rather than a named module,
      2.5 §F names it: CORS → `utils/worker-response.ts:12`, rate limiting →
      `utils/minimal-rate-limit.ts` (live at `index-minimal.ts:342-364`), roles →
      `constants/roles.ts`, error shape → `utils/worker-response.ts`, health → `health.ts`.
      **Four gaps in §F need a Worker home and are net-new build work**, separate from the three
      deferred defects below: business-rule integrity (`data-integrity.middleware.ts`
      `validateBusinessRules`, used by `inventory.routes.ts:9`, `product.routes.ts:7`,
      `store-area.routes.ts:6` — no live Worker equivalent located); security headers (`helmet` at
      `index.ts:73-74` — the live Worker sets no `X-Content-Type-Options`, HSTS or CSP);
      environment validation (`config/environment.ts` fail-fast — the live Worker trusts 36
      declared env keys with none, and the purpose-built `setWorkerConfig` export at `:230` has no
      production importer); and body-size limits (Express caps JSON at 10 MB, the Worker caps only
      uploads, at 25 MB — the intended value is a decision, not a copy).
      **One frontend fix belongs to this task (2.5 Finding 21).**
      `frontend/src/components/StorageQuotaWarning.tsx:61` fetches a **relative**
      `/api/storage-quota/...`, not `buildApiUrl(...)`. The frontend is Vite with no dev proxy and
      no Pages `_redirects`, so the request goes to the Pages origin and never reaches the API; the
      `catch` swallows it, so a quota warning that never appears is indistinguishable from a user
      under quota. The live Worker has no `/api/storage-quota` route, so building it and correcting
      the call site is one piece of work. **Its test pins the defect** —
      `__tests__/StorageQuotaWarning.test.tsx:54-55` asserts the literal relative path, so the
      corrected code fails that test until it is updated to assert the built URL.
      - [x] 3.1.0 **Delete the dead Worker API layer first, before any other 3.1 work** (2.5 Finding 22).
            `workers/build.js:11` bundles `workers/src/index-minimal.ts` and `workers/wrangler.toml:2`
            deploys that bundle, so nothing reachable only from `workers/src/index.ts` runs in
            production. That abandoned entry point is not two files. These nine modules have their
            **only** production importer in `index.ts`: `middleware/cors.middleware.ts`,
            `error-handler.middleware.ts`, `security-headers.middleware.ts`,
            `rate-limit.middleware.ts`, `metrics.middleware.ts`,
            `connection-limiter.middleware.ts`, `query-limiter.middleware.ts`,
            `require-role.middleware.ts`, and `middleware/auth.ts`. `workers/src/utils/auth.ts` has
            no production importer at all. Several carry passing test files, so the layer looks
            maintained.
            **Delete here rather than in 4.1, because this is a prerequisite for the rest of 3.1,
            not cleanup.** Every rehoming decision in 3.1.a–3.1.k asks "where does this Express
            concern go in the Worker?", and for CORS, error shape, security headers, rate limiting,
            roles and metrics the well-named module is the wrong answer — rehoming into it produces
            a second generation of code that passes its tests and never executes. Removing the
            decoy costs one commit; leaving it costs a wrong answer on each of those rows.
            **Scope:** `workers/src/index.ts`, `workers/src/express-adapter.ts`, the nine middleware
            modules above with their test files, and `workers/src/utils/auth.ts` with its test.
            **Two exclusions.** `workers/src/utils/feature-gates.ts` stays until **#471** resolves —
            that fix may repair it rather than replace it (3.1.a). And confirm before deleting that
            no test file imports a middleware module for a behaviour with no other coverage; where
            one does, the 2.2 row for that behaviour governs whether it is rewritten Worker-shaped
            or retired.
            **Live targets to rehome into instead**, since several are inline rather than named
            modules: CORS → `utils/worker-response.ts:12`; rate limiting →
            `utils/minimal-rate-limit.ts`, called at `index-minimal.ts:342-364`; roles →
            `constants/roles.ts`; error shape → `utils/worker-response.ts`; health → `health.ts`;
            Sentry → `@sentry/cloudflare` `withSentry(...)` at `index-minimal.ts:274`.
            Security headers, environment validation, business-rule integrity and a global body cap
            have **no** live equivalent and are net-new (see the four §F gaps above).
            <br>**DONE 2026-08-28.** 16 files deleted (`index.ts`, `express-adapter.ts`, the nine
            middleware modules, `middleware/auth.ts`, `utils/auth.ts`, and four test files).
            Gates: workers suite 348 passed/4 skipped, deploy + test typechecks clean,
            `node build.js` succeeds, both audit gates green.
            <br>**Three things the scope did not anticipate.**
            (1) `utils/feature-gates.ts:9` — the module excluded from deletion pending **#471** —
            imported `TIER_LIMITS`/`TierLevel`/`AVAILABLE_FEATURES` from `./auth`, a pure re-export
            barrel over `shared/types/subscription`. Repointed it and its test at the shared source;
            that is what made `utils/auth.ts` deletable at all.
            (2) `middleware/require-role.test.ts` was the **only** coverage of `constants/roles.ts`,
            which is live: `index-minimal.ts:84` imports `normalizeRole`/`ROLES` and gates on it at
            `:1612`, `:1720`, `:1826`. Added `workers/src/constants/roles.test.ts` and three tests in
            `minimal-api-routes.test.ts` for the two previously-untested gates
            (`handleClearSupplierPolicy`, `handleBulkAttachPolicy`); mutation-verified by disabling
            both gates and confirming exactly those tests fail.
            (3) 246 rows across the 2.2 manifests cited the four deleted test files, and
            `verify-audit-manifest.js` check 2 requires cited Worker paths to exist. 215 were
            search-list mentions restated against live code with no decision changed; 16 were
            repointed to live coverage; **25 were REOPENED** and need an owner decision (a further 4
            were corrected to `retire`, and 2 to a non-upload framing — see the finding below) — see the
            re-pointing note in each manifest header.
            <br>**Finding — a permission model wired to nothing, on both sides.** The Worker applies
            no role check to any upload path (`canUpload`/`UPLOAD_ALLOWED_ROLES` have no production
            importer; no `role` appears in `index-minimal.ts:3400-3900`). **Express does not gate
            uploads by role either**: `backend/src/routes/upload.routes.ts` uses `authenticateToken`
            + `checkUsageLimit('storage_bytes')` + rate limiters and no role middleware, and
            `requirePermission` (`backend/src/middleware/requireOrgRole.ts:75`) and `requireMinRole`
            (`:110`) occur nowhere outside their own JSDoc examples at `:73` and `:107`. So this is
            **parity, not a regression** — no issue to file. `PERMISSIONS.UPLOAD_FILES` /
            `requirePermission` / `requireMinRole` on the Express side and `canUpload` /
            `UPLOAD_ALLOWED_ROLES` / `createUploadRoleMiddleware` on the Worker side are a permission
            model that was built, tested on both sides, and applied to no route. The four 2.2 rows
            covering it are `retire`; upload authorization, if wanted, is net-new product work on a
            fresh decision.
            <br>*(An earlier pass of this task recorded the above as a live authorization gap. That
            read the Worker's absent check as a regression without verifying the Express side, and
            was wrong — the same "does anything call this?" check the audit itself prescribes,
            applied to only one of the two backends. The audit rows and manifest headers carry the
            correction.)*
            <br>**What is still a real gap:** `requireOrgRole(admin, manager)` **is** live Express
            middleware on `admin.metrics`, `database.backup`, `health`, `organization-invite`,
            `store-area` and `user` routes, and the Worker has only three admin-only gates and no
            admin+manager gate anywhere. Two reopened 2.2 rows track it; it resolves as those routes
            gain Worker handlers in 3.1.
            <br>Related, smaller: the live rate limiter's reject path is untested —
            `minimal-rate-limit.test.ts` asserts `checkRateLimit` only for `allowed: true`, and
            `applyRateLimitHeaders` is exercised against a pre-built 429.
            <br>**Two follow-ups left out of scope, for 4.1.** `workers/src/utils/getRequestMetrics.ts`
            now has zero importers (`index.ts` took `getRequestMetrics` from
            `metrics.middleware.ts`, not from it) — another orphan of the same shape, not in the
            enumerated scope so not deleted here. And five docs still point at the deleted modules,
            two of them describing security controls that never executed:
            `docs/security-audit.md` (4 refs), `docs/security.md:695`,
            `docs/production-deployment-checklist.md:61`, `backend/docs/observability.md` (3 refs),
            `docs/cost-optimization.md:249`. That is 2.5 §I territory.
      **Three defects against shipped Worker code, found during 2.2 part 4 and deliberately deferred
      here rather than fixed mid-audit.** None is a tenant-isolation defect — no organization can
      reach another's data through any of them — which is why they are 3.1 work items and not
      immediate fixes in the shape of #462/#466. Each is evidenced in
      `audit/2.2-test-manifest-part4.md`; do not re-derive.
      - [x] 3.1.a **Usage limits are not enforced on any interactive path** (Finding 4). **Tracked as #471** —
            the defect exists in production now and is not gated on this change; that issue is the
            authoritative record and survives this change being archived.
            `workers/src/utils/feature-gates.ts` has no production importer — its five exports are
            referenced only by test files — and its SQL targets `"Product"`/`"User"`/
            `"InventoryItem"`/`"Upload"` while the schema uses `products`/`users`/`inventory_items`/
            `uploads`, so every branch throws `relation "Product" does not exist` and fails closed
            (verified against pglite). `handleCreateProduct` (`index-minimal.ts:2266`) performs no
            limit check. The one inline gate, `POST /api/users` (`index-minimal.ts:2673`), reads
            `organization_usage.active_users`, which is written exactly once as a literal `0` by the
            lazy upsert at `index-minimal.ts:3084` — no `UPDATE`, no trigger — so `0 >= 1` is false
            and the gate never fires. Decide the module's fate (wire up vs delete), maintain the
            counters, and make check-and-increment **atomic**: Neon has no `$transaction`
            equivalent, so this needs a conditional `UPDATE ... WHERE active_users < max_users`, a
            constraint, or an equivalent single-statement claim — not the read-then-insert shape
            currently at `:2673`. Also carry the **soft warning at 80%**, which Express emits via
            `res.locals.usageWarning` and the Worker's response envelope has no slot for. Source
            rows: `multi-tenant-usage-limits.test.ts:142/169/432/554`.
            <br>**DONE 2026-08-28.** `utils/feature-gates.ts` deleted and replaced by
            `utils/usage-limits.ts`; caps enforced on `POST /api/products`, `POST /api/inventory-items`
            and the three upload write paths; `GET /api/organization/usage` repointed at live counts.
            Gates: workers suite 320 passed/4 skipped, `test:db` 126 passed, both typechecks clean,
            `node build.js` succeeds, both audit gates green with section/row counts unchanged.
            <br>**Decision: replaced, not repaired.** Every branch of the module's `checkUsageLimit`
            queried `"Product"`/`"User"`/`"InventoryItem"`/`"Upload"`, so repairing it meant rewriting
            it — and the counter-column design it implemented is the defect, not the fix.
            **Caps are enforced by counting rows inside the INSERT**, e.g.
            `INSERT INTO products ... SELECT ... WHERE (SELECT COUNT(*) ...) < ${maxSkus} RETURNING ...`;
            zero rows back means the cap was reached. That answers the atomicity requirement without a
            transaction — check and write are one statement, so two creates racing for the last slot
            cannot both win — and it matches the shape `createQueuedCatalogueUpload`
            (`index-minimal.ts:4065`) already used. Every limit that works anywhere in this repo counts
            live (`countActiveExpiryItems`, the invite path's seat check); every limit that is broken
            reads a counter.
            <br>**Two scope corrections, both from checking BOTH backends before calling something a
            regression.**
            (1) **`max_users` is parity, not a regression — deliberately not fixed.** Express's
            `checkUsageLimit('max_users')` (`user.routes.ts:37`) reads `organization_usage.active_users`,
            and that column is **never incremented anywhere in the repo** — every write sets it to a
            literal `0` (`storage-quota.repository.ts:61`, `subscription.repository.ts:242`,
            `webhook.service.ts:309/963/1148`) or `1` (`subscription-trial.helpers.ts:51`). So Express
            compares `0 >= max` and never fires, exactly like the Worker gate at `:2673`. The only seat
            limit that works is `ensureWithinUserLimit` (`organization-invite.service.ts:300`) — and it
            works because it counts live. Enforcing it in the Worker would be **net-new** behaviour that
            starts refusing orgs nothing has ever refused, so it is left as a pre-existing defect on both
            backends for the owner to decide. The usage endpoint now reports the true seat count.
            (2) **The 80% soft warning is not a shipped behaviour — nothing to carry.**
            `res.locals.usageWarning` (`feature-gate.middleware.ts:375`) is assigned and read by nothing
            outside tests; no serializer puts `res.locals` in a body. The test that appears to cover it
            (`multi-tenant-usage-limits.test.ts:432`) builds a throwaway `express()` app whose own handler
            reads `res.locals`, so it tests the middleware, not the product. The real warning is already
            client-side: `frontend/src/components/UsageWarning.tsx` derives its own 80% threshold from the
            `{current, limit}` pairs `/api/organization/usage` returns. The Worker envelope needs no slot.
            <br>**Unplanned but in scope: the usage endpoint reported 0 for everything.**
            `GET /api/organization/usage` read the same unmaintained columns, so every organization saw
            0 of its limit — empty dashboard bars, and the client-side 80% warning could never fire. It
            now reports live counts and tier limits. The route test seeds a deliberately contradictory
            `organization_usage` row so it fails if those columns are ever read again.
            <br>**Storage: gate shipped, recording gap flagged.** `enforceStorageLimit` is applied at the
            same three points Express registers `checkUsageLimit('storage_bytes')` (initiate, direct,
            complete). It sums `uploads.file_size_bytes` live, and **undercounts**: only queued catalogue
            imports persist an `uploads` row, because `handleUploadStatus` relies on synchronous uploads
            having none in order to fall through to R2 metadata. Closing that means recording those
            uploads AND teaching the status endpoint to tell a quota row from a job row — deliberately
            not smuggled into this task. The gate therefore **fails open**, never closed, including on a
            failed quota read; without that catch a transient error became an unhandled throw, since the
            upload handlers have no catch of their own.
            <br>**Storage limits disagree across three constants, and the divergence is now asserted.**
            `STORAGE_LIMIT_BYTES_BY_TIER` and backend `SUBSCRIPTION_TIERS` say 1/10/1000 GiB;
            `TIER_LIMITS.storage_bytes` says 100GB for professional and enterprise — and Express enforces
            against the latter while reporting against the former. The Worker enforces the 1/10/1000 line
            so the limit a caller is refused against is the limit their dashboard shows. Not silently
            reconciled: `utils/usage-limits.test.ts` asserts the divergence, so anyone unifying the
            constants fails a test rather than quietly changing an entitlement. **Owner decision.**
            <br>**Verification.** Five mutations of the SQL each fail exactly the intended tests and no
            others (cap ignored, tenant scoping dropped, inventory cap ignored, terminal-status filter
            removed, deleted-upload filter removed), plus a sixth removing all three route gates. One
            assertion was found to be a placebo and corrected: pglite returns `bigint` as a JS number
            while the Neon driver returns a string, so the `Number()` cast in `getStorageUsedBytes` is
            load-bearing in production but unfalsifiable from a pglite test — the test now says so
            instead of implying cover.
            <br>**Audit impact.** 94 rows across the 2.2 manifests cited the deleted test. 67 were
            search-list mentions restated against live files; **16 rows are now SATISFIED or RE-POINTED**
            by the coverage this task added (the active-expiry status exclusion, the usage endpoint
            response, the three-point storage guard, the tier-limit tables, the at-cap/under-cap product
            creates, and the four-tier storage mapping that :1012 explicitly asked to see recorded in a
            test); **2 are REOPENED** — part3:509 and :1167, tier-FEATURE-flag gating, which lost its
            only equivalent with `checkFeatureAccess` and has no Worker representation at all. Those two
            turn on the same product decision as part4:454-455 and need an owner.
            <br>**Follow-up found, not actioned: `workers/src/handlers/` is a second dead layer.**
            `dashboard.ts`, `inventory.ts`, `products.ts`, `store-areas.ts` and `handlers.test.ts` have
            **zero importers**. `handlers/inventory.ts:105` inserts `quantity` and `store_area_id`,
            columns the schema does not have, and omits `organization_id` — it would throw if it ever
            ran. It is where inventory enforcement would naturally have been added. Before deleting,
            apply the 3.1.0 lesson: check whether `handlers.test.ts` is the only coverage of anything
            live. Needs its own task alongside the 4.1 sweep.
      - [x] 3.1.0e **Gate usage enforcement behind `USAGE_LIMITS_ENFORCE`, defaulting OFF.**
            **DONE 2026-08-29.** 3.1.a shipped enforcement with no off switch, and the numbers it
            enforces (`LAUNCH_TIER_LIMITS`) are estimates pending a usage trial. Enforcing an estimate
            during the trial measuring it would cap usage at the guess and confirm the assumption
            instead of testing it. Second reason: an org whose Clerk webhook was dropped has no
            `subscription_tiers` row, so `getOrganizationLaunchTier` falls back to `free` and inherits
            the smallest caps in the table -- with the flag on, a webhook failure becomes a hard write
            refusal for a paying customer.
            <br>**Off is measure-only, not unmeasured.** All three gates still resolve the tier and
            still apply the cap inside the INSERT; the refusal is detected, logged as one line of JSON
            (`usage_limit_reached`, with an `enforced` field so the event name does not lie in either
            state), and then the products/inventory writes are re-run with `UNLIMITED_CAP`. The retry
            reuses the same parameterised statement rather than adding an uncapped code path, so one
            statement stays under test in both flag states and there is no unguarded INSERT in the file
            for a later change to reach for. Cost is one extra round trip, paid only by over-cap orgs
            with the flag off. No observed-count field: with enforcement off usage is unbounded, so
            "where does usage land per tier" is answered by reading `getUsageCounts` at the end of the
            trial, not by an extra COUNT on every over-cap write. Storage is the exception -- it already
            holds the used-byte total, so it logs `observedBytes` for free.
            <br>**Divergence from Express, deliberate and reversible.** With the flag off the Worker
            allows over-cap inventory and storage writes that Express refuses
            (`feature-gate.middleware.ts:274` counts active expiry items live, and `storageUsedBytes`
            is genuinely maintained by `storage-quota.repository.ts:53/59/90`). SKUs are unaffected:
            `checkUsageLimit`'s default branch returns a hardcoded `currentUsage: 0` against
            `MAX_SAFE_INTEGER` (`feature-gate.middleware.ts:289`), so Express never refused a SKU
            create at all -- measure-only is closer to Express there, not further. Flipping the flag to
            "true" restores full parity in one config change; **that is the decision to revisit after
            the trial**, together with whether the trial needs per-account limit overrides.
            <br>Strict `=== 'true'` matching `CATALOGUE_QUEUE_ENABLED`, so "1"/"yes"/"TRUE" leave it
            disarmed rather than half-armed -- a guard on customer writes should fail towards the state
            that cannot reject a customer. Declared explicitly as "false" in all three `wrangler.toml`
            env blocks rather than left absent, so the deployed config states the intent.
            <br>**Gates:** workers 345 passed / 2 skipped (+18), `test:db` 128 passed / 1 skipped (+1),
            both typechecks clean, build succeeds. Mutation-verified in both directions: forcing the
            resolver false fails exactly the 5 on-state tests, forcing it true fails exactly the 15
            off-state tests. The `UNLIMITED_CAP` retry is asserted against real SQL in pglite, not just
            as a JS constant -- `Number.MAX_SAFE_INTEGER` exceeds int4, so a cap parameter inferred as
            `integer` would error rather than admit the row, and only real SQL can show it does not.
      - [x] 3.1.0f **Correct the atomicity claim, and the review findings on #486.**
            **DONE 2026-08-29.** PR review found the 3.1.a enforcement docs overstated their
            guarantee, and the correction matters because it is the contract an operator relies on
            when flipping `USAGE_LIMITS_ENFORCE` on after the trial.
            <br>**The cap is soft, not exact.** `INSERT ... SELECT ... WHERE (SELECT COUNT(*)) < cap`
            does NOT make check-and-write inseparable. Each statement is its own implicit transaction
            under READ COMMITTED and snapshots at statement start, so two creates racing at limit-1
            can both observe room and both insert. The overshoot is bounded by in-flight request
            count and the window shrinks from a full round trip to the snapshot-to-commit interval --
            a narrowed race, not a closed one. An exact cap needs SERIALIZABLE, a per-org advisory
            lock, or a counter row claimed with `UPDATE ... SET used = used + 1 WHERE used < cap`
            (atomic because an UPDATE re-checks its predicate after taking the row lock). None are
            expressible in one statement over the Neon HTTP driver; the counter is also what the dead
            `organization_usage` columns were, and a counter unmaintained on any path fails open
            silently. Counting is wrong by a bounded amount under load; that is the trade recorded.
            <br>**A test I wrote asserted the property it could not test.** "admits exactly one of two
            concurrent creates racing for the last slot" passed because pglite is a single in-process
            connection that SERIALIZES the two statements -- the interleaving never occurred. It is
            the exact failure mode 3.1.0d is sweeping (a green test standing in for coverage that does
            not exist), authored while doing the sweep. Both product and inventory versions are
            renamed to "refuses the second of two back-to-back creates for the last slot" and state
            what the harness can and cannot show. **Lesson: a concurrency assertion needs two real
            connections; `Promise.all` over one connection tests the driver's queue, not the database.**
            <br>**Storage refusal leaked R2 objects.** At `complete` the bytes are already in R2, and a
            refused complete never reaches `createQueuedCatalogueUpload`'s `INSERT INTO uploads` -- so
            the object consumed quota `getStorageUsedBytes` could never see, and each retry added
            another. Now deleted on refusal (mutation-verified: removing the delete fails exactly one
            test). `enforceStorageLimit`'s doc claim that callers are "refused before bytes move" was
            true for initiate and direct and false for complete; corrected.
            <br>**Terminal-status list de-duplicated.** It was hardcoded in both `getUsageCounts` and
            `createInventoryItem`'s cap check; if the two drifted the dashboard would report a
            different active-expiry number than the cap enforced, silently. Now one
            `TERMINAL_INVENTORY_STATUSES` constant feeding both via `status <> ALL(${...})`, verified
            against real SQL.
            <br>**Left as owner decisions, not silently actioned:** (a) the `GET /api/organization/usage`
            handler still seeds `organization_usage` with hardcoded free-tier literals for every org
            though nothing on that path reads it -- annotated in place, because its one remaining
            reader is the seat gate in `handleCreateLegacyUser` and removing seed and gate together is
            3.1.j(a)'s job on an auth-adjacent path; (b) `utils/db-retry.ts` (3.1.0c) -- the reviewer
            argued for delete-now-restore-from-history over carrying dead code behind a comment, and
            `createRetryableSql` does exist so wiring is genuinely small. Note before adopting it: a
            retry after a timeout that the server actually committed would DOUBLE-INSERT, and these
            INSERTs are the non-idempotent quota-consuming ones, so "retry everything" is not safe as
            a one-liner. 3.1.0c stands, with delete as the default if it does not land soon.
      - [x] 3.1.0b **Delete the second dead Worker layer: `workers/src/handlers/`.** Found while
            scoping 3.1.a, which would otherwise have added inventory enforcement to
            `handlers/inventory.ts`. **DONE 2026-08-28**, 5 files deleted (`dashboard.ts`,
            `inventory.ts`, `products.ts`, `store-areas.ts`, `handlers.test.ts`, 1015 lines).
            Same shape as 3.1.0: **zero importers**, and `handlers/inventory.ts:105` inserted
            `quantity` and `store_area_id` — columns the schema does not have — while omitting
            `organization_id`, so it would have thrown if it ever ran. `handlers/products.ts` and
            `handlers/store-areas.ts` were live decoys for 3.1.d and the store-area rows.
            <br>**The orphan check paid off twice.** The importer grep that found the layer excluded
            `*.test.ts` by design (it was looking for PRODUCTION importers), which hid a test importer
            outside the directory: `__tests__/error-handling.test.ts` imported `handlers/products` and
            `handlers/dashboard`. Run BOTH greps next time. That file was 19/28 tautological (it is in
            the Finding 1 table), 3 more called a deleted handler inside a try/catch asserting in both
            branches, and 2 were `skipIf(!NEON_CONNECTION_STRING)` and never ran in CI. Trimmed to the
            4 real tests, which cover `withNeonRetry`. 44 tests removed in total, 39 of them incapable
            of failing.
            <br>**Audit impact:** 62 rows cited `handlers/handlers.test.ts`, every one inside a
            `(searched: ...)` list and none as an equivalence — unsurprising for a file whose 20
            assertions were all `expect(expected).toBe(true)`. Re-pointed at the pglite tenant-isolation
            suites, which actually cover those behaviours. One row (part3:1187) DID rest on
            `error-handling.test.ts` for missing-required-field rejection and is **REOPENED**: it cited
            a test of the deleted `createProduct`, so the equivalence never held. Finding 1's placebo
            table in part4 is now a scoreboard with a **Now** column; 2 of its 8 rows are closed.
      - [x] 3.1.0c **Decide the fate of `utils/db-retry.ts`: DELETED, with the gap filed as #487.**
            **DONE 2026-08-30.** Deleted `utils/db-retry.ts` and `__tests__/error-handling.test.ts`
            (its only importer; they referenced nothing but each other). 4 tests removed, all real.
            <br>**The deciding evidence overturned this row's own premise.** The row said
            `backend/src/utils/retry.ts` "is used by the webhook and bootstrap paths" -- that was an
            unverified claim and it is **false**. `retryWithBackoff`, `withDatabaseRetry` and
            `withApiRetry` have **zero references anywhere in the repo, including tests**. So neither
            backend has ever retried a query, and wiring the Worker module would have been a NEW
            capability, not restored parity. That reframes it out of the migration: a cutover is the
            wrong moment to change failure timing in the surviving backend. Two dead retry modules,
            one per backend, is also its own finding about how this codebase accumulated
            infrastructure nobody connected -- the same shape as `feature-gates.ts` and both dead
            handler layers.
            <br>**The gap is real and now owned: #487.** The deployed Worker still has no
            transient-failure handling against Neon over an HTTP driver. The issue carries the
            recovery command (`git show dfd7ac8f:workers/src/utils/db-retry.ts`), the **read-only**
            design (`/^\s*SELECT/` gates the retry; `WITH ... INSERT` CTEs correctly fall through to
            no-retry), and the hazard that ruled out the reviewer's one-line
            `createRetryableSql(neon(...))`: `withNeonRetry` treats `/timeout/i` as transient, so a
            statement that timed out AFTER the server committed would be applied twice --
            `createInventoryItem` has no unique constraint to catch it and would duplicate both the
            item and its audit row. It also records that no production failure rate has been measured,
            so the first step is data, not code.
            <br>**Audit sweep: 218 mentions, and none was positive evidence** -- unsurprising for a
            retry test. 138 dropped from multi-path `(searched: ...)` lists; 14 rows where it was the
            SOLE searched path were repointed at the file that would actually hold the behaviour
            (2 CORS rows -> `utils/worker-response.test.ts`, 12 error-mapping rows ->
            `minimal-api-routes.test.ts`), each **searched first** so the new citation is a fact
            rather than a guess -- dropping the path instead would have left `none found (searched: )`,
            the unqualified negative check 3 rejects. Row counts unchanged (697/385/512/396).
            <br>**Two self-inflicted sweep bugs, caught by re-reading rather than by the gate.** The
            first pass left the CORS rows saying `worker-response.test.ts` was "a stub, since deleted"
            -- that described the OLD file, and the new one is live and real. The prose rewrite also
            silently skipped 12 rows because its guard tested for a path the searched-list rewrite had
            already removed, leaving cells that named one file and described another. **Both gates
            passed in that state.** The verifier checks that citations resolve, not that prose agrees
            with them; a bulk restatement needs rows re-read afterwards, not just re-gated.
      - [x] 3.1.0d **Sweep the remaining placebo tests.** **DONE 2026-08-30.** All 8 rows of
            Finding 1's table in part4 are now closed.
            <br>**The placebo count was a floor, not a total.** The audit counted 44 tautological
            assertions across the 5 remaining files. The real number is 72 -- every test in them --
            because **none of the five imported a single production module.** They asserted against a
            local `__tests__/fixtures.ts`, so the "real" assertions were equally unfalsifiable, just
            better disguised: `expect(gracePeriodDays).toBe(7)` where the 7 was a constant three lines
            above. Deleting `authenticateClerkRequest` outright would not have failed one of them.
            **Method note: the tell was `grep -c "from '\.\./"` returning 0, not reading the
            assertions.** A file that imports nothing from production cannot test production, whatever
            its assertions look like -- that check is cheaper and more reliable than the placebo
            detector and should run first next time.
            <br>**Two findings fell out of it.** (a) `usage-limits-integration.test.ts` encoded a
            `tierLimits` fixture claiming starter = 500 SKUs and professional = 2,000; the real table
            is 5,000 and 50,000. It passed, so the wrong numbers read as verified. (b) **Three of the
            files describe gates that were never built.** `requireActiveOrganization()`,
            `requireActiveSubscription()` and `requireFeatureAccess()` have zero references anywhere
            in the repo -- Worker or Express -- and the live Worker performs no organization-status
            and no subscription-STATUS check on any path. **A canceled subscription and a suspended
            organization block nothing today.** These were not untested gates but green descriptions
            of unbuilt ones, which is exactly why the absence stayed invisible; it is the #462
            mechanism with the gate missing entirely rather than merely wrong.
            <br>**Disposition: 4 pointer files + 1 real replacement.** Following the
            `multi-tenant-isolation.test.ts` precedent, the five files become skipped pointer files
            whose headers record what was there, why it proved nothing, and where the real coverage
            lives -- or that there is none. They are NOT deleted, because 625 audit rows cite their
            paths as searched-and-empty evidence; keeping the paths meant **zero citation churn**
            against 625 rows, and the sweep I ran at 218 rows in 3.1.0c introduced two bugs of its
            own, so avoiding the bigger one was the point. `__tests__/fixtures.ts` is deleted with its
            last importer.
            <br>**New real coverage: `clerk/request-authentication.test.ts`** (10 tests) against the
            live `authenticateClerkRequest`, with only Clerk's `verifyToken` mocked. Covers the five
            malformed-header shapes (asserting `verifyToken` is NOT called, so a loose parser that
            still answered 401 would fail), verification failure, the missing-subject guard,
            secret-unset answering 500 rather than 401, email lower-casing, and the
            organization-comes-from-the-token property the deleted file asserted against a constant.
            Mutation-verified: loosening the header gate to presence-only fails exactly 3, removing
            the missing-subject guard fails exactly 1.
            <br>**Gates:** workers 281 passed / 6 skipped (was 342 / 2 -- 72 fictional tests out, 10
            real in), `test:db` unchanged, both typechecks clean, build succeeds, both audit gates
            green with row counts unchanged, `openspec validate --strict` passes.
            <br>**Follow-up for an owner, NOT actioned here:** whether suspended organizations and
            canceled subscriptions should block writes. That is unbuilt product work, not a test gap,
            and it interacts with the tier-feature-gating decision already open on part3:509,
            part3:1167 and part4:454-455.
      - [x] 3.1.b **Clerk webhook idempotency is check-then-act and has no test** (Finding 5). **Tracked as
            #472** — shipped Worker code, not gated on this change; see also task 3.8, whose Stripe
            handler must be written against the fixed pattern rather than the current one.
            `handleClerkWebhook` runs `isNewClerkWebhookEvent` → `processClerkWebhookEvent` →
            `markClerkWebhookEventProcessed` as three statements with no transaction, so two
            concurrent Svix deliveries of one event both observe `isNew` and both perform the side
            effects; the `ON CONFLICT (id) DO NOTHING` deduplicates the marker row, not the work.
            Not benign: `ensureTrialSubscription` (`clerk/clerk-persistence.ts:97-102`) is itself
            check-then-insert with no `ON CONFLICT`, so a doubled `organization.created` can write
            two `trialing` rows for one organization. Svix delivers at-least-once and retries on
            timeout/5xx, so concurrent redelivery is the expected case. A repo-wide search for
            `isNewClerkWebhookEvent`, `markClerkWebhookEventProcessed` and `clerk_webhook_events`
            across `workers/src/**/*.test.ts` returns nothing. Fix the existing Clerk path **and**
            treat it as a constraint on the net-new Stripe handler: exactly-once must hold for the
            processing, not just the marker.
            <br>**DONE 2026-08-30.** The claim now happens *before* the work, in one statement:
            `claimClerkWebhookEvent` (`clerk/clerk-persistence.ts`) is an `INSERT ... ON CONFLICT (id)
            DO UPDATE ... RETURNING id`, and no rows back means another delivery owns the event. This
            is a stronger guarantee than the single-statement pattern 3.1.a used for usage limits, and
            for a different reason: `INSERT ... SELECT ... WHERE NOT EXISTS` is soft because both
            statements snapshot at statement start, whereas two inserts of one id serialize on the
            unique index and the `DO UPDATE` branch re-reads the committed row. Migration **0012**
            supplies what the mechanism rests on: `clerk_webhook_events.completed_at` (a claim is a row
            with `completed_at IS NULL`) and a unique
            constraint on `subscription_tiers.organization_id`, which is what actually makes
            `ensureTrialSubscription` idempotent — it now inserts with a target-less `ON CONFLICT DO
            NOTHING`, correct on both sides of the migration. The migration refuses rather than
            de-duplicates if the table already violates the constraint; duplicates are a repair
            decision, not a silent one.
            <br>Crash semantics were chosen explicitly rather than inherited: claim-first converts
            "processed twice" into "claimed but never processed", so a failure inside the handler
            *releases* the claim (Svix's retry re-drives it immediately) and an isolate that dies
            without running any handler is covered by a 120-second staleness window after which the
            next redelivery takes the claim over.
            <br>**That window is only reachable if the duplicate delivery stays retryable**, which
            review caught: the first version answered 200 to both "already completed" and "a sibling
            is working on it". A 200 acknowledges the message and ends Svix's retry chain, so a
            claimant that died without releasing would have had its own retry acked away and the claim
            stranded until a manual replay — the staleness path could never fire. `claimClerkWebhookEvent`
            therefore returns a tri-state (`claimed | in_flight | completed`); only `completed` is
            acknowledged, and `in_flight` returns **503** so the delivery survives to take the claim
            over later. Separating the two costs one extra read, and it must be a second statement: a
            subquery in the claim would read the snapshot from statement start and could miss a row
            committed while the claim was blocked on the index. The window was also retuned 300s → 120s
            so it clears Svix's five-minute second retry outright instead of landing on top of it.
            <br>The deploy gap is closed by the column *default* rather than a backfill. `completed_at`
            is `DEFAULT CURRENT_TIMESTAMP`, so rows the **old** Worker writes during the gap — it
            inserts its marker after processing and never names the column — are born completed, and a
            late redelivery cannot re-run work that already happened. The same default gives every
            pre-existing row a value at DDL time (a non-volatile default is stored as the attribute's
            missing value), which removed the full-table `UPDATE` the first version used: no rewrite,
            no WAL spike, no dead tuples. The cost is a footgun recorded in the migration header and in
            the code: any future writer of this table must name `completed_at`, or its row is born
            completed and its event is never processed.
            <br>Covered by `workers/src/clerk/webhook-handler.node.test.ts` — 9 real-SQL tests against
            pglite, **mutation-verified**: claim-always-true, no-`ON CONFLICT`, no staleness predicate,
            a day-long staleness window, never completing, a no-op release, in-flight-reported-as-
            completed, and a defaultless `completed_at` column each fail exactly the intended tests and
            no others. There is deliberately no `Promise.all` "concurrent
            deliveries" test: pglite is one connection and serializes, so that test would be green
            regardless of the code (the 3.1.0 lesson). The harness gained the constraint and the table,
            and one test asserts the constraint really rejects a second row, so a green idempotency
            result cannot mean "nothing tried to insert".
            <br>**Two review points declined, with evidence.** (a) A `SET LOCAL lock_timeout` in the
            migration would be narrower than what already applies: `configureSession`
            (`src/database/migrations/runner.ts:396-400`) sets `lock_timeout = '10s'` and
            `statement_timeout = '5min'` on the session before any migration runs, so the
            `ADD CONSTRAINT`'s ACCESS EXCLUSIVE lock already fails fast rather than queuing. (b) The
            SQLite dev schema does **not** get the matching `@@unique`, against the general rule in
            `docs/database-migrations.md:296`: 0012 never runs against SQLite, that schema's datasource
            is `sqlite` so no `db push` from it can reach Postgres, and Express's own
            `createSubscription` violates the invariant — encoding it there would break the rollback
            backend's paid-conversion path in dev for no production benefit. Both are recorded in the
            migration header.
            <br>Audit rows part4:562-563 still describe the old `isNewClerkWebhookEvent` /
            `markClerkWebhookEventProcessed` shape; they are the Phase 2 record of what was found, and
            this note is their resolution. Task 3.8's Stripe handler should copy `claimClerkWebhookEvent`.
            <br>**Constraint the constraint creates, for 3.8:** one `subscription_tiers` row per
            organization is what every reader in both backends already assumes (`LIMIT 1`), but it is
            *not* what Express's `createSubscription`
            (`services/subscription-billing-lifecycle.service.ts:69`) does — it inserts a fresh row per
            Stripe subscription with no check for an existing one. That path would now raise a unique
            violation against Postgres. Harmless today (Express is SQLite-only and 0012 does not touch
            the dev schema; Express against Postgres has never been a running configuration), but the
            Worker's Stripe handler must **update the organization's row**, not insert a second one.
      - [x] 3.1.c **Restore the CSV formula-injection control lost at cutover.** **Tracked as #473** — the
            control is already gone from the production Workers path, so this is not gated on the
            retirement. Express sanitizes
            spreadsheet-formula payloads at ingestion for `sku`, `name` and `barcode`
            (`validateProductRowStrictly`); the Worker's `upload/catalogue-parser.ts:93-95` applies
            `.trim()` to the same three fields and stores them raw, and no formula-escaping construct
            exists anywhere in `workers/src`. Note `.trim()` strips the leading tab and CR, collapsing
            the two evasion variants into a bare formula the Worker stores unescaped. This is not a
            live Worker exploit today — the Worker has no CSV export route — but sanitizing at
            ingestion is the control, because the export that weaponizes the payload need not live in
            the same service. Apply to all three fields in one change: per-field asymmetry (sanitize
            `name`, forget `sku`) is the exact shape that produced #466. Source rows:
            `services/csv-injection.test.ts:43/137`.
            <br>**DONE (2026-08-31).** The rule now lives once, in
            `shared/domain/csv-injection.ts` (`escapeSpreadsheetFormula` + `CSV_INJECTION_PREFIXES`),
            and both backends call it: Express's `pureSanitizeValue` is a one-line delegate (its local
            copy of the prefix list is deleted), and the Worker escapes after `.trim()` at
            `upload/catalogue-parser.ts` (sku, name, barcode) and `upload/expiry-parser.ts`
            (sku, itemDescription, department).
            <br>**Scope widened by one path, deliberately.** The issue names only the catalogue
            parser, but Express escapes in `validateExpiryRowStrictly` too, and the Worker's expiry
            import auto-creates products and store areas from the file's own text — so the same
            control was lost on that path as well. Fixing one and not the other would reproduce the
            per-field asymmetry the issue exists to prevent. Cost and retail are deliberately *not*
            escaped: `parseCost` returns a number or the row is rejected, so neither can ever be
            stored as text; a test asserts that rather than leaving it as an assumption.
            <br>**Evidence.** `workers/src/upload/csv-injection.test.ts` (17 cases) ports the twelve
            Express cases — all six prefixes, DDE, hyperlink, multi-cell, escape-once, the four
            safe-value/precision cases — and adds the expiry path. Two real-SQL tests assert the
            *stored* row rather than the parser's return: in
            `__tests__/catalogue-import-upsert.node.test.ts` (products) and
            `__tests__/expiry-import.node.test.ts` (products + store_areas). Mutation-verified with
            five mutations — no-op escape, expiry left unescaped, catalogue sku left unescaped
            (the #466 asymmetry shape), escape-before-trim, `-` dropped from the prefix list — each
            failing exactly the intended tests and no others; the no-op mutation fails precisely the
            two persistence tests in the pglite files and nothing else in them.
            <br>The `worker-shaped-rewrite` rows at `audit/2.2-test-manifest-part4.md:624-635` are
            satisfied by this change; Phase 3.2 should treat them as landed rather than re-porting
            them. The manifest itself is unchanged (row counts and citations still verify).
      - [ ] 3.1.d **Six of the eight credit-claim endpoints the frontend calls have no Worker route**
            (Finding 6). **This work is already specified — do not re-plan it here.** The change
            `openspec/changes/add-workers-credit-claim-write-handlers` covers it in full, carried
            forward from `add-supplier-credit-claims` task 4.2, which deferred the write side because
            the Express router imports `multer` (no Workers bundle) and photo storage needs R2
            bindings. That change is written and unstarted. This task is the **link**: Phase 4 cannot
            delete Express until it lands.
            <br>What the audit adds, having rediscovered the gap independently from the test side:
            the Worker implements `GET /api/supplier-credits/claims` and
            `GET /api/supplier-credits/recovery-report` and nothing else under `claims`. Absent:
            `GET /claims/:id`, `POST /claims`, `POST /claims/:id/send`, `POST /claims/:id/follow-up`,
            `POST /claims/:id/outcome`, and `POST /claims/:id/lines/:lineId/photos` — all six called
            from `frontend/src/services/supplierCreditService.ts:144-183`. Verified three ways: no
            regex in `index-minimal.ts:186-190` matches a path under `/api/supplier-credits/claims/`;
            `INSERT INTO credit_claim` appears nowhere in `workers/src` production code (only in
            `database.credit-claim.conformance.node.test.ts` seed data), so no claim, line, photo or
            event is ever created; and unmatched `/api/` paths 404 at `index-minimal.ts:431`. The
            `credit_claim_photos` table is read at `database.ts:2075` and written nowhere.
            <br>**First establish which origin production's frontend resolves against**
            (`frontend/src/lib/api.service.ts:1-4` uses a single base URL for every call); that
            determines whether the write side is a live outage or a latent one, and the audit
            deliberately does not assert either. That question is not in the credit-claim change and
            belongs here.
            <br>Two test properties to carry into that change's task 4.2, recorded from the Express
            tests this manifest retires and not currently named there: the claim creator comes from
            the verified JWT and never the request body
            (`controllers/credit-claim.controller.test.ts:65`), and a photo upload with no file is
            rejected before the service is invoked (`:79`) — the same reject-before-work ordering
            `handleUploadDirect` already gets right at `index-minimal.ts:3600-3611`.
      - [ ] 3.1.e **Hoist the credit-claim status partition into `shared/`.** `index-minimal.ts:192-193`
            re-declares `OPEN_CREDIT_CLAIM_STATUSES` and `SETTLED_CREDIT_CLAIM_STATUSES` as local
            literals, duplicating `SETTLED_CLAIM_STATUSES` in `shared/domain/credit-claim.ts:25` — a
            module whose own header states it exists so "both backends must agree on the claim status
            vocabulary" (golden rule 5). The lists match today and nothing enforces that they keep
            matching. There is no `OPEN_*` export in shared at all; the nearest,
            `CHASEABLE_CLAIM_STATUSES` (`:33`), is a *different* partition (`SENT`, `ACKNOWLEDGED`
            only), so a future reader reaching for it would silently narrow the open view to two
            statuses. Same shape and same remedy as the store-walk-audit rollup (#350): export both
            partitions from shared and pin them with a conformance test. Small, and it unblocks the
            `?view=settled` and no-`view` rows in Part 4 being written against the shared export
            rather than a third copy of the strings.
      - [ ] 3.1.f **Reconcile the two test-bypass predicates before deleting Express** (Finding 7).
            `middleware/auth.middleware.ts:129` and `middleware/clerk-auth.middleware.ts:79` both gate
            on `NODE_ENV === 'test'` **and** `TEST_AUTH_BYPASS === 'true'`; `utils/auth-bypass.ts:11`
            uses **or**. That helper backs `getOrganizationId(organizationId?)` (`:18-28`), which
            returns the literal `'default-org'` instead of throwing when no organization id is
            supplied and the predicate holds — and eight services take their entire tenant scope from
            it (`product.service.ts:101`, `inventory.service.ts:83`, `csv-parser.service.ts:226`,
            `store-area.service.ts:29`, `credit-claim.service.ts:132`, `markdown-config.service.ts:62`,
            `supplier-credit.service.ts:174`, `service-provider.ts:46`), with
            `ServiceProvider.withClients(prisma)` (`:64`) reaching it undefined by design. Bounded:
            it needs `TEST_AUTH_BYPASS=true` under a non-`test` `NODE_ENV`, which is a deployment
            mistake rather than an attacker-reachable request, and Express is not the deployed system —
            so this is **not** an emergency. It is listed because it is a silent cross-tenant fallback
            where the two sibling guards fail closed, which is the shape that produced #462 and #466.
            Cheapest correct fix is to change the `||` to `&&` and let the missing-org case throw. No
            Worker counterpart exists or should be introduced: `index-minimal.ts:3352` is the sole
            assignment of `organizationId` and it reads the verified JWT with no fallback branch.
      - [ ] 3.1.g **The organization RBAC audit trail has no Postgres table and no Worker writer**
            (Finding 8). Express records authorization events through `OrgAuditService.emit`
            (`backend/src/services/org-audit.service.ts:20`) into
            `backend/src/repositories/org-audit.repository.ts:25`, writing the Prisma model
            `OrgAuditLog` (`backend/prisma/schema.prisma:354`), which maps to `org_audit_log` at
            `:376`. That table **does not exist in `database/migrations/`** — the baseline creates
            `audit_log` (`0000_baseline.up.sql:205`) for inventory events, with none of `event_type`,
            `actor_user_id`, `target_user_id`, `old_role`, `new_role`, `invite_id` or `ip_address` —
            and `org_audit_log` appears nowhere in `workers/` or `shared/`. This is a **schema gap
            before it is a code gap**: a Worker implementation has nowhere to write, so the migration
            has to land first.
            <br>Live scope is **one event type**, and the task should be sized on that rather than on
            the model's full vocabulary: `AUDIT_EVENT_TYPES.ROLE_ASSIGNED` from
            `org-bootstrap.service.ts:152` is reachable today. The four invite events
            (`organization-invite.service.ts:102/150/184/270`) are gated behind
            `ENABLE_CUSTOM_ORG_INVITES`, which `backend/src/index.ts:57-59` uses to require the router
            conditionally and which is off — that is why
            `contract/organization-invites-clerk-only.test.ts` asserts 404. So what Phase 4 deletes is
            the record of **who was granted admin and by what path**, which is also the entry with the
            clearest compliance argument. Decide explicitly whether to rebuild it, and whether the
            invite events come with it if custom invites are ever re-enabled.
            <br>Note the Express test does not prove the behaviour it names:
            `services/org-bootstrap.service.test.ts:70-91` wraps its only assertion in `if (auditLog)`
            with an `else` that merely `console.warn`s, because the write is swallowed by SQLite's
            interactive transaction lock. A replacement must be tested against real SQL (pglite,
            `npm run test:db`) or it will be equally unfalsifiable.
      - [ ] 3.1.h **Decide whether concurrent first-bootstrap may mint two admins.** **Tracked as #474.**
            Pre-existing in
            **both** implementations, so not a regression and not a Worker defect — recorded because
            Phase 3.2 will otherwise write a test that codifies it. The `isFirstAdmin` decision is
            check-then-act on both sides: the Worker selects an active admin
            (`clerk/bootstrap-handler.ts:302-309`) then assigns, and Express does the same before its
            transaction, whose `$transaction` (`org-bootstrap.service.ts:116`) wraps only the user
            *creation* at step 5, not the admin check preceding it. Two users bootstrapping one
            brand-new organization concurrently can both be assigned `admin`. The unique indexes that
            make the idempotency behaviour safe — `users_clerk_user_id_key`
            (`0000_baseline.up.sql:400`) and `organizations_clerk_organization_id_key` (`:313`) — do
            not constrain "at most one admin per organization". Bounded: an extra admin inside the
            caller's own organization, no cross-tenant reach. Either accept it explicitly, or close it
            with a partial unique index (`WHERE role = 'admin' AND deleted_at IS NULL`) or a
            conditional single-statement insert, since Neon has no `$transaction`.
      - [ ] 3.1.i **The Worker has no scheduled-job capability at all** (Finding 9). Verified rather
            than assumed: `workers/src/index-minimal.ts:274` exports
            `Sentry.withSentry(…, { fetch, queue })` — a search for `async scheduled` or a
            `scheduled(` handler in that file returns **zero** matches, and the only non-`fetch` entry
            point is `queue` at `:467`. `workers/wrangler.toml` declares no `[triggers]` section and
            no `crons` key. So **every** job in the backend's `SchedulerService` currently has nowhere
            to run, not just the two that surfaced through the subscription audit
            (`downgradeExpiredTrials`, `findTrialsNeedingReminders`).
            <br>This is task **2.3**'s subject and it is recorded here because it arrived early,
            through `services/subscription.service.test.ts`, and because it changes how those rows
            read: they are blocked on a **runtime capability** the Worker does not have, which is a
            different class of blocker from a missing handler. Sequence accordingly — 3.3 cannot
            rehome a scheduled job until the Worker has a Cron Trigger and a `scheduled` export, and
            2.3's schedule matrix should be produced knowing the destination is currently empty.
            <br>One consequence worth stating plainly for the trial path: until `downgradeExpiredTrials`
            has a home, **expired trials never lose their entitlements**. That is the mirror image of
            #471 — one leaks capacity by never enforcing a limit, this one by never revoking a grant.
      - [ ] 3.1.j **Two subscription rows must be sequenced against #471, not merely queued behind it.**
            Both come out of `services/subscription.service.test.ts` and neither is safe to leave to
            whoever implements enforcement.
            <br>**(a) Trial organizations are seeded with free-tier limits, so #471 must not ship
            without fixing this.** Express seeds a new trial with **Professional** limits
            (`services/subscription.service.test.ts:321`, which drives
            `createTrialSubscription` for real and asserts the `organizationUsage.create` call —
            note that `integration/multi-tenant-trial-workflow.test.ts:304` looks like corroboration
            and is not: it creates the usage row itself and asserts its own write). The Worker's only `organization_usage` write is the
            lazy zero-seed at `index-minimal.ts:3084`, which writes `max_users` 1 and `max_skus` 500
            regardless of tier, and does it on a usage *read* rather than at trial creation. Those
            limits are invisible today only because the gate never fires (#471). Implementing usage
            enforcement first would immediately block every trialling organization at a single seat.
            <br>**(b) The Worker grants access on a subscription row with no Stripe subscription id**
            (`subscription.service.test.ts:797`). `validateOrganizationStatus`
            (`workers/src/utils/auth.ts:187-208`) denies only when the row is absent entirely or
            `status === CANCELED`; a row with a null `stripe_subscription_id` and any other status
            passes. Express treats a missing Stripe id as no entitlement. The Express rule **cannot be
            ported as-is**, because `ensureTrialSubscription`
            (`workers/src/clerk/clerk-persistence.ts:90-101`) legitimately creates rows with no Stripe
            id for every trial — so the fix has to distinguish a trial from a paid signup that failed
            partway, rather than requiring a Stripe id outright.
            <br>**(b) is DONE (2026-08-31)** — see 3.1.k below for the shipped gate and the policy
            behind it. The row's premise was stale: `validateOrganizationStatus` was deleted with the
            dead API layer in 3.1.0, so the Worker granted access on *every* subscription state, not
            merely on a row with a null Stripe id. The new rule never requires a Stripe id, which is
            what the row asked for: it judges entitlement on dates the trial path already writes, so
            `ensureTrialSubscription`'s Stripe-less rows are entitled for exactly as long as their
            `trial_end_date` allows. **(a) remains open** and still gates #471 enforcement.
      - [x] 3.1.k **Decide the cancellation grace period explicitly.** Express's `isAccessActive`
            consults Stripe and keeps a cancelled customer inside the period they have paid for
            (`subscription.service.test.ts:745`, `:771`). The Worker's `validateOrganizationStatus`
            (`workers/src/utils/auth.ts:199-203`) denies the moment `status` is `CANCELED`, with no
            period-end check, while its comment at `:206` records that `past_due` is deliberately
            allowed "for MVP phase". The Worker is therefore **stricter on cancellation and looser on
            non-payment** than Express — a customer who cancels mid-month loses access they have
            already paid for, and a customer who stops paying keeps it. Both may be intended; neither
            is written down. `current_period_end` has existed in the schema since migration 0011 and
            is read for display (`index-minimal.ts:3044`) but never for access, so the data needed to
            implement a grace period is already there.
            <br>**DECIDED AND IMPLEMENTED (2026-08-31), together with (b) above and #489.** The
            premise of both rows needs correcting first: they describe
            `workers/src/utils/auth.ts:187-208`, which **no longer exists** — `validateOrganizationStatus`
            went with the dead API layer in task 3.1.0. So the Worker was not "stricter on
            cancellation and looser on non-payment"; it enforced **nothing at all** on any request
            path, which is what #489 records.
            <br>**Policy, decided by the product owner (jatwell93):** parity with Express rather than
            new product surface — there is no `organizations.status` column anywhere in Postgres or
            either Prisma schema, so org suspension is a capability that does not exist and was not
            built here. A lapse **degrades the organization to free-tier limits and refuses creation**;
            reads and updates stay available in every lapsed state. Lapse is **derived from dates at
            request time** rather than read from the stored `status` enum, because no Worker writer
            maintains that enum (no cron — 3.1.i; no Stripe handler — 3.8). An organization with no
            subscription row stays on the free tier and is logged, rather than rejected as Express
            rejects it: a dropped `organization.created` webhook must not become a total lockout.
            <br>**One deliberate divergence from Express, chosen explicitly:** a cancellation past its
            paid-through window blocks creation only, where Express's `authenticateToken` rejects the
            request outright. One rule for every lapse reason, and a customer never loses access to
            data they already own over a billing state.
            <br>**Shipped:** `workers/src/subscription-status.ts` (`deriveSubscriptionAccess`, pure)
            plus the gate in `resolveAuthenticatedUser`, extracted from `authenticateApiRequest` so
            every authenticated route is covered at one choke point and none can be forgotten. The
            entitlement columns ride along on the existing user lookup as a join — safe only because
            migration 0012 made `subscription_tiers.organization_id` unique (3.1.b), or a second row
            would multiply the result. `getOrganizationLaunchTier` now returns the **effective** tier,
            so the degrade-to-free half reaches every quota (interactive creates, queued imports,
            storage) through one function.
            <br>**Grace periods, now written down:** cancellation keeps access while
            `cancel_at_period_end AND current_period_end > now` (the same pair Express asks Stripe
            for, read from the 0011 columns instead); non-payment keeps access for
            `DUNNING_GRACE_DAYS = 7` from `past_due_since`, matching the dunning job; a trial lapses
            at `trial_end_date`. An unrecognized status **fails open** and is logged, as Express does.
            <br>**Evidence:** 16 unit cases over the derivation matrix, and 13 real-SQL tests driving
            the actual joined query on pglite. Seven mutations, each failing exactly the intended
            tests: gate never fires (4), gate applied to every method (3), creation-lock trigger
            removed (1), **creation-lock SQL alias dropped (1)** — the one that justifies the pglite
            layer over hand-built rows — subscription join broken (3), tier no longer degrades (1),
            missing-row detection removed (1).
            <br>Two pre-existing tests were corrected rather than accommodated: `health.test.ts` and
            `minimal-api-routes.test.ts` asserted the usage-limit log was `warn.mock.calls[0]`, which
            pinned call ordering rather than the record. They now select the record by event name.
            <br>**Behind `SUBSCRIPTION_GATE_ENFORCE`, default OFF**, the same shape 3.1.0e gave
            usage limits: no organization on this backend has ever been refused for a billing state,
            so the first deploy *measures* what it would refuse. Every decision is logged as
            `subscription_gate_blocked` with `enforced` attached, in both flag states, and only the
            403 itself is withheld — so what the flag turns on is exactly what the measure-only
            period counted. The flag covers the stored creation lock as well as the derived lapse:
            neither has ever refused a Worker request, so measuring half the gate would be
            misleading. Verified by two further mutations (flag ignored in each direction), each
            failing only the cases that belong to that flag state.
            <br>**Note for 3.1.i:** status gating is no longer blocked on the Worker gaining a Cron
            Trigger. Deriving from dates is what removed that dependency; a cron would still be needed
            to send the reminder and downgrade *emails*, which this does not attempt.
      **One product decision, not a defect.** No Worker route is gated on tier — every use of tier in
      `index-minimal.ts` is a quota or display value, and all twelve `/api/reports/*` handlers are
      reachable by any authenticated caller regardless of subscription, which is what
      `requireFeature('advanced_analytics')` prevents in Express. Decide explicitly rather than
      inherit. If tier gating is adopted, note the vocabulary mismatch: the Express tests treat
      `premium` as first-class, while the Worker's `LaunchTier` folds it into `professional`.
- [ ] 3.2 Write the migrated test coverage **once, against the Worker's `Request`/`Response` model** on
      pglite/Neon (there is no Express-shaped Postgres intermediate to port from). Reproduce the named gates
      from 2.2 — tenant isolation, penetration, concurrency, feature limits, webhook security,
      scheduled-job idempotency, authorization precedence — and get it green before any deletion.
      **The `tenant-isolation` gate is satisfied in advance (PRs #462, #466).** Cross-tenant
      **read** scoping is covered by `workers/src/database.tenant-isolation.pglite.node.test.ts`
      (11 tests) and cross-tenant **write/delete** by
      `workers/src/database.tenant-isolation-writes.pglite.node.test.ts` (19 tests), both against
      real SQL on pglite. The corresponding Part 4 rows moved from `worker-shaped-rewrite` to
      `worker-equivalent-exists`. Treat these as the template for the remaining gates: real SQL,
      foreign rows seeded so they WOULD be returned if scoping regressed, names chosen to sort
      first under each `ORDER BY`, assertions on row identity rather than count, both halves
      asserted (the attacker's call had no effect AND the victim's row is untouched), and every
      test verified to fail with its predicate removed.
      **Method note, learned the hard way.** Both PRs found live vulnerabilities, and both were
      found by *working* a row that claimed a property was untested — not by reading the Worker and
      judging it equivalent. #466's leak (`updateInventoryItem` accepting another tenant's
      `productId`, then uncorrelated report JOINs resolving it) has no Express analogue at all, so
      no manifest row predicted it. Work the remaining gates by exercising the Worker against real
      SQL; a row that says "no Worker test exists" is the most likely place to find a defect.
- [ ] 3.3 Rehome the scheduled jobs per 2.3 (Cron Triggers / Queues) or execute their retirement; verify
      each fires on schedule. Add the Worker `scheduled()` dispatcher and Wrangler Cron Trigger
      declarations; test dispatch, overlap prevention, retry/idempotency, and alerting.
      **Sequencing correction from 2.3 (Finding 9-R).** Finding 9 recorded that the Worker has "no
      scheduled-job capability at all". Half of that is now refined: **Queues already exist and are
      configured in both environments** — `workers/wrangler.toml:49`/`:115` (producers) and
      `:53`/`:119` (consumers), carrying `max_retries = 5`, `retry_delay = 30`, `max_concurrency = 1`
      and a `dead_letter_queue`. Only Cron Triggers are absent (no `[triggers]`, no `crons`, and zero
      `scheduled` matches in `workers/src/index-minimal.ts`).
      <br>So this task splits, and the halves are not equally blocked. The three per-recipient email
      sends — matrix rows 5, 7 and 14 — target **existing** infrastructure and can move ahead of any
      `scheduled()` work, gaining a retry and DLQ policy that no current job has. The eleven Cron
      Trigger rows stay blocked on the dispatcher.
      <br>Two defects should be resolved during the move rather than carried across: the dunning job
      runs at `0 2 * * *` on top of the markdown recalculation while two of its four comments claim
      01:00 (2.3 Finding 13), and **no** `cron.schedule` call passes a `timezone`, so every schedule
      currently runs in server local time while every comment claims UTC (Finding 15). Cron Triggers
      are always UTC, which fixes the second by construction — but rows 4 and 8 are date-boundary
      computations, so check them before copying expressions across verbatim.
      <br>Do not port `JobLockRepository` as the overlap-prevention mechanism: its `INSERT` names an
      `appliedAt` column that exists in neither backend, so `acquire` always fails and the caller
      reports it as "already running, skipping" (Finding 14). Neon has no `$transaction`, so the
      replacement is a conditional single-statement insert or an advisory lock.
- [ ] 3.4 Relocate/reimplement the operational scripts kept in 2.4 (including the backup capability);
      execute retirement of the rest.
      **2.4 output — the kept set is three scripts, not a directory.** Of the 30 files in
      `backend/scripts/`, 26 retire. Only `seed-master-catalogue.ts`, `diagnose-webhook.ts`, and
      `export-excess-products.ts` carry capability that has to be rebuilt; everything else is either
      superseded by the Phase 1 runner (10 scripts, each named in `preflight.ts`/`status.ts`/
      `verify.ts`/`seed.ts`) or SQLite plumbing.
      <br>**Ordering constraint (2.4 Finding 20).** `run-tests.js` is the backend test launcher behind
      `npm run test:backend:diff` — the pre-commit gate. It must be deleted **with** the backend, last,
      or the ability to verify the surrounding removals goes with it.
      <br>**Blocked rows (2.4 Finding 18).** Five historical backfills cannot be shown retirable:
      `design.md` conditions them on adoption *verifying* production tenant IDs and role values, and
      `migrate:verify` asserts neither — it covers tables, the catalog fingerprint, and the 54-row
      reference set only. One read-only production query discharges all five (NULL `organization_id`
      across the four tenant tables, distinct `users.role` values, count of `uploads.status =
      'complete'`). Run it before 2.5 rather than carrying the ambiguity.
      <br>**One invariant should outlive its script:** the tenant-ID integrity check in
      `audit-org-ids.ts` belongs in the Worker conformance suite as a test. Given #462 and #466, an
      operator-run script is the wrong home for it.
      <br>**Backup (2.4 Finding 17).** All three implementations are SQLite file-copies with no
      Postgres path, so this is a reimplementation, not a relocation. What is being replaced is 30
      days / 10 files of retention — so with (b)'s 6-hour PITR reach and single snapshot,
      Neon-native alone is a reduction. The two current implementations also disagree on the backup
      destination path; settle that once.
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
      **2.5 §G did that inventory**: 14 call sites, 13 already routed through `buildApiUrl`. The one
      exception is `components/StorageQuotaWarning.tsx:61`, covered above at 3.1 (Finding 21).
      **Offline-queue mitigation before the production base URL moves (2.5 Finding 25 —
      DOWNGRADED 2026-08-28 from required to precautionary).** `offline-sync.ts` `addOperation:149`
      has no production caller (all 25 call sites are tests), so the queue is always empty and the
      cutover cannot jam it. The working offline path is `lib/sync-manager.ts`, which syncs with
      `Promise.allSettled` and has no head-of-line blocking. The defect below is latent, in dormant
      code, and is tracked as **#480**; step (i) is still worth doing on its own merits, and steps
      (ii)-(iii) only matter if `OfflineSyncService` is adopted rather than retired.
      Original text retained:
      `lib/offline-sync.ts` defers its requests, so it is the one call site that does not fail in
      front of a user who can retry. `processQueueOperations:239` breaks on the first failure
      **without** removing the failed operation, there is no per-operation attempt cap, no queue
      size or age limit, and `performSyncWithRetry:294-295` stops retrying once anything else
      succeeds. One write the Worker rejects therefore jams every write behind it for that user,
      permanently. The only drain is `clearQueue():418`, which silently discards unsynced writes.
      Required, in order:
      (i) **Do not move production `REACT_APP_API_URL` until 3.1 is complete** — no consumed
      Express route may lack a Worker equivalent at the moment the base URL changes. Task 3.1.d
      already records six of eight credit-claim endpoints as having no Worker route; a queued write
      to any of them jams that user's queue. This is the actual mitigation.
      (ii) **Drain before the switch** — trigger a sync while Express is still serving and confirm
      the queue is empty. State the limit rather than assuming it away: the queue is per-browser
      `localStorage`, so a user offline across the cutover window cannot be drained.
      (iii) **Do not use `clearQueue()` as the mitigation.** It discards customer writes. If it is
      used at all, it needs an explicit user-visible decision, not a quiet call during cutover.
      The underlying head-of-line blocking is a **pre-existing defect independent of this change** —
      it reproduces today on any persistent 4xx and survives Phase 4 — so the durable fix (a
      per-operation attempt cap, then drop-with-report or a visible dead-letter list) belongs in its
      own issue, not in this change.
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
      **The abandoned Worker entry point is no longer deleted here.** `workers/src/index.ts`,
      `workers/src/express-adapter.ts`, the nine dead `workers/src/middleware/*` modules and
      `workers/src/utils/auth.ts` move to **3.1.0**, which deletes them before the rest of 3.1
      begins (2.5 Finding 22) — they are a decoy for every rehoming decision in 3.1, so removing
      them is a prerequisite for that work rather than cleanup after it. If 3.1.0 was skipped,
      do it here; otherwise this line is already satisfied by the time Phase 4 opens. The one
      module that legitimately survives into Phase 4 is `workers/src/utils/feature-gates.ts`,
      held until **#471** resolves.
      **Ordering constraint (2.5 Finding 24, part 2).** `backend/scripts/run-tests.js` backs
      `npm run test:backend:diff`, the pre-commit gate. Delete it **in this same commit** and never
      before — deleting it earlier removes the ability to verify the surrounding removals.
      **Before deleting, resolve 2.5 Finding 23.** Six SQLite database files (largest:
      `backend/database.sqlite`, 1.6 MB) and eight `backend/uploads/` blobs are tracked by git.
      Deleting them from the tree does not remove them from history. This is not a Phase 4 blocker —
      the exposure is unchanged by the deletion — but confirm whether they hold production or
      customer data. If they do, that is a history-rewrite/rotation decision in its own issue, not
      part of this change.
- [ ] 4.2 Prune dependencies and scripts from the workspace: remove `express`, `@prisma/*`,
      `better-sqlite3`, and the backend Vitest project from `package.json` files (root, `backend/`, and any
      workspace-level). Remove the now-dead npm scripts (`migrate:prod`, `dev:backend`, `seed:*`, the
      superseded migration scripts from 1.1, etc.). Retire `.github/workflows/backend-test.yml` — its
      multi-tenant coverage (cross-tenant isolation, penetration, concurrency, feature-gate enforcement) is
      already rehomed onto the Worker suite in Phase 3.2, so removing it loses nothing.
      **Ordering constraint (2.5 Finding 24, part 1).** `.github/workflows/workers-test.yml` runs
      `npm ci` in `backend/` because Worker tests import backend source. **Sever that import in
      Phase 3**, before `backend/` is deleted — otherwise deleting the backend breaks the very gate
      that proves the Worker still works. The related trap: Worker `npm run typecheck` uses
      `tsconfig.test.json`, which follows imports into backend source, so cross-package node tests
      must be `exclude`d or CI fails on missing backend dependencies. The required check is the
      `Workers CI Gate` job, not the test jobs — a skipped job counts as success.
      **Workflow sweep from 2.5 §L.** Only `backend-test.yml` is retired. `workers-test.yml` (7
      backend references) and `frontend-test.yml` (6) need revision, not deletion;
      `workers-deploy.yml`, `pages-deploy.yml`, `migrations-e2e.yml` and
      `workers-bundle-size-check.yml` carry 1–2 references each. `migration-prep.yml`,
      `secrets-scan.yml`, `codeql.yml` and `dependabot-auto-merge.yml` are unaffected.
      **Package-command sweep from 2.5 §K.** Root `seed:master-catalogue` must be **repointed**,
      not deleted — its script is a 2.4 "reimplement on the Worker" row. Root `test` currently
      errors by design telling the caller to pick frontend or backend; that message needs updating.
      Root `eslint.ignores.js` needs its `backend/` paths removed.

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
      **2.5 §H measured the surface.** Of 49 files in `docs/`, 24 mention Express or SQLite and 25
      do not. Eight are heavy (`dual-environment-guide.md` 21 references, `rollback-procedure.md`
      14, `security.md` 12, `database-migrations.md` 12, `troubleshooting.md` 11,
      `local-expect-qa.md` 11, `developer-guide.md` 7, `testing-both-environments.md` 5) and need
      rewriting; 16 carry 1–4 incidental references and need a targeted edit each.
      **Two should be retired outright rather than revised** — `dual-environment-guide.md` and
      `testing-both-environments.md` exist *because* there are two backends, and the premise
      disappears at Phase 4. **Two are dated records and must not be edited retroactively**:
      `rollback-drill-2026-03-07.md` and `phase-3-csv-upload-timeout-analysis.md`. The three Phase 1
      runbooks and `docs/evidence/` are pre-recorded keeps (2.5 §M).
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
