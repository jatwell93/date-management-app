# Design Notes: Retire Express / unify on Postgres

## Context

This change reverses a decision made deliberately in `use-cloudflare-r2-and-a-serverless-database`.
That change chose a **dual-environment strategy** (Express+SQLite for dev, Worker+Neon+R2 for prod)
and, per its Task 8.3, hand-wrote edge-native Worker handlers rather than importing Express routes,
because `better-sqlite3` (native bindings) and the Prisma query engine cannot run in the Workers
runtime. The `express-adapter.ts` "reuse 100% of the backend" plan described in `workers/README.md`
did not pan out for the real handlers; `shared/domain/*` is the salvage — the team shares the _logic_
even though it could not share the _plumbing_.

The consequence, codified in `openspec/project.md` golden rules 5 and 6, is that every schema change is
triplicated (Prisma base + Neon SQL + runtime SQLite migration) and every dual-implemented query needs
a pglite-vs-SQLite conformance test. That is safe but mechanically expensive.

## Why direct retirement, not a staged engine-swap

An earlier draft staged this as two "knobs": first swap the Express dev/test database SQLite→Postgres
(Knob A), then retire Express (Knob B), leaving a "one engine, two backends" rollback point in between.
We evaluated that against going directly to the Worker and **chose the direct path.**

```
Path A (staged)   SQLite Express -> PostgreSQL Express -> Worker-only
                                    stable stop point (rejected)

Path B (direct)   SQLite Express ----------------------> Worker-only   ✅ chosen
                  retained untouched as rollback until Worker parity + migration runner are proven
```

The staged path is rejected for two concrete reasons:

- **It is throwaway work.** Knob A ports the whole Express test suite onto Postgres keeping it
  Express-shaped (`supertest`, Express `req`/`res`), and Knob B then **rewrites** that same suite
  against the Worker's `Request`/`Response` model — the Express constructs do not exist on the Worker,
  so it is a rewrite, not a port. Knob A's Postgres-backed backend CI is likewise stood up only to be
  retired in Knob B. The bulk of Knob A is written to be discarded.
- **It de-risks the wrong half.** The intermediate rollback point protects a SQLite→Postgres _dialect_
  change that pglite and the existing conformance tests already prove is safe. It provides no cover for
  the genuinely risky work: net-new Worker capability (Stripe webhook inbound, invitations, storage
  quota, scheduled jobs) and the Prisma-independent production migration runner. Expensive insurance
  against the accident least likely to happen.

**Guiding principle: SQLite is deleted, not migrated.** Express keeps running on SQLite, untouched, as
the reference/rollback backend. We de-risk the dangerous parts first — build and prove the migration
foundation (below), audit everything `backend/` owns, bring the Worker to parity, and write the
migrated coverage **once** against the Worker model — then delete Express + Prisma + SQLite together in
one controlled step. The rollback is `git revert` of the branch: because SQLite was never touched, the
working dev backend is restored with no re-plumbing. Each net-new capability (Stripe webhook, jobs) and
the migration runner still gets its own verification/monitoring/rollback gate — "direct" means "no
throwaway intermediate", not "big bang".

## Local database options (the "slow PC" question)

The original worry was that adding a Postgres + Workers runtime locally would bog down an already-slow
machine. The workerd runtime under `wrangler dev` is comparable to the current `ts-node` Express
process, so the deciding factor is the database:

- **pglite (preferred).** In-process WASM Postgres, already a dependency in the pglite conformance
  harness. No server process, negligible idle weight, real Postgres SQL semantics. Best fit for a slow
  PC and for tests. Open question: how faithfully pglite covers the Worker's runtime driver behaviour
  (extensions, `pg`-specific features) for _dev_ use, not just conformance tests.
- **Neon dev branch.** Zero local weight, exercises the exact production engine and driver, gives Git-
  like branching for safe schema experiments. Costs: needs internet, adds query latency, consumes Neon
  free-tier compute (autosuspends when idle).
- **Native Postgres install.** Faithful and offline, but a persistent ~50–100MB idle daemon on the dev
  box.
- **Docker Postgres — rejected.** Docker Desktop on Windows is a constant RAM/CPU tax and the worst
  option on a slow machine. Explicitly not recommended.

Because the direct path never migrates Express to Postgres, the local/test DB story is simpler than the
staged draft's:

- **Express dev/test → stays on SQLite, untouched.** The backend Vitest suite keeps running on
  `better-sqlite3` exactly as today, as the working reference/rollback backend, right up until Express
  is deleted. There is **no** promotion of `vitest.config.neon.ts`, no Prisma-on-Neon test path, and no
  Postgres-backed backend CI to stand up — all of that was Knob A throwaway and is cut.
- **Workers + conformance tests → pglite.** The Worker uses hand-written SQL via
  `@neondatabase/serverless`, and the existing pglite conformance harness
  (`workers/src/__tests__/pglite-db.ts`) already runs that SQL against in-process WASM Postgres. No new
  deps, no internet, fast. This is where the migrated coverage is written **once** (Worker-shaped) in
  Phase 3.
- **Worker local dev → `wrangler dev` against a Neon dev branch.** Exercises the exact production engine
  and driver. PGlite remains the offline test/conformance engine for behaviours that do not need the
  real driver; this plan does not invent a PGlite adapter for `wrangler dev`.
- **Migration-runner CI → ephemeral PostgreSQL for required PR checks.** The Phase 1 runner is proven
  against an isolated service with no production secrets. A separate scheduled job creates and cleans
  up an isolated Neon branch to exercise provider-specific behaviour.

The Worker-shaped test coverage written in Phase 3.2 must, from the start, satisfy the isolation and
fail-closed properties the staged draft was going to retrofit onto the Neon harness:

- initialize schema from the authoritative Phase 1 migrations/baseline, not an embedded `SCHEMA_SQL`;
- fail closed when PostgreSQL setup or credentials are missing (never skip);
- give every local/CI run an isolated database or schema namespace and clean it up even on failure;
- never point destructive test setup at a shared development or production database (explicit per-run
  target identity + allow token);
- preserve coverage thresholds; and
- keep pull-request CI runnable without exposing production credentials by using an ephemeral CI
  PostgreSQL service. Hosted CI may implement this as a service container; developers do not need
  local Docker. A scheduled Neon compatibility job uses equivalent per-run isolation and cleanup.

Note this makes the Prisma-vs-pglite adapter question moot: the backend is never pointed at pglite
(Prisma's PGlite support is only a community adapter, not worth the supply-chain risk), because the
backend is deleted rather than re-plumbed.

## What survives

- `shared/domain/*` stays — it is the single source of truth for cross-cutting business values and
  its raw-SQL-vs-TS conformance tests remain worthwhile even with one backend (they prove the Worker's
  hand-written SQL matches the shared TypeScript rules).
- The Worker keeps hand-written SQL via `@neondatabase/serverless`; this change does not introduce an
  ORM on the Worker.
- Production is untouched throughout — it already runs solely on the Worker.

## What retires

All of the following are removed **together** in Phase 4, once the migration foundation and Worker
parity are proven — SQLite is deleted, never migrated:

- `backend/` Express server, its Prisma client, and `better-sqlite3`.
- Prisma base (SQLite) schema **and** the runtime `src/migrations/` SQLite path. The runtime path is
  **code, not just SQL**: `backend/src/migrations/{migrate.ts,migration.service.ts,migration.model.ts}`
  plus the numbered `*-*.migration.ts` files constitute a hand-rolled SQLite migration runner that is
  removed alongside the schema.
- The Prisma **production** schema.
- `workers/src/index.ts` and `workers/src/express-adapter.ts` — the abandoned "reuse 100% of the
  backend via the express-adapter" approach (described in `workers/README.md`) that did not pan out
  because `better-sqlite3` and the Prisma engine cannot run in the Workers runtime. `index-minimal.ts`
  is the real entry point; the adapter pair is deleted alongside `backend/`.
- The SQLite side of the conformance tests; conformance becomes "raw SQL vs shared TS on Postgres"
  rather than "Postgres vs SQLite". The conformance tests already live in `workers/src/__tests__/`
  (`database.conformance.node.test.ts`, `database.credit-claim.conformance.node.test.ts`,
  `database.supplier-policy.conformance.node.test.ts`, etc.), so dropping the SQLite arm is a
  workers-side edit — there is no backend-owned conformance suite to migrate.
- The Prisma-based production migration mechanism (`npm run migrate:prod` /
  `scripts/migrate-production-doppler.js`), **replaced first** by a Prisma-independent Neon migration
  runner (see below) — never deleted without a successor. Note there are **several** backend-owned
  migration scripts, not one: `migrate-production-doppler.js`, `migrate-production-simple.js`,
  `migrate-production.ts`, `migrate.js`, `verify-migration.js`, `list-migrations.ts`, and the additional
  data migration `migrate-upload-status.ts`. Each is inventoried below and either replaced by the new
  runner or explicitly retired.
- Golden rules 5 and 6 in their current dual-backend form.

## Phase 1.1 migration ownership inventory

This is the deletion-control inventory captured from the source before selecting a replacement runner.
Every row is **REPLACE / DO NOT DELETE**: it remains protected until a successor reproduces the stated
responsibility or a later task records an explicit retirement decision. “Retire with SQLite” below is
that planned decision, but it is not executable until the Phase 4 gate is met.

### Current authoritative production command

`backend/package.json` binds `npm run migrate:prod` to
`node scripts/migrate-production-doppler.js`. Its complete observable contract is:

1. Require Node/npm, Prisma CLI and Doppler CLI; require
   `doppler configure get config --plain` to return a non-empty configured **config value**, and require
   the downloaded secret set to contain `NEON_CONNECTION_STRING`. The script does not validate the
   configured Doppler project or prove that the config is production: its `"prd" project and config`
   wording is operator guidance/assumption only. `ts-node` is checked but absence is only warned.
2. Require an operator to type `yes` after an explicit production-mutation warning.
3. Read `prisma/schema.prisma`, temporarily change its datasource from SQLite to PostgreSQL and point
   its URL at `NEON_CONNECTION_STRING`; generate the PostgreSQL Prisma client.
4. Under `doppler run`, execute `scripts/verify-neon-doppler.js`. That wrapper requires
   `test-connection.ts` to connect and pass `SELECT 1` (PostgreSQL version lookup is best-effort),
   invokes `check-tables.ts` to list the target's `public` tables (a non-empty target only warns), and
   invokes `test-write-permissions.ts` to create/drop `_migration_test`. Only after all three helpers
   exit successfully does the command run the authoritative schema mutation `npx prisma db push`.
5. Under `doppler run`, execute `scripts/seed-tier-flags.js`. This idempotently upserts the required
   20-row reference set: five feature keys (`max_skus`, `max_users`, `max_inventory_items`,
   `storage_bytes`, `advanced_analytics`) for each of `starter`, `professional`, `premium`, and
   `concierge`.
6. Under `doppler run`, execute `scripts/verify-migration.js`. It must connect successfully, count and
   list all `public` tables, and count `tier_feature_flags`; query failure is fatal. Important current
   limitation: it reports counts but does not assert an expected table set or expected flag count.
7. On the normal/success path, the `finally` block restores the original SQLite Prisma schema and
   regenerates the SQLite Prisma client. This is **not a failure-path guarantee**: the surrounding
   `catch` calls `process.exit(1)`, which terminates the process before `finally` can perform cleanup.
   A failure after the schema rewrite can therefore leave `prisma/schema.prisma` and the generated
   client in PostgreSQL state. If cleanup itself runs but restoration/regeneration fails, that error is
   only reported as critical and is not converted into a separate non-zero exit.

The successor therefore must not be judged complete merely because it applies SQL. Tasks 1.2–1.7 must
replace target preflight/confirmation, ordered schema application, the required idempotent reference
seed, post-migration schema/data verification, failure signalling, and safe local-schema cleanup (or
eliminate the temporary schema mutation entirely).

### Backend-owned executable scripts

| Owner                                           | Current responsibility                                                                                                                                                                                                                                                      | Protected disposition                                                                                                                                                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/scripts/migrate-production-doppler.js` | Authoritative `migrate:prod` orchestration and the full seven-step contract above.                                                                                                                                                                                          | **Replace / do not delete** until tasks 1.2–1.7 reproduce the contract.                                                                                                                                                         |
| `backend/scripts/migrate-production-simple.js`  | Environment-variable alternative using `prisma/production/schema.prisma`: connection check, client generation, `db push`, inline 20-row tier seed, and count-based verification after typed confirmation.                                                                   | **Replace / do not delete** until status/apply/seed/verify commands exist, then explicitly retire as a duplicate entry point.                                                                                                   |
| `backend/scripts/migrate-production.ts`         | Typed environment-variable alternative: direct Prisma connection, production-schema client generation and `db push`, idempotent 20-row tier seed, and stronger verification of 15 named tables plus exactly 20 flags.                                                       | **Replace / do not delete**; preserve its named-table and exact-reference-count assertions in the successor verification contract before retiring it.                                                                           |
| `backend/scripts/verify-migration.js`           | Production post-push connectivity, public-table enumeration, and tier-flag count reporting; invoked by the authoritative command.                                                                                                                                           | **Replace / do not delete** until task 1.5 supplies schema and reference-data verification.                                                                                                                                     |
| `backend/scripts/list-migrations.ts`            | Reads Prisma’s `_prisma_migrations` ledger and lists migration name/completion time. It is diagnostic for Prisma Migrate history, although `migrate:prod` itself uses `db push`.                                                                                            | **Replace / do not delete** until task 1.2 status output covers the new ledger and task 1.4 reconciles legacy history.                                                                                                          |
| `backend/scripts/migrate-upload-status.ts`      | One-off Prisma data migration: normalize upload status `complete` → `completed`, then report remaining invalid statuses and per-organization stored-byte mismatches. Both verification findings are warnings only; they do **not** reject the data or make the script fail. | **Replace / do not delete** until Phase 2 classifies it as already executed/retirable or rehomes the normalization and decides whether successor verification must fail on either warning condition.                            |
| `backend/scripts/backfill-org-ids.ts`           | One-off Prisma backfill: ensure a hard-coded default organization, assign it to NULL `organizationId` rows in eight models, then report any remaining NULLs. Remaining NULLs set a local flag but do **not** make the process fail.                                         | **Replace / do not delete** until adoption verifies production has no unresolved tenant IDs and Phase 2 explicitly retires or rehomes the backfill. The hard-coded organization identity must not be copied into the successor. |
| `backend/scripts/backfill-canonical-roles.js`   | Idempotent Prisma data backfill for user/invite roles with `--dry-run`; maps known and unknown/null legacy values to canonical roles and fails post-write verification if non-canonical values remain.                                                                      | **Replace / do not delete** until adoption verifies canonical production roles and Phase 2 explicitly retires or rehomes the backfill.                                                                                          |
| `backend/scripts/migrate.js`                    | Alternate JavaScript CLI for the SQLite runtime runner: `up`/`migrate`, `status`, `rollback`, defaulting to `up`.                                                                                                                                                           | **Replace / do not delete** until Phase 4 explicitly retires the SQLite path after Worker parity; its status/rollback responsibilities inform tasks 1.2 and 1.5.                                                                |

Supporting scripts called by the authoritative command are also protected dependencies:
`verify-neon-doppler.js` orchestrates the pre-push connectivity/query check, target table-state
inspection, and create/drop write-permission probe; `seed-tier-flags.js` owns the required reference
seed. They are not migration entry points, but neither may be deleted until task 1.5 provides its
replacement.

The filename/content audit also found these migration-adjacent executables. They do not add another
authoritative production apply path, but they are protected because they own setup, preflight, or
adoption evidence:

| Owner                                       | Current responsibility                                                                                                                                                                                                        | Protected disposition                                                                                                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/scripts/setup.js`                  | Local bootstrap wrapper that invokes `npm run migrate`, tolerates migration failure after warning, then invokes local seeds.                                                                                                  | **Replace / do not delete** until local development is moved to the Worker in Phase 3 or setup is explicitly retired.                                                                           |
| `backend/scripts/audit-org-ids.ts`          | Read-only tenant-ID/null/relationship audit intended to gate the NOT NULL migration.                                                                                                                                          | **Replace / do not delete** until task 1.4 adoption and task 1.5 verification cover its invariants, or Phase 2 explicitly rehomes it.                                                           |
| `backend/scripts/check-null-org-ids.ts`     | Read-only NULL organization-ID check across tenant-scoped models.                                                                                                                                                             | **Replace / do not delete** with the same adoption/verification disposition as `audit-org-ids.ts`.                                                                                              |
| `backend/scripts/check-tables.ts`           | Neon-target table-state preflight that lists public tables and warns, but does not refuse, when the target is non-empty.                                                                                                      | **Replace / do not delete** until task 1.5 target/status preflight supersedes it.                                                                                                               |
| `backend/scripts/test-connection.ts`        | Neon connection and query preflight invoked by `verify-neon-doppler.js` under Doppler: connects through Prisma, requires `SELECT 1` to succeed, and attempts to report PostgreSQL version (version-query failure only warns). | **Replace / do not delete** until task 1.5 provides equivalent fail-closed target connectivity/query checks and version/provider evidence, then explicitly retire this Prisma-dependent helper. |
| `backend/scripts/verify-neon.ts`            | Environment-variable Neon preflight: connection/version/table-state checks plus create/drop write-permission probe; non-empty targets only warn.                                                                              | **Replace / do not delete** until task 1.5 provides fail-closed target and role preflight.                                                                                                      |
| `backend/scripts/test-write-permissions.ts` | Standalone create/drop `_migration_test` write-permission probe against `NEON_CONNECTION_STRING`.                                                                                                                             | **Replace / do not delete** until the new preflight validates the dedicated DDL role.                                                                                                           |

Search boundary: all tracked `backend/scripts/*.{js,ts,sh}` files were checked by filename and for
schema/data mutation terms. Seeds, export/import, backup, and diagnostics remain in the broader Phase
2.4 operational-script inventory; the two production-command dependencies are included above because
they are part of the current migration contract.

### Package migration entry points

| `backend/package.json` command | Current responsibility                                                                                                                                                        | Protected disposition                                                                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrate`                      | Runs `ts-node src/migrations/migrate.ts` against the runtime SQLite path.                                                                                                     | **Replace / do not delete** until Phase 4 retires SQLite.                                                                                            |
| `migrate:status`               | Inline `ts-node` command that prints executed and pending SQLite migrations via `MigrationService.getMigrationStatus()`.                                                      | **Replace / do not delete** until task 1.5 provides status for the authoritative PostgreSQL ledger.                                                  |
| `migrate:rollback`             | Inline `ts-node` command that invokes `MigrationService.rollbackLastMigration()`.                                                                                             | **Replace / do not delete** until the successor’s per-migration recovery contract exists and Phase 4 retires SQLite rollback.                        |
| `db:migrate`                   | Alias of `migrate`.                                                                                                                                                           | **Replace / do not delete**; explicitly retire or repoint after the new command contract is chosen.                                                  |
| `db:status`                    | Alias of `migrate:status`.                                                                                                                                                    | **Replace / do not delete**; explicitly retire or repoint after task 1.5.                                                                            |
| `db:rollback`                  | Alias of `migrate:rollback`.                                                                                                                                                  | **Replace / do not delete**; explicitly retire or repoint after recovery commands are established.                                                   |
| `db:reset`                     | Destructively removes `database.sqlite`, runs the SQLite migration sequence, then `seed` and `seed:tier-flags`; it is local SQLite reset/bootstrap, not production migration. | **Replace / do not delete** until Worker/PGlite test reset and Worker local-dev setup supersede it; never repoint this destructive contract at Neon. |
| `db:studio`                    | Opens Prisma Studio; it does not apply migrations but is the remaining `db:*` package entry point and depends on the retiring Prisma data path.                               | **Replace / do not delete** until Phase 2/3 explicitly retires it or documents a Worker/Postgres-safe operator alternative.                          |
| `migrate:prod`                 | Runs the authoritative Doppler production orchestration described above.                                                                                                      | **Replace / do not delete** until tasks 1.2–1.7 prove its complete successor.                                                                        |

### Runtime SQLite migration system

| Owner                                                  | Current responsibility                                                                                                                                                                                                                                                                                     | Protected disposition                                                                                                                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend/src/migrations/migrate.ts`                    | `npm run migrate` / `db:migrate` entry point; loads `reflect-metadata`, invokes `MigrationService.runMigrations()`, and fails the process on error.                                                                                                                                                        | **Replace / do not delete** until the Phase 4 SQLite retirement gate.                                                                                                                |
| `backend/src/migrations/migration.model.ts`            | Creates and reads the SQLite `migrations` ledger; records/removes applied IDs, names, and execution timestamps.                                                                                                                                                                                            | **Replace / do not delete**; task 1.2 must deliberately reconcile this legacy ledger rather than silently reuse it as the PostgreSQL authority.                                      |
| `backend/src/migrations/migration.service.ts`          | Opens `DATABASE_PATH`, runs each pending `up` in a SQLite transaction, then records it in the ledger in a separate statement; exposes status and rolls back the last recorded migration. That transaction/ledger gap is a behaviour to fix, not copy. It embeds the active numbered sequence listed below. | **Replace / do not delete** until Phase 4 explicitly retires SQLite; preserve its status/recovery responsibilities while task 1.2 makes PostgreSQL DDL plus ledger recording atomic. |
| `001-initial-schema.migration.ts`                      | Standalone SQLite base tables migration. A same-ID definition is embedded in `migration.service.ts`; the service uses its embedded sequence.                                                                                                                                                               | **Replace / do not delete** pending explicit retirement of this duplicate/dead definition.                                                                                           |
| `005-add-notes-field-to-products.migration.ts`         | Standalone SQLite notes-column migration; not the service’s ID-5 definition.                                                                                                                                                                                                                               | **Replace / do not delete** pending explicit retirement of this duplicate/dead definition.                                                                                           |
| `006-update-markdown-statuses.migration.ts`            | Standalone service-based data recalculation with no effective rollback. The active service embeds a separate ID-6 implementation.                                                                                                                                                                          | **Replace / do not delete** pending an explicit decision on whether its data responsibility is historical or must be reproduced.                                                     |
| `007-add-expired-item-transactions-table.migration.ts` | Standalone SQLite table/index migration. A same-ID definition is embedded in `migration.service.ts`.                                                                                                                                                                                                       | **Replace / do not delete** pending explicit retirement of this duplicate/dead definition.                                                                                           |

The active embedded `MigrationService` sequence is exhaustive at capture time:

|  ID | Name                                                  | Primary responsibility                                                                 |
| --: | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
|   1 | `001-initial-schema`                                  | Base SQLite tables.                                                                    |
|   2 | `002-add-sub-department-column`                       | Store-area sub-department column.                                                      |
|   3 | `003-add-performance-indexes`                         | Initial query indexes.                                                                 |
|   4 | `004-add-default-data`                                | Default store-area reference rows.                                                     |
|   5 | `005-add-additional-performance-indexes`              | Additional indexes (not the standalone notes migration).                               |
|   6 | `006-update-markdown-statuses`                        | Recalculate inventory markdown statuses.                                               |
|   7 | `007-add-expired-item-transactions-table`             | Expired-item transaction table and indexes.                                            |
|   8 | `008-add-organization-id-to-reporting-tables`         | Tenant columns/indexes for reporting data.                                             |
|   9 | `009-add-markdown-level-to-expired-item-transactions` | Markdown-level transaction field.                                                      |
|  10 | `010-add-retail-price-to-products`                    | Product retail price.                                                                  |
|  11 | `011-add-organization-markdown-config-table`          | Organization markdown configuration.                                                   |
|  12 | `012-add-parent-id-to-store-areas`                    | Store-area hierarchy and associated rebuild/backfill.                                  |
|  13 | `013-add-check-cycles-table`                          | Store-walk check cycles.                                                               |
|  14 | `014-add-bay-checks-table`                            | Bay-check records.                                                                     |
|  15 | `015-add-supplier-credit-claims`                      | Supplier credit-claim tables/fields/indexes.                                           |
|  16 | `016-add-brand-supplier-mapping`                      | Brand-to-supplier mapping.                                                             |
|  17 | `017-add-supplier-policy-fields`                      | Supplier policy fields.                                                                |
|  18 | `018-add-credit-scoped-markdown-matrix`               | Credit-scoped markdown configuration and data copy; down intentionally preserves data. |
|  19 | `019-add-catalogue-provenance`                        | Catalogue seed-run provenance and retirement field.                                    |

Finally, the backend owns two distinct SQL-history families, both protected even though they are not
scripts. The complete tracked `backend/prisma/migrations/` inventory is:

- 25 timestamped migration **directories**, each containing `migration.sql`;
- `20260227113208_make_organization_id_required/backfill.sql` nested beside that directory’s
  `migration.sql`;
- legacy unscoped `add_uploads_table.sql` at the migrations root; and
- `migration_lock.toml`.

There are no other tracked files under `backend/prisma/migrations/` at capture time. Separately,
`backend/prisma/neon-sql/` contains exactly nine forward/rollback pairs (`0001`–`0009`, 18 files).
The Prisma family records legacy schema/data history and must be reconciled by baseline/adoption,
including explicit decisions for the unscoped and nested SQL. The Neon family is the incomplete
production delta series that task 1.2 relocates and promotes. Neither family may be removed until
baseline/adoption, checksums, and relocation are proven.

## What must be rehomed, not silently dropped

`backend/` owns more than HTTP routes; each of these needs a home or an explicit retirement decision in
the Phase 2 rehoming checklist **before** the directory is deleted:

- **Scheduled jobs** (`backend/src/jobs/`): `credit-claim`, `daily-metrics`, `daily-report-email`,
  `dunning`, `stripe-sync`, `trial-expiration` → Cloudflare **Cron Triggers** or **Queues**.
- **Operational scripts** (`backend/scripts/`): seeds (`seed-users`, `seed-tier-feature-flags`),
  audits/backfills (`audit-org-ids`, `backfill-*`), data export (`neon-to-sqlite`,
  `export-excess-products`), diagnostics (`diagnose-webhook`, `verify-neon*`), and `backup.sh`.
- **Backup capability** — `backend/scripts/backup.sh` and `backend/src/routes/database.backup.routes.ts`
  together implement an operator-triggered backup. In a Worker-only world the backup trigger becomes a
  Worker route (or is dropped in favour of Neon-native backups / a scheduled R2 export via a Cron
  Trigger). Phase 2 task 2.4 records the chosen home; the backup route is on the rehoming checklist
  before `backend/` is deleted.
- **Production migration runner** (see below) — the single most load-bearing non-route responsibility.

## Replacement production migration path

Golden rule 6 makes production authoritative through `prisma db push` (`npm run migrate:prod`). Removing
Prisma removes that path, so before deletion we stand up a Prisma-independent runner:

- **Relocate and promote `backend/prisma/neon-sql/*.sql`** from Prisma-mirroring review/operator SQL
  into a permanent path outside `backend/`; that relocated history becomes the single authoritative,
  executable migration set and survives deletion of the backend workspace.
- **Run it with a lightweight runner** (`node-pg-migrate`, `dbmate`, or a small first-party script) that
  supports forward migration plus an explicit recovery mechanism appropriate to each migration's
  declared reversibility/data-loss class, invoked under Doppler from outside `backend/` (workers
  workspace or repo root). Reversible migrations may provide lossless downs; destructive changes use
  Worker rollback with expanded schema, forward correction, or point-in-time restore instead.
- Track applied migration identity/checksums so changed or out-of-order files fail before execution,
  and define transaction behaviour for migrations that PostgreSQL cannot run transactionally.
- **Prove it on a real schema change against a Neon dev branch, including rollback**, before Prisma is
  removed. This is the successor to `migrate:prod` and becomes the "one authoritative path" named in the
  rewritten golden rule 6.

The current Neon SQL files are not a complete history: they assume the production schema already exists
because historical production changes were applied with `prisma db push`. The new path therefore needs
both a **baseline** and an **adoption** flow:

```
Fresh database -> canonical baseline -> ordered migrations -> expected schema fingerprint

Existing production database
  -> read-only catalog/fingerprint preflight
  -> explicit dry-run adoption report
  -> operator-approved baseline stamp
  -> ordered future migrations
```

Adoption never interprets "object already exists" as proof that the object is correct. It verifies
definitions from PostgreSQL catalogs, then records the adopted baseline and checksums in a dedicated
ledger. The runner uses an advisory lock, atomic transactional DDL plus ledger writes where possible,
explicit non-transactional metadata where not, bounded timeouts, and recoverable interruption semantics.

Production schema changes follow expand/migrate/contract:

```
expand (old + new Worker compatible)
  -> deploy compatible Worker
  -> resumable backfill / switch reads+writes
  -> observe
  -> contract in a later deployment
```

Database recovery and application rollback are deliberately separate. Unsafe downs become a forward
fix or Neon restore; rolling back Worker code normally leaves the expanded schema in place.

### Phase 1.2 runner decision and migration-history contract

The selected runner is a small, root-owned TypeScript program using `pg`. It lives at
`src/database/migrations/`, compiles with the existing root TypeScript project, and is invoked with
`npm run migrate:apply`. `pg` is now a root dependency so migration execution does not depend on the
backend workspace that Phase 4 deletes. The command accepts only `DATABASE_URL_UNPOOLED`, rejects Neon
pooler hostnames, requires exact `MIGRATION_ALLOWED_HOST` and `MIGRATION_ALLOWED_DATABASE` matches, and
requires `MIGRATION_CONFIRM_PRODUCTION="APPLY <host>/<database>"` when
`MIGRATION_ENVIRONMENT=production`. It also requires `MIGRATION_DEPLOYMENT_SHA` for the audit ledger,
uses one direct client for the complete session, and reports only the target hostname and database
name.

The authoritative SQL and its manifest now live at `database/migrations/`. The nine former
`backend/prisma/neon-sql` pairs were relocated without changing any SQL statement and renamed to
explicit `.up.sql` and `.down.sql` suffixes. `manifest.json` is part of the authoritative history and
declares, for every migration:

- its ordered four-digit identity and exact forward/recovery filenames;
- required or forbidden transaction handling;
- expand compatibility and forward data-loss class; and
- recovery strategy, execution policy, recovery data-loss class, and completeness.

The loader rejects duplicate/out-of-order identities, unsafe filenames, missing files, undeclared SQL
files, and invalid metadata. Its SHA-256 identity covers the metadata, forward SQL, and recovery SQL, so
changing any historical element after application causes a fatal checksum mismatch.

The runner owns a dedicated `schema_migrations` ledger. It intentionally does not rename, delete,
import, or reinterpret the legacy `migrations` table: that table records the retired backend's embedded
SQLite migration identities and is not evidence that the PostgreSQL SQL history ran. Existing targets
will be reconciled through the catalog-verified adoption flow in task 1.4; until that approved stamp,
the histories coexist and `schema_migrations` alone is authoritative for this runner.

Each ledger row records the immutable migration name, deployment SHA, start time, transaction rule,
data-loss/recovery classifications, state, checksum, and completion time. Applied rows must form a
contiguous prefix of the manifest; unknown identities, checksum changes, gaps, and interrupted
`applying` rows all stop execution before pending SQL runs.

One fixed two-key PostgreSQL advisory lock serializes runs. Session `lock_timeout`,
`statement_timeout`, and `idle_in_transaction_session_timeout` are bounded. For a transactional entry,
its SQL and `schema_migrations` write share one `BEGIN`/`COMMIT` unit and failures roll back. An explicitly
non-transactional entry first records `applying`; interruption leaves that state in place and every
later run refuses to continue. Repair is deliberate: inspect the catalog and migration-specific
postconditions, then use the adoption/repair command introduced in tasks 1.4-1.5 to either complete the
forward operation and stamp its checksum or restore the target. The runner never guesses based on
object names or replays a partially applied non-transactional file.

All nine inherited down files are classified `manual-only` and `destructive`; none is an automatic
application rollback. The 0004 down is additionally classified `partial` because it does not remove
department rows created by its backfill, and its primary recovery strategy is therefore `forward-fix`
rather than `rollback-sql`. Routine rollback remains Worker rollback with the expanded schema. An
operator may use a complete declared down only as part of an explicitly reviewed recovery decision
where its data loss is acceptable; otherwise recovery is a forward fix or Neon restore.

The current SQL series still has no baseline. `npm run migrate:apply` therefore fails before connecting
unless `0000_baseline.up.sql` exists. Task 1.3 creates that canonical baseline and adds it to the
manifest; task 1.4 then provides the separate catalog-verified adoption path for existing databases.

### Phase 1.3 canonical baseline

The canonical baseline (`0000_baseline.up.sql`) is the DDL that existed in production immediately
before the first neon-sql delta (0001) was introduced. Production was shaped by `prisma db push`
against the Prisma production schema, so the baseline is generated from that schema at the commit
immediately before the first delta — not hand-written and not derived from the current (post-delta)
schema.

**Source commit.** `ae26d623~1`, the parent of `ae26d623 feat(uploads): queued catalogue imports and
launch pricing`, which introduced migration 0001. Using the parent guarantees the baseline reflects
exactly the schema that 0001 was written against, with no post-0001 columns mixed in.

**Generation command (reproducible from git history):**

```
git show ae26d623~1:backend/prisma/production/schema.prisma > baseline.prisma
DATABASE_URL=postgresql://placeholder npx prisma@5.22.0 migrate diff \
  --from-empty --to-schema-datamodel baseline.prisma --script
```

Prisma is pinned to `5.22.0` — the version in the lockfile at commit `ae26d623~1`. Prisma 6+
additionally emits `CREATE SCHEMA IF NOT EXISTS "public";` as its first statement; that line is
added manually to the baseline file for fresh-database safety since Prisma 5.22.0 does not emit it.
The table DDL is byte-identical between the two versions (verified by regenerating with both and
diffing the SQL statements). `prisma migrate diff` generates standard PostgreSQL DDL (`CREATE TABLE`,
`CREATE INDEX`, `ALTER TABLE ... ADD CONSTRAINT`) without needing a live database connection. The
output is 429 lines of Prisma-generated SQL plus the manual `CREATE SCHEMA` line and a
documentation header, creating 20 tables, their indexes, and foreign keys. The header records the
source commit, pinned Prisma version, and generation command so the baseline is reproducible by
anyone with git history.

**Manifest entry.** The baseline is declared in `manifest.json` as `id: "0000"`,
`transaction: "required"`, `compatibility: "expand"`, `dataLoss: "none"`, with a
`rollback-sql` recovery (`0000_baseline.down.sql`) classified `manual-only`, `destructive`, and
`complete`. The down migration drops only the 20 tables that 0000 created — it does not drop
objects introduced by later migrations (0001–0009) or the runner's `schema_migrations` ledger,
because those are owned by their respective migrations and the runner. Including them would couple
the immutable 0000 recovery SQL to every future migration and invalidate its checksum (recovery SQL
is part of the runner's SHA-256 identity). CASCADE removes FK constraints from migration-added
tables that reference baseline tables, but does not drop the migration-added tables themselves.

**Fingerprint test.** `src/database/migrations/baseline.fingerprint.test.ts` replays migrations
against a fresh in-process pglite (WASM Postgres) database and performs a deep catalog comparison
covering every table, column (type, nullability, default), index (definition, uniqueness, partial
predicate), constraint (type, definition), function (body), and trigger (timing, events). Three
test groups provide layered proof:

1. **Checked-in fingerprint** (`database/migrations/catalog-fingerprint.json`): the full
   0000→0009 series is replayed against pglite, the resulting catalog is introspected via
   `pg_catalog`/`information_schema`, normalized, and deep-compared against a checked-in JSON
   fingerprint. Every table, column, index, constraint, function, and trigger must match exactly
   (after type/default normalization). This catches drift in any migration after the fingerprint
   was captured — a changed column type, a missing index, an altered constraint definition all
   fail the test.

2. **Baseline-only cross-comparison**: migration 0000 alone is applied to pglite A; the
   Prisma-generated SQL from the `ae26d623~1` schema is applied to pglite B; the two catalogs are
   compared structurally (normalizing index/constraint names, which Prisma generates differently
   from hand-written SQL). This proves the baseline exactly reproduces the pre-0001 production
   schema — not just that it produces a self-consistent schema.

3. **Full-series cross-comparison**: migrations 0000→0009 are applied to pglite A; the
   Prisma-generated SQL from the current production schema is applied to pglite B; the two
   catalogs are compared structurally with an explicit allowlist for known, accepted differences
   (e.g. `TIMESTAMP(3)` vs `TIMESTAMPTZ` on migration-added columns, index name divergence). This
   catches gaps — columns or tables that exist in the Prisma schema but were never captured in a
   migration — and any difference not in the allowlist fails the test.

**pglite adapter.** pglite is ESM-only and the root project compiles to CommonJS, so the test
loads it via dynamic `import()`. pglite's `query` method rejects multi-statement SQL ("cannot
insert multiple commands into a prepared statement"), so the adapter routes non-SELECT statements
without parameters through `pg.exec` (which handles multi-statement DDL) and SELECTs/parameterised
queries through `pg.query`. The adapter implements the runner's `MigrationClient` interface, so
the runner's locking, ledger, and transaction logic is exercised end-to-end against a real
Postgres engine — not mocked.

**Test concurrency.** pglite is WASM and memory-intensive; each test boots a fresh instance. The
`test:migrations` script uses `--test-concurrency=1` to avoid exhausting memory on CI.

**What this does not yet cover.** The real-Postgres and Neon end-to-end proof (fresh install,
adoption, interruption/recovery, drift, safe down, forward fix) is task 1.6. The catalog-verified
adoption path for existing production databases is task 1.4.

### Phase 1.4 adoption command

The existing production database was shaped by `prisma db push` plus the hand-written neon-sql
deltas. Adoption transitions it from Prisma-managed to migration-runner-managed by verifying the
catalog matches the expected migration-derived schema and stamping the `schema_migrations` ledger.
Adoption is a one-time operation: if the ledger already has rows, it refuses.

**Two modes with explicit flags.** `npm run migrate:adopt -- --dry-run` performs read-only catalog
checks and emits a reviewable report — no writes, no ledger creation. `npm run migrate:adopt --
--apply` re-runs the same catalog check inside a single transaction and, only if the catalog
matches, stamps the ledger. Unknown arguments are rejected — a typo such as `--dryrun` is NOT
silently treated as authorization to stamp. Exactly one of `--dry-run` or `--apply` must be
specified; omitting both or specifying both is an error.

**Adoption confirmation.** The `--apply` mode requires an explicit, adoption-specific confirmation
via `MIGRATION_ADOPT_CONFIRMATION="ADOPT <host>/<database> AT <migration-id>"`. This is separate
from the production target confirmation (`MIGRATION_CONFIRM_PRODUCTION`) and prevents accidental
stamping. The migration ID in the confirmation must match the latest migration in the history.

**Read-only dry-run.** Dry-run mode does NOT create the `schema_migrations` table. It queries
`information_schema.tables` to check whether the ledger already exists, treats absence as an empty
ledger, and wraps the catalog introspection in a `ROLLBACK`-only transaction for snapshot
consistency. No schema object or ledger state is changed — verified by a dedicated test that
asserts the table does not exist before and after dry-run.

**Dry-run exit code (hardened 2026-07-28).** The adopt CLI exits **non-zero**
on EVERY refusal — catalog mismatch OR a populated ledger — in BOTH dry-run
and apply modes. `STATUS: READY` (and only that) exits 0. Previously a
`--dry-run` refusal exited 0 (treated as "informational"), which let a
refused dry-run pass a `set -e` / CI gate silently: the real Neon
`migration-role-check` branch exercise ran `migrate:adopt -- --dry-run`
against a production-shaped database missing migration
`0001_queued_catalogue_imports`, the report printed `STATUS: REFUSED —
catalog does not match expected schema`, but the process exited 0 and did
not stop the sequence. A dry-run is the operator's read-only adoption gate;
a refusal there MUST fail the gate so the mismatch is reconciled before
any apply. The decision lives in `adoptExitCode(report)` (`adopt.ts`),
consumed by `adopt-cli.ts`, with a unit test covering READY (exit 0),
catalog mismatch (exit 1), and populated ledger (exit 1).

**Strict adoption comparison profile.** Adoption uses a separate `ADOPTION_COMPARISON` profile that
is stricter than the fingerprint test's `TEST_COMPARISON` profile:

- **CHECK and UNIQUE constraints are required.** They are included in the mismatch check — a
  missing `suppliers_credit_type_check` or missing unique constraint causes a refusal. (The test
  profile excludes them because Prisma cannot express CHECK constraints and uses
  `CREATE UNIQUE INDEX` instead of `ADD CONSTRAINT UNIQUE`.)
- **Migration-owned partial indexes are required.** They are NOT filtered out — a missing
  `uploads_one_active_catalogue_per_org` partial index causes a refusal. (The test profile filters
  them because Prisma cannot express partial indexes.)
- **No broad column exception rules.** The test profile's broad rules (any `updated_at` default
  difference, any timestamptz/timestamp(3) difference) do NOT apply to adoption. Column exceptions
  must be exact `AdoptionColumnException` tuples specifying the table, column, expected
  type/default, and actual type/default. An exception that does not match the exact tuple is a
  mismatch. By default, the exception list is empty — every column difference is a mismatch unless
  explicitly listed.

**Single-transaction introspection and stamping.** The approved adoption performs catalog
introspection and ledger stamping inside a single `BEGIN ISOLATION LEVEL REPEATABLE READ`
transaction. The catalog snapshot used for verification is the same one the stamp writes to —
there is no window between verification and stamping where the schema could change. The advisory
lock coordinates with the migration runner; a **schema-change deployment freeze must be in effect
during adoption** because the advisory lock only serializes programs using that same lock —
Prisma, manual SQL, and legacy deployment tooling can still modify the schema unless externally
frozen.

**Advisory lock release.** The advisory lock is released in a `finally` block — no early return
or thrown error bypasses it. Both primary and unlock failures are preserved as a
`MigrationExecutionError` with nested errors.

**Shared comparison module.** The structural comparison logic (`computeStructuralKeys`,
`compareCatalogs`, `formatCatalogDiff`, `ComparisonConfig`, `TEST_COMPARISON`,
`ADOPTION_COMPARISON`, `AdoptionColumnException`) lives in
`src/database/migrations/catalog-comparison.ts`, shared between the fingerprint test and the
adoption command. The two profiles ensure the test comparison can use broad Prisma-vs-migration
exception rules while adoption uses strict, exact-tuple verification.

**Ledger stamping.** The approved adoption creates the ledger (if it does not exist) and stamps
all migrations (0000→latest) inside the same transaction: `BEGIN` → `ensureLedger` →
`recordMigration` for each → `COMMIT`. Each row records the immutable migration name, checksum,
state (`applied`), transaction rule, data-loss class, recovery strategy, deployment SHA, and
timestamps. After stamping, `migrate:apply` sees the database as fully migrated and applies only
future migrations.

**Environment and target validation.** The adoption CLI uses the same `validateMigrationTarget`
guard as `migrate:apply`: requires `DATABASE_URL_UNPOOLED`, rejects Neon pooler hostnames, requires
exact `MIGRATION_ALLOWED_HOST`/`MIGRATION_ALLOWED_DATABASE` matches, and requires
`MIGRATION_CONFIRM_PRODUCTION="APPLY <host>/<database>"` for production targets. It also requires
`MIGRATION_DEPLOYMENT_SHA` for the audit ledger and `MIGRATION_ADOPT_CONFIRMATION` for `--apply`.

**Report format.** The adoption report includes:

- Mode (dry-run or apply)
- STATUS: READY / REFUSED
- Adoption point (latest migration ID)
- Migrations to stamp (dry-run) or stamped (approved)
- Catalog diff: tables/columns/indexes/constraints/CHECK constraints/UNIQUE constraints/functions/
  triggers only in expected or only in actual, plus known/accepted differences
- Actionable guidance for refused adoptions

**Test coverage** (`src/database/migrations/adopt.test.ts`, 15 tests against pglite):

- Dry-run on a matching database → `canAdopt: true`
- Dry-run does NOT create the `schema_migrations` table (read-only verified)
- Dry-run on a partial database (only baseline applied) → refused with missing-table diffs
- Approved adoption on a matching database → ledger stamped with all migrations as `applied`
- Checksums in the stamped ledger match the runner's loaded checksums
- Approved adoption requires explicit confirmation (missing → rejected)
- Wrong adoption confirmation (wrong host/db or wrong migration ID) → rejected
- Approved adoption does not stamp if the catalog does not match
- One-time guard: ledger already populated → refused with `ledgerAlreadyPopulated`
- Object exists but has wrong definition (extra column) → refused with column diff
- Table missing from the existing database → refused with table diff
- Missing CHECK constraint → refused (strict adoption profile)
- Missing migration-owned partial index → refused (strict adoption profile)
- Invalid deployment SHA → rejected before any catalog check
- Exact column exception tuple is accepted (and without it, the same difference is refused)

### Phase 1.5 ordered migration commands and target guards

Task 1.5 delivers the ordered command set that replaces the backend-owned
`migrate:prod` orchestration (status → preflight → apply → seed → verify) and
the shared target/role guards that every mutating command must pass. All new
code lives under `src/database/migrations/` (outside `backend/`), so the
authoritative migration path no longer depends on Prisma or Express.

**New commands (npm scripts → `-cli.ts` entrypoints → core modules):**

| Command             | Entry point               | Core module    | Mutates DB | Purpose                                                                                                                                                 |
| ------------------- | ------------------------- | -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrate:status`    | `status-cli.ts`           | `status.ts`    | no         | Read-only ledger state: applied/pending/orphaned IDs, checksum drift, interrupted (`applying`) rows, contiguous-prefix check, health verdict.           |
| `migrate:preflight` | `preflight-cli.ts`        | `preflight.ts` | no         | Read-only readiness: connection, `current_user` role, schema/database `CREATE` privileges, write probe, ledger state, interrupted rows, ready verdict.  |
| `migrate:apply`     | `cli.ts` (extended)       | `runner.ts`    | yes        | Apply pending migrations under the advisory lock with deployment-SHA audit. Now gated by role + target-kind.                                            |
| `migrate:adopt`     | `adopt-cli.ts` (extended) | `adopt.ts`     | yes        | One-time ledger stamp for an existing schema. Now gated by role + target-kind.                                                                          |
| `migrate:seed`      | `seed-cli.ts`             | `seed.ts`      | yes        | Idempotent upsert of the 54 `tier_feature_flags` reference rows + verify. Production requires `MIGRATION_SEED_CONFIRMATION=SEED <host>/<db>`.           |
| `migrate:verify`    | `verify-cli.ts`           | `verify.ts`    | no         | Post-apply verification: expected tables present, `tier_feature_flags` row count + values match, catalog-vs-fingerprint drift check, PASS/FAIL verdict. |

**Shared guards (`target.ts`):**

- `assertTargetKind({ targetKind, mutating })` — `MIGRATION_TARGET_KIND` is
  required and must be one of `primary | development | restore-drill`. For
  mutating commands (`apply`, `adopt`, `seed`) only `primary` is accepted;
  `development` and `restore-drill` are rejected. Read-only commands
  (`status`, `preflight`, `verify`) accept all three kinds. This is the
  "rejection of development/restore/pooled application targets" requirement.
- `verifyMigrationRole(client, expectedRole)` — `MIGRATION_ROLE` is required
  and must equal `SELECT current_user`. Enforces that the migration identity
  is the schema owner (`neondb_owner`), not the application's runtime role:
  the Worker's `app_runtime` role cannot run migrations even if it has the
  privileges. The CLI entrypoints call this after `client.connect()` and
  before any DDL, so a wrong role fails fast with no writes. See "Runtime
  role separation" under Phase 1.7 for the ownership model.
- `validateMigrationTarget` (existing, in `runner.ts`) continues to enforce
  the allowlisted host/database, environment, and explicit production
  confirmation (`APPLY <host>/<db>`).

**Output and redaction:** `migrate:apply` emits JSON with `target.host` and
`target.database` only (no password, no full connection string). The other
commands emit human-readable text with the same redacted target identity.
Errors are formatted via `formatMigrationError`, which recursively redacts
connection strings in nested causes.

**Seed contract (`seed.ts`):** the 54 declared `(tier_level, feature_key,
enabled, limit_value)` rows are upserted via `ON CONFLICT (tier_level,
feature_key) DO UPDATE`. After upsert, the rows are re-read and compared
field-by-field; any mismatch is reported and the command fails. This is
idempotent and converges the retired production seed's `storage_bytes` rows
to the current limits. The matrix contains nine keys for each of six tiers;
the legacy backend startup validator intentionally checks only its existing
eight-key subset until the Prisma `Int` mapping is replaced in Phase 4.

**Verify contract (`verify.ts`):** three independent checks, all must pass:

1. **Tables** — every table named in the fingerprint exists in `public`.
2. **Reference data** — `tier_feature_flags` has exactly 54 rows and every
   declared `(tier_level, feature_key, enabled, limit_value)` tuple matches.
3. **Catalog** — introspect the live catalog, normalize, deep-compare against
   `database/migrations/catalog-fingerprint.json` (the same artifact the
   baseline fingerprint test uses). Any drift fails verification.

**Pre-existing schema/data inconsistency surfaced and fixed.** While porting
the seed to raw SQL, the int4 `tier_feature_flags.limit_value` column rejected
the declared `storage_bytes` tier limits (10 GB = 10737418240, 100 GB = 107374182400) — both exceed the int4 maximum (~2.1B). The backend Prisma seed
(`backend/scripts/seed-tier-flags.js`) and the shared single-source-of-truth
(`shared/types/subscription.ts`) both declare these values, so the seed could
not have ever successfully inserted the professional/premium/concierge
`storage_bytes` rows against the int4 column. This is a latent production
inconsistency that the Prisma `db push` path masked.

Resolution chosen (per explicit decision): add migration
`0010_alter_tier_feature_flags_limit_value_to_bigint` (expand-compatible,
forward-fix recovery) and regenerate `catalog-fingerprint.json` so the
widened type is now the authoritative contract. The full-series cross-
comparison test still passes because the bigint-vs-integer divergence is
allowlisted in `catalog-comparison.ts` (`isKnownColumnDifference`) until the
Prisma production schema is updated to `BigInt` in Phase 4. This keeps
Phase 1.5 unblocked without silently rewriting the Prisma schema, and it
makes the new seed command actually runnable against a real database.

**Sequencing note for 1.6:** a pre-0010 production database must first adopt
the history prefix whose fingerprint matches its schema, then apply the
remainder. Set `MIGRATION_ADOPTION_POINT=0009`, run `migrate:adopt` (dry-run,
then approved apply with confirmation ending in `AT 0009`), and then run
`migrate:apply` to execute 0010. The adoption CLI selects
`catalog-fingerprint.0009.json` and stamps only 0000→0009, so the normal runner
sees 0010 as pending. Task 1.6's end-to-end proof must cover this executable
sequence. The bigint widening is the natural "real schema change with a
working rollback" candidate for 1.6's Neon dev-branch gate, since its down
migration narrows back to int4 (destructive, partial — the documented
forward-fix recovery path).

### Phase 1.6 end-to-end runner proof

Task 1.6 proves the migration runner end-to-end against real PostgreSQL,
split into an **automatable e2e suite** (1.6.A) and an **operator-driven
Neon gate** (1.6.B). The parent task stays open until the operator evidence
is recorded; only the automation and runbook subtasks are complete.

**Production PostgreSQL version — verified.** The Neon production project
`date-management-prod` (ID `dawn-darkness-22587117`, region
`aws-ap-southeast-2`) runs **PostgreSQL 17** (confirmed via Neon MCP
`list_projects` on 2026-07-25). The CI service container is pinned **by
amd64 digest** to `postgres:17.10-trixie@sha256:cb875afe6d2e8593c28c22d37d0fd7aaf035c43a42e2f7792cd4c09ceb6beac5`
(verified via Docker Hub API on 2026-07-25 — the amd64 image digest matches
the documented tag) to match production exactly and to make the image
immutable so a registry-side republish cannot silently change the PG minor
version. If production upgrades to PG 18+, both the tag and the digest must
be updated. This is recorded evidence, not a reviewer suggestion.

**1.6.A — Automated e2e suite (`src/database/migrations/e2e.test.ts`).**
Runs via `npm run test:migrations:e2e` against a real PostgreSQL connection
from `MIGRATION_E2E_DATABASE_URL`. The suite **fails closed** (throws at
module top-level, non-zero exit, no skip) when the env var is absent — a
skipped e2e suite provides zero proof; a failing one is visible. Each test
resets the `public` schema (`DROP SCHEMA CASCADE` → `CREATE SCHEMA`) for
isolation; tests run with `--test-concurrency=1` because they share the
same database and cannot overlap.

**Dedicated-target safety policy (P0).** Because the suite runs
`DROP SCHEMA public CASCADE`, a mistaken production/shared URL would erase
real data. Three layers prevent this:

1. **Confirmation token.** A second env var `MIGRATION_E2E_CONFIRMATION`
   must equal exactly `DROP <dbname> AT <host>`, where `<dbname>` and
   `<host>` are parsed from `MIGRATION_E2E_DATABASE_URL`. This proves the
   operator knows which database will be wiped.
2. **Production-shaped name refusal.** If the URL's host or database name
   matches `/(^|[._-])(prod|production|primary|main)($|[._-])/i`, the suite
   refuses to run regardless of the confirmation token.
3. **Live identity check.** Before the first DROP, the suite opens a
   connection, queries `current_database()`, and asserts it matches the URL
   path. This catches DNS, pgbouncer, or copy-paste mistakes that route the
   TCP connection somewhere other than the URL's named database.

The suite covers eight scenarios against a real `pg.Client`:

1. **Fresh install** — empty DB → `applyPendingMigrations` 0000→0010 →
   `seedTierFeatureFlags` → `verifyMigration` PASS.
2. **Existing-schema adoption** — pre-shape 0000→0009 SQL directly (no
   ledger) → `performAdoption` dry-run + apply at `MIGRATION_ADOPTION_POINT=0009`
   using `catalog-fingerprint.0009.json` → `applyPendingMigrations` applies
   0010 → `verifyMigration` PASS against the full fingerprint.
3. **Concurrent invocation refusal** — client A holds the advisory lock
   externally (`pg_advisory_lock`) → client B's `applyPendingMigrations`
   is refused with the documented message → A releases.
4. **Interruption/recovery (real partial non-transactional DDL)** — after a
   normal apply of 0000→0010, build a temp history with an extra `0011`
   migration marked `transaction: forbidden` whose SQL is three statements:
   `CREATE TABLE` (succeeds), `INSERT` (succeeds), `SELECT FROM
   nonexistent` (fails). Because the migration is non-transactional, the
   first two statements COMMIT and remain visible after the third throws —
   producing a real partial schema and a ledger row stuck at `applying`.
   The test asserts the probe table exists with the inserted row (proving
   real partial DDL, not a faked ledger state), that resume is refused
   ("interrupted outside a transaction; repair it explicitly"), that
   `getMigrationStatus` reports `interrupted: ['0011']`, then performs the
   documented repair (drop the partial table, delete the interrupted ledger
   row, fix the migration SQL, re-apply) and asserts the ledger reaches
   `applied` and status is healthy.
5. **Checksum drift** — copy history to a temp dir, tamper one migration
   file (add a SQL comment) → `getMigrationStatus` reports `checksumDrift:
   ['0010']` → `applyPendingMigrations` refuses ("checksum mismatch").
6. **Catalog drift** — after apply + seed, `ALTER TABLE organizations ADD
   COLUMN e2e_drift_test text` → `verifyMigration` FAIL with
   `catalogOk: false`.
7. **Safe down migration** — after apply, execute `0010_...down.sql`
   directly via `client.query` → `limit_value` type is `integer` →
   `verifyMigration` FAIL with the ONLY diff being `limit_value` (bigint
   expected vs integer actual; no table/index/other-column drift).
8. **Forward fix** — after the down, delete the 0010 ledger row →
   `applyPendingMigrations` re-applies 0010 → `limit_value` is `bigint` →
   `verifyMigration` PASS.

**Suite cleanup.** Temp dirs created by the interruption and checksum-drift
tests are removed in `finally` blocks. An `after` hook drops the `public`
schema once all tests complete, so the dedicated e2e database is not left
carrying the test schema.

**No `migrate:down` CLI (per decision).** Down migrations are
`manual-only / destructive` by design. The e2e suite executes the down SQL
directly via `client.query`, and the operator runbook documents a guarded
`psql` procedure with an **executable confirmation guard** (a shell `if`
that refuses to invoke `psql` unless `MIGRATION_DOWN_CONFIRMATION` matches
the exact token), plus manifest metadata review and an int4 overflow check
before execution. A generic `migrate:down` CLI is deferred until the manual
procedure has been successfully exercised.

**CI workflow (`.github/workflows/migrations-e2e.yml`).** Has **no
trigger-level `paths:` filter** — triggered on every pull request and push
to main/master, matching `backend-test.yml`. A required status check must
always report; a workflow filtered out by `paths:` never runs, so its check
never appears and a required check waits forever. Path detection is done
inside the `changes` job (plain git diff, no third-party action), and the
`gate` job with `if: always()` is the required check that passes when
migration files are unchanged and fails unless the e2e job genuinely
succeeded when they are changed. Runs the e2e suite against the
digest-pinned `postgres:17.10-trixie` service container with a dedicated
`migration_e2e` database and the matching `MIGRATION_E2E_CONFIRMATION`
token.

**`test:migrations` script change.** The pglite test script was changed
from a glob (`*.test.js`) to an explicit file list
(`runner.test.js adopt.test.js baseline.fingerprint.test.js commands.test.js`)
so the e2e suite's fail-closed top-level throw does not break the pglite
test run when `MIGRATION_E2E_DATABASE_URL` is unset. New pglite test files
must be added to the explicit list (or moved to the e2e suite if they
require real Postgres).

**1.6.B — Operator Neon gate runbook (`docs/migrations-e2e-runbook.md`).**
Documents the procedure an operator follows on real Neon dev branches.
**Two** branches are created: a FRESH branch (schema dropped, for the
empty-DB fresh-install replay) and an ADOPTION branch (production-shaped
schema from `main`, no ledger, for adoption + rollback + old-Worker
checks). The runbook covers: fresh install proof (preflight → apply →
seed → verify → status on the FRESH branch); real schema change with
working rollback (adopt at 0009 → apply 0010 → 0010 down via guarded psql
with the executable confirmation guard → verify fails → forward fix →
verify passes, on the ADOPTION branch); restore-to-new-branch drill via
Neon PITR (record RPO/RTO); old-Worker-against-expanded-schema check
(checkout `OLD_WORKER_SHA`, build, deploy via `wrangler` to a preview URL,
point the Worker at the post-0010 ADOPTION branch via
`NEON_CONNECTION_STRING` — the env var the Worker reads
(`workers/src/utils/db-connection.ts` resolves `NEON_CONNECTION_STRING ||
DATABASE_URL`), smoke-test real endpoints `/health` and
`/api/subscription/current`); teardown; and a structured sign-off section
for operator evidence. Connection strings are not echoed in full
(passwords redacted). **Task 1.6 is not complete until the sign-off
section is filled.**

**1.6.B-execute completion (2026-08-05, SHA `f2255486`, operator jatwell93).**
The operator Neon gate was exercised end-to-end on isolated dev branches of
the production Neon project — all five steps PASS; redacted evidence is
committed under `docs/evidence/2026-08-05-1.6b/` and the runbook sign-off is
filled. Because production had already been cut over to 0011 (task 1.7.B) and
free-tier Neon PITR retention is only 6h, the drill was **adapted** from the
runbook as originally written (each deviation is documented inline in
`docs/migrations-e2e-runbook.md`):

- **Synthetic pre-adoption source.** A branch off `production`'s tip now
  inherits the fully-migrated (post-0011, ledger-present, `bigint`) schema, and
  PITR cannot reach a pre-cutover point. The ADOPTION branch's pre-adoption
  state was therefore reconstructed by replaying `0000→0009` via raw `psql`
  (pure DDL — the `.up.sql` files never write `schema_migrations`; only the
  runner's `ensureLedger` does), yielding an unmanaged 0009-state schema that
  `adopt AT 0009` accepts.
- **Forward-fix deletes 0010 *and* 0011.** `validateLedger` requires the applied
  set to be a contiguous prefix, so deleting only 0010 (with 0011 on top) is
  refused. 0011 is orthogonal and idempotent (`ADD COLUMN IF NOT EXISTS`), so
  both are deleted from the tail and re-applied.
- **LSN restore-in-place for the PITR drill.** This neonctl version cannot
  point-in-time branch a *non-default* branch (`--parent` takes one value; the
  `id@lsn` inline form is unparsed), and second-precision timestamp restores
  were clock-skew-prone. Used `neonctl branches restore <b> ^self@<LSN>` with a
  server-side `pg_current_wal_lsn()` — exact and skew-immune.
- **Lightweight old-Worker compat proof.** The Worker never reads
  `tier_feature_flags.limit_value` (0 matches in `workers/src`), so the 0010
  widening cannot affect Worker code. The real surface — the pre-0011
  `/api/subscription/current` column list — was run against the expanded schema
  via the Worker's real `@neondatabase/serverless` driver (plus an int8 read of
  `limit_value`); both succeeded. A full wrangler preview deploy was judged
  unnecessary (no Worker runtime wiring is changed by 0010/0011).

Runbook bugs found and fixed during execution: DDL role is `neondb_owner` (no
`postgres` role on this project); parent branch is `production` (not `main`);
`migrate:adopt` requires an explicit `-- --dry-run`/`-- --apply` flag; and the
adopt CLI reads `MIGRATION_ADOPT_CONFIRMATION` (no "ION"). The automated e2e
suite (1.6.A) remains the CI gate; its run URL is added to the PR on open.
With 1.6.B-execute signed off, **task 1.6 is complete.**

### Phase 1.7 deployment integration

Task 1.7 integrates the Phase 1 migration runner into the production
deployment workflow. The architecture is a **hybrid gate + dispatch** model:
a reusable `migration-prep.yml` workflow called by `workers-deploy.yml` as a
required prerequisite before the Worker deploy, followed by a delayed canary
job. The parent task stays open until the operator-driven execution
(1.7.B-execute) is signed off.

**Reusable migration-prep workflow (`.github/workflows/migration-prep.yml`).**
A `workflow_call` workflow with two modes, run as **one job with sequential
steps** (not six separate jobs) so the protected environment gate is applied
exactly once, Doppler CLI is installed once, and checkout/compile happen
once on a single checked-out revision:

- **`full` mode (production):** runs six sequential steps — `status`
  (`migrate:status`, read-only ledger check) → `preflight`
  (`migrate:preflight`, read-only readiness) → `pitr-check`
  (`scripts/check-neon-pitr.js`, Neon REST API restore-point verification
  scoped to the target branch) → `apply` (`migrate:apply`, expand-compatible
  schema under advisory lock) → `seed` (`migrate:seed`, idempotent 54-row
  reference data) → `verify` (`migrate:verify`, schema + reference data +
  catalog fingerprint check). Each step uploads its stdout as a CI artifact
  (30-day retention, `if: always()`) for audit. A failure in any step stops
  the sequence and blocks the downstream Worker deploy.
- **`validate` mode (preview/PR):** runs only `status` + `preflight`
  (read-only). PRs that touch migration files are validated without mutating
  the shared dev database. The mutating steps (`pitr-check`, `apply`, `seed`,
  `verify`) are gated by `if: inputs.mode == 'full'`.

The job declares `environment: ${{ inputs.environment }}` so production
secrets are only available when called with `environment: production`.

**`workers-deploy.yml` changes.** The trigger `paths:` filter now includes
`database/migrations/**` and `src/database/migrations/**` so migration-only
changes trigger the workflow. Two reusable-workflow call jobs are added:
`migration-prep-preview` (validate mode, needed by `deploy-development`) and
`migration-prep-production` (full mode, needed by `deploy-production`). A
`canary` job runs after `deploy-production`.

**Concurrency serialization.** All production deploys (push to `main` or
manual `workflow_dispatch` from `main`) share a single fixed concurrency
group (`workers-deploy-production`) with `cancel-in-progress: false`. A
subsequent push or dispatch cannot cancel or overlap an in-flight
apply/seed/verify sequence — it queues behind the running deploy. PR
(preview) deploys keep ref-specific concurrency groups with
`cancel-in-progress: true` so superseded preview runs are cancelled.

**Canary job (CI smoke test + delayed gate).** After the Worker deploys:

1. **Round 1** — the canary job mints a short-lived Clerk session token
   for a dedicated smoke-test identity via `scripts/run-authenticated-smoke.js`
   (create session → mint JWT → probe → revoke in `finally`), then runs
   the authenticated smoke test against the production URL
   (`/health?deep=true` requiring DB readiness pass, plus
   `/api/subscription/current`). Each probe sends
   `Authorization: Bearer <minted-JWT>` because
   `/api/subscription/current` requires authentication via
   `authenticateApiRequest` → `verifyToken` — an unauthenticated request
   would return 401 and the gate would fail spuriously. A 401 is NOT
   treated as success. The JWT is short-lived (~60s) and never stored; a
   fresh session is minted immediately before each round. `CLERK_SECRET_KEY`
   and `SMOKE_USER_ID` are injected by `doppler run` (the canary job
   installs Doppler CLI and runs `doppler run -- node scripts/run-authenticated-smoke.js`).
   The JWT and Clerk secret are never printed. Revocation failure fails
   the canary (security signal) without masking an earlier probe failure.
2. **Wait** — `CANARY_WAIT_MINUTES` (default 15, matching the production
   environment's wait timer).
3. **Round 2** — mint a **new** fresh session token (never carried across
   the wait window), re-run the authenticated smoke test, then check
   Sentry for new fatal/critical issues via the Sentry REST API (queries
   `level:[fatal,critical]` using Sentry's multiple-value OR syntax;
   `fatal` is Sentry's standard highest severity, `critical` is included
   defensively). The Sentry check **fails open** (warns but does not
   block) if `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, or `SENTRY_PROJECT` are
   unset, so a missing Sentry configuration cannot block a deploy.

Canary evidence (both rounds + Sentry output) is uploaded as an artifact.

**PITR readiness — CI gate + operator runbook.** The CI `pitr-check` step
verifies a Neon restore point exists within `PITR_MAX_AGE_HOURS` (default 2)
for the **target branch** via `GET /projects/{project_id}/snapshots`. The
script resolves the target branch by name first (fail closed if not found),
fetches the project-wide snapshot list, filters to only snapshots whose
`branch_id` matches the resolved branch, evaluates only that filtered
collection, and rejects implausible future timestamps (negative age). This
prevents a recent snapshot from a development branch from satisfying the
gate when the production branch's snapshot is stale or absent. The operator
runbook (`docs/migrations-deploy-runbook.md`) documents the heavier
restore-to-new-branch drill (restore, verify schema, run `migrate:verify`
against the restored branch, record RPO/RTO) as a separate operator gate
before the first production migration. Both layers are required: the CI gate
catches a missing/stale backup automatically; the runbook drill proves the
restore actually works and the application is functional against restored
data.

**Credential-level enforcement.** Production deployment credentials
(`DOPPLER_TOKEN`, `CLOUDFLARE_API_TOKEN`, `NEON_API_KEY`,
`SENTRY_AUTH_TOKEN`) are scoped to the protected `production` GitHub
environment, which has branch policy (only `main`), a 15-minute wait timer,
and `can_admins_bypass: false` (verified via GitHub API 2026-07-25).
Preview migration validation uses a separate `MIGRATION_DOPPLER_TOKEN`,
scoped read-only to the minimal migration-validation Doppler config. The
preview `DOPPLER_TOKEN` remains scoped to the development Worker deployment
config; the migration job never receives that broader deployment credential.
`CLERK_SECRET_KEY` and `SMOKE_USER_ID` are stored in Doppler production
config (not GitHub) and injected via `doppler run` in the canary job —
the canary receives the full production Clerk secret key because Clerk
does not offer a suitably restricted Backend API credential for session
minting (investigation confirmed M2M tokens and user API keys are wrong
token types for the existing `verifyToken` path). Blast radius is
controlled by the protected GitHub `production` environment.
`workflow_dispatch` from `main` is the supported manual deployment mechanism.
Direct local `wrangler deploy --env production` requires separately
controlled break-glass access to production credentials — **documentation
alone is not enforcement.** The production GitHub environment is the
enforcement boundary.

**Runtime role separation (Phase 1.7 prerequisite).** The Worker must
not run with the schema owner's credentials. The security objective is
met by **reducing the Worker's privileges**, not by creating a second
highly privileged DDL login. The ownership model is:

- **`neondb_owner`** (the existing schema owner) remains the schema
  owner and becomes the **migration-only** identity. It is the value of
  `MIGRATION_ROLE` and `DATABASE_URL_UNPOOLED` in Doppler production
  config. The runner's `verifyMigrationRole` guard asserts
  `current_user = neondb_owner` for every mutating command.
- **`app_runtime`** (a new SQL-managed login role) is the Worker's
  **restricted runtime identity**. It is the role embedded in
  `NEON_CONNECTION_STRING` (the pooled connection the Worker reads via
  `workers/src/utils/db-connection.ts`). It has DML privileges
  (SELECT/INSERT/UPDATE/DELETE on all `public` tables, USAGE/SELECT/UPDATE
  on sequences, EXECUTE on functions) but **no DDL** (no CREATE on
  schema, no ALTER, no DROP).

`app_runtime` is created via SQL `CREATE ROLE app_runtime LOGIN` — **not**
via Neon's "Add Role" button, which automatically grants `neon_superuser`
(a Neon-managed superuser role that would bypass the privilege
separation). The password is set interactively via psql's `\password`
meta-command so it is never in committed SQL or shell history. The
grants, the explicit `REVOKE ALL PRIVILEGES ON TABLE schema_migrations
FROM app_runtime` (so the runtime role has zero access to the migration
ledger — `GRANT ... ON ALL TABLES` would otherwise grant DML on it), and
`ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner` (so future
migration-created objects automatically grant runtime privileges to
`app_runtime`) are documented in the runbook as a one-time operator
provisioning procedure — they are role administration, not schema DDL,
and do not belong in the migration history.

The provisioning is proven on a temporary `migration-role-check` Neon
branch first: `scripts/verify-runtime-role.js` checks that `app_runtime`
is not a `neon_superuser` member, cannot create tables, does not own any
public table and is not a member of any table's owner role (catalog
proof of non-alterability — PostgreSQL grants ALTER only to the owner or
a member of the owner role; there is no grantable ALTER privilege), can
DML on all `public` tables **except** `schema_migrations`, has **no**
privileges on `schema_migrations` (all seven table privileges denied),
can use sequences (USAGE/SELECT — catalog only, no `nextval`), and can
execute functions. In active-probe mode (`RUNTIME_ROLE_ACTIVE_PROBE=1`,
used on the temporary branch only), it additionally runs a rolled-back
transactional INSERT/UPDATE/DELETE (using a reserved negative ID `id =
-1` so no serial sequence is advanced) and an `ALTER TABLE ... SET
(autovacuum_enabled = true)` attempt that must fail with SQLSTATE 42501
(success or any other SQLSTATE is a failure — this catches the old bug
where an undefined-column error (42703) was misread as "permission
denied"). On main, the verifier runs in read-only mode (no
`RUNTIME_ROLE_ACTIVE_PROBE`) so no write or ALTER attempt is made
against production; the catalog checks are sufficient because the same
grants were already proven with active probes on the branch. The Worker
is then deployed to a preview URL pointed at the branch via the
`app_runtime` pooled URL and smoke-tested against real endpoints. Only
after both pass on the branch is `app_runtime` provisioned on main and
the Worker cut over. The previous Worker connection secret is retained
until the canary passes so the cutover can be rolled back without
re-provisioning. A prior malformed `" migration_runner"` role (leading
space in the name, created via Neon Console) is deleted from main after
confirming it owns no objects — it is unnecessary under this model and
is not recreated.

**Ledger existence probe via `pg_catalog` (hardened 2026-07-28).**
`checkCannotAccessLedger` probes ledger existence via `pg_catalog`
(`pg_class` joined to `pg_namespace`), NOT `information_schema.tables`.
This is a deliberate safety choice: `information_schema.tables` only
lists tables the current role has some privilege on, so once
`REVOKE ALL PRIVILEGES ON TABLE schema_migrations FROM app_runtime` is
applied, `information_schema.tables` HIDES the ledger and a naive
existence check reports `ledgerExists: false` — passing vacuously
without ever verifying that all seven privileges are denied. This is
exactly the false negative observed during the real Neon
`migration-role-check` branch exercise: `runtime-role-evidence.json`
reported `ledgerExists: false` while a direct `pg_class` /
`has_table_privilege` probe (`runtime-ledger-privileges-role-check.txt`)
proved `ledger_exists=t` with all seven privileges denied. `pg_class`
is a system catalog visible to every role regardless of table
privileges, so an existing-but-inaccessible ledger is always detected,
and the seven-privilege denial check is then actually exercised. Three
regression tests cover the inaccessible-ledger detection, the
residual-granted-privilege failure (no vacuous pass), and a structural
guard that the existence query hits `pg_class`/`pg_namespace` and does
NOT hit `information_schema.tables`.

**Post-adoption REVOKE ordering (hardened 2026-07-28).** The
provisioning-time `REVOKE ALL PRIVILEGES ON TABLE schema_migrations FROM
app_runtime` is necessary but not sufficient on its own. Adoption runs
`ensureLedger` (`CREATE TABLE IF NOT EXISTS schema_migrations`) as
`neondb_owner`, and the provisioning step's `ALTER DEFAULT PRIVILEGES
FOR ROLE neondb_owner IN SCHEMA public GRANT ... ON TABLES TO
app_runtime` **auto-grants DML on the ledger the moment adoption creates
it**. A REVOKE applied before the ledger exists does not cover this
auto-grant. Therefore the REVOKE must be re-applied **immediately after
adoption creates the ledger**, and the runtime-role verifier must run
**after** that re-REVOKE. The runbook's
[First-production adoption procedure](../../../docs/migrations-deploy-runbook.md)
documents this ordering (step F: re-REVOKE; step G: verify with the
corrected `pg_catalog`-based verifier, expecting `ledgerExists=true`).
The first-production adoption procedure also documents the observed
`0001_queued_catalogue_imports` schema gap (15 missing `uploads` columns
+ the `uploads_one_active_catalogue_per_org` partial index on the
production-shaped branch), the guarded reconciliation procedure
(read-only dry-run → review → guarded psql apply of the reviewed 0001
SQL → re-dry-run until `STATUS: READY`), and the explicit adopt-at-0009
ordering (stamps `0000`–`0009`, leaves `0010` pending so `migrate:apply`
runs its SQL for real rather than stamping an unapplied migration).

**Worker secret binding on deploy.** `NEON_CONNECTION_STRING` is a
Worker secret (`wrangler.toml:168`, `workers/src/types/env.d.ts:35`),
not a `[env.production.vars]` entry, so `wrangler deploy` does NOT
upload the surrounding-shell env var as a Worker secret binding — it
only registers what is in `wrangler.toml` plus secrets previously
registered via `wrangler secret put`. `doppler run -- npx wrangler
deploy` alone would therefore leave the Worker bound to whatever
`NEON_CONNECTION_STRING` was last `secret put`'d — potentially a stale
pre-cutover `neondb_owner`-as-runtime credential. The production deploy
job in `.github/workflows/workers-deploy.yml` has an explicit
`Bind NEON_CONNECTION_STRING secret to worker` step (analogous to the
existing `FRONTEND_URL` binding step) that re-binds the value from
Doppler via `wrangler secret put` on every production deploy, BEFORE
`wrangler deploy` runs. This means a Doppler update (the `app_runtime`
cutover, or a rollback to the previous credential) takes effect on the
next deploy with no manual `wrangler secret put`. The preview
role-check Worker (a separately-named Worker with its own secret store)
is bound the same way in the runbook. A static regression test,
`scripts/verify-workers-deploy-bindings.test.js` (18 tests), parses the
workflow YAML and asserts the binding step exists and precedes
`wrangler deploy`. It also verifies that the dedicated
`workers/wrangler.toml` `role_check` environment exists, uses the
isolated `date-management-api-role-check` Worker name, exposes only a
workers.dev URL, declares no routes/queues/Hyperdrive/R2/KV/Analytics
bindings, and is used consistently by the runbook (with no nonexistent
`--env preview` references). The suite runs as a pre-deploy CI step in both
`deploy-development` and `deploy-production` so a PR that reorders or
removes the binding step fails CI before any deploy runs.

**Expand-only compatibility.** The runner enforces `compatibility: 'expand'`
at load time (`runner.ts:224` — `Migration ${id} must declare expand
compatibility`). The deploy workflow does not need a separate expand-guard:
the runner itself refuses to load any non-expand migration, so
`migrate:apply` can only apply expand-compatible schema. A contract
migration (which would break old Workers) cannot reach production through
this workflow; it requires the expand/migrate/contract workflow in task 1.8.

**No `migrate:down` in CI.** Per the Phase 1 design, down migrations are
`manual-only / destructive`. The deploy workflow does NOT include an
automatic down. Rollback is three-layer: (1) Worker rollback
(`git revert` + redeploy — safe because expand migrations are
backward-compatible with old code), (2) forward fix (new migration that
corrects the problem), (3) Neon PITR restore (catastrophic only). The
runbook documents all three with explicit warnings against defaulting to
destructive down migrations.

**New scripts.**

- `scripts/check-neon-pitr.js` — calls the Neon REST API to verify a restore
  point exists within the threshold for the target branch. Resolves the
  branch first (fail closed), filters snapshots by `branch_id`, rejects
  future timestamps. Exits non-zero if not. Output is JSON evidence.
  23 unit tests (mocked fetch), including cross-branch and future-timestamp
  scenarios.
- `scripts/post-deploy-smoke.js` — probes a configurable list of endpoints
  against a deployed Worker URL with latency budgets. Requires
  `/health?deep=true` to report DB readiness pass. Sends
  `Authorization: Bearer <authToken>` when configured so the
  authenticated `/api/subscription/current` endpoint is exercised (a 401
  is NOT treated as success). Exits non-zero on failure. 21 unit tests
  (mocked fetch), including auth-header attachment and 401-failure tests.
  Called in-process by `run-authenticated-smoke.js` — not invoked directly
  by the canary job.
- `scripts/run-authenticated-smoke.js` — orchestrates the authenticated
  canary: creates a Clerk session for `SMOKE_USER_ID`, mints a short-lived
  JWT, invokes `post-deploy-smoke.js`'s `main()` in-process with the JWT
  passed as the `SMOKE_AUTH_TOKEN` env var (an in-process handoff only —
  this is **not** the retired static GitHub secret of the same name; the
  JWT is never stored or logged), and revokes the session in a `finally`
  block.
  The JWT and `CLERK_SECRET_KEY` are never printed. Emits sanitized
  evidence (session ID, user ID, timestamps, probe results, revocation
  result). Fails closed if minting or revocation fails; revocation
  failure fails the canary (security signal) without masking an earlier
  probe failure. 17 unit tests (mocked Clerk fetch + fake smoke main),
  covering successful flow, probe failure still revokes, mint failure
  cleanup, revoke failure reported, no secret/JWT in output, fresh
  session per round.
- `scripts/neon-poll-operations.js` — polls Neon restore operation IDs to
  a terminal state after a `POST .../snapshots/{id}/restore` call. Reads
  the restore response JSON on stdin, extracts the operation IDs itself
  (failing closed if there are none), and polls
  `GET /api/v2/projects/{project_id}/operations/{op_id}` with a bounded
  deadline (default 15 min, configurable via `NEON_POLL_DEADLINE_MINUTES`)
  and a per-request `AbortSignal` timeout (default 30 s, configurable via
  `NEON_POLL_PER_REQUEST_TIMEOUT_MS`) so an unknown status or a stalled
  HTTP connection cannot hang forever. The per-request timeout is the
  smaller of the remaining overall deadline and the configured per-request
  cap. Replaces a Bash `while read` loop that ran in a subshell and could
  continue past a failed operation (the `exit 1` exited only the
  subshell). Used by the runbook PITR drill (Step 1b) and the
  catastrophic rollback (Step 4c). 29 unit tests (mocked fetch),
  including success/failed/deadline outcomes, empty-ID fail-closed,
  non-2xx abort, fetch-throw retry, per-request AbortSignal timeout
  (stalled fetch only rejects on signal abort), and a subshell-bug
  regression guard.
- `scripts/verify-runtime-role.js` — verifies that the restricted
  `app_runtime` role (the Worker's runtime identity) has exactly the
  privileges it needs and nothing more. Two modes: **read-only**
  (default, for main) runs only catalog-level checks; **active-probe**
  (`RUNTIME_ROLE_ACTIVE_PROBE=1`, for the temporary branch) additionally
  runs a rolled-back write probe and an ALTER-denial probe. Connects via
  `pg` using the `RUNTIME_ROLE_URL` connection string and checks:
  `app_runtime` is not a `neon_superuser` member (`pg_has_role`); it
  cannot create tables (no CREATE on schema via
  `has_schema_privilege`); it does not own any public table and is not a
  member of any table's owner role (catalog proof via `pg_class` +
  `pg_roles` + `pg_has_role` — PostgreSQL grants ALTER only to the owner
  or a member of the owner role, so non-ownership IS non-alterability);
  [active only] it cannot alter an existing table (`ALTER TABLE ... SET
  (autovacuum_enabled = true)` in a rolled-back transaction must fail
  with SQLSTATE 42501; success or any other SQLSTATE is a failure);
  it can SELECT/INSERT/UPDATE/DELETE on all `public` tables **except**
  `schema_migrations` (`has_table_privilege`); it has **no** privileges
  on `schema_migrations` (all seven table privileges denied —
  `has_table_privilege` for each, all must return false; passes
  vacuously if the ledger does not exist yet); it can use sequences
  (`has_sequence_privilege` for USAGE/SELECT — catalog only, no
  `nextval`); it can execute all `public` functions
  (`has_function_privilege`); [active only] it can actually write
  (transactional INSERT/UPDATE/DELETE against `tier_feature_flags` with
  an explicit `id = -1` so no serial sequence is advanced, then
  ROLLBACK). The `nextval` probe was removed: `nextval` is
  non-transactional and permanently advances the sequence, which is an
  unacceptable mutation against production. Output is JSON evidence with
  the password redacted (host + database only), including in nested
  probe error messages. Used by the runbook's runtime role provisioning
  procedure (active-probe mode on a `migration-role-check` branch first,
  read-only mode on main). 68 unit tests (mocked `pg` Client), covering
  each check's success/failure path, ledger-access denial, undefined-
  column false-success regression (42703 must fail, not pass), sequence
  non-use (write probe uses `id = -1`, no `nextval`), identifier
  quoting, nested-error redaction, active-probe gating, password
  redaction in errors, `client.end()` on failure, and `RUNTIME_ROLE_NAME`
  override.

**New secrets and variables.** `NEON_API_KEY` (environment secret,
production) for the PITR check; `SENTRY_AUTH_TOKEN` (environment secret,
production, optional) for the canary Sentry check; `SENTRY_ORG`,
`SENTRY_PROJECT`, `CANARY_WAIT_MINUTES` (environment variables,
production) in GitHub. `CLERK_SECRET_KEY` and `SMOKE_USER_ID` in Doppler
production config for the canary orchestrator's session minting. These
are documented in the runbook's secrets reference section.

**Outstanding evidence from this session.** The CI workflow, scripts, and
runbook are complete and verified locally (compile clean, 183 script tests
pass — 97 existing + 68 from `verify-runtime-role` + 18 from
`verify-workers-deploy-bindings`, lint clean, OpenSpec valid).
The first real production deploy with this workflow (1.7.B-execute) is
deferred to the operator. New GitHub environment secrets and variables
must be configured before the first run, and the runtime role separation
(`app_runtime` provisioning) must be completed as a Phase 1.7
prerequisite.

## What already exists

- Worker raw-SQL execution and PGlite conformance tests; reuse them, but initialize PGlite from the
  authoritative migrations instead of maintaining its embedded schema as another source of truth.
- A Neon-shaped Vitest configuration; reuse its coverage, not its tracked-schema mutation,
  skip-on-failure, shared-target, or `db push --accept-data-loss` behaviours.
- Worker CORS, rate limiting, auth, error shaping, Sentry, health, queue handling, and production
  deployment; audit their contracts against Express rather than rebuilding them.
- Prisma production schema, Neon SQL deltas, migration scripts, seed/verification commands, and Neon
  recovery documentation; use these to construct the baseline/adoption contract.

## Failure modes that gate implementation

| Flow                | Realistic failure                                           | Required protection                                              |
| ------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| PostgreSQL tests    | Shared/production URL receives destructive reset            | Explicit target identity, per-run namespace, fatal preflight     |
| Test cleanup        | Reset fails and dirty data reaches tests                    | Drop/recreate isolated namespace; cleanup failure exits non-zero |
| Migration adoption  | Existing object has same name but different definition      | Catalog fingerprint; explicit `adopt --dry-run`; refuse mismatch |
| Migration execution | Two deploys race or a non-transactional step is interrupted | Advisory lock, timeout, ledger state, documented resume/repair   |
| Worker deploy       | Code requiring a column deploys before schema               | Expand-first workflow gate and database-backed smoke test        |
| Scheduled job       | Cron retry performs duplicate billing/email/write           | Idempotency key/claim, overlap prevention, retry and alert tests |
| Stripe webhook      | Duplicate/replayed event applies side effects twice         | Raw-byte signature verification and durable event idempotency    |
| Backend deletion    | Undocumented capability disappears                          | Capability, consumer, test, docs and config manifests            |

## Test coverage map

```
POSTGRESQL TEST PATH
config -> target-identity guard -> isolated namespace -> baseline/reset -> seed -> tests -> teardown
           | reject prod/shared      | fatal on failure   | drift check   | coverage unchanged

MIGRATION PATH
files -> naming/checksum -> advisory lock -> preconditions -> apply -> ledger -> postconditions
          | mismatch fail    | race test       | drift fail    | interruption/recovery test

CAPABILITY CUTOVER
mounted Express route/job -> consumer/security contract -> Worker implementation -> contract test
                                                           -> local browser/E2E -> monitored cutover

DELETION GATE
route + test + job + script + middleware + docs + config manifests
  -> every row replaced or explicitly retired
  -> Worker/database required gates green
  -> delete backend
```

Required integration/E2E coverage includes a fresh database replay, existing-schema adoption,
concurrent migration refusal, interrupted non-transactional recovery, frontend-to-local-Worker CORS
and active subscription/storage/upload flows, Stripe signature/replay handling, scheduled-job retry
idempotency, database-backed health, and rollback/restore drills.

## Parallelization strategy

| Lane | Work                                                                   | Depends on |
| ---- | ---------------------------------------------------------------------- | ---------- |
| A    | Migration baseline, adoption, runner, deployment integration (Phase 1) | Phase 0    |
| B    | Mounted route/consumer/security and test manifests (Phase 2)           | Phase 0    |
| C    | Scheduled actions, scripts, docs/config inventory (Phase 2)            | Phase 0    |
| D    | Worker parity + Worker-shaped tests + cutovers (Phase 3)               | A, B, C    |
| E    | Delete Express + Prisma + SQLite together (Phase 4)                    | A–D        |

Lanes A–C can run in parallel read-only/design worktrees because they produce disjoint inventories —
this is why the migration foundation (A) and the audit (B, C) are concurrent, not strictly sequential.
There is no separate "database conversion" lane: Express stays on SQLite, so the only DB work is the
authoritative Postgres migration foundation in Lane A. Lane D is integration work; split it only by
disjoint capability groups and merge through the shared route/test manifests to avoid losing contracts.
Lane E is the single controlled deletion, gated on A–D.

## Risks and mitigations

- **Express-only endpoint gaps.** Some routes may exist only in Express. Mitigation: the Phase 2
  responsibility audit enumerates them before any deletion; Express is not removed until each has a
  tested Worker equivalent.
- **Silent loss of non-route capabilities.** `backend/` also owns scheduled jobs and operational
  scripts. Mitigation: the Phase 2 audit inventories jobs and scripts alongside routes, and the
  deletion invariant forbids removing anything not on the rehoming checklist with a replacement or a
  recorded retirement.
- **No production migration path after Prisma.** `migrate:prod` is Prisma-based and backend-owned.
  Mitigation: Phase 3 stands up and proves a Prisma-independent Neon runner (forward + rollback) before
  Phase 4 deletes anything.
- **Test coverage regression.** The backend Vitest suite runs on SQLite today and provides named gates
  (tenant isolation, penetration, concurrency, feature limits, authorization precedence, webhook
  security). Mitigation: it keeps running **untouched on SQLite** as the reference until deletion; its
  coverage is reproduced **once**, Worker-shaped, on pglite/Neon in Phase 3.2 and must be green before
  Phase 4 deletes anything. There is no Express-shaped Postgres detour — the coverage is written against
  the Worker model directly, so it is written exactly once, not ported then rewritten.
- **pglite/prod driver divergence for dev.** pglite is not the `@neondatabase/serverless` driver.
  Mitigation: use a Neon dev branch for behaviours pglite cannot model; keep pglite for fast tests.
- **Losing the working dev backend during the transition.** Mitigation: the direct path never touches
  Express or SQLite until the final deletion, so the fallback is always live. Do all Worker parity and
  migration-foundation work on a branch; the rollback is `git revert`/checkout of that branch, which
  restores the SQLite-backed Express backend with **no re-plumbing** (its schema, runtime migration
  runner, and tests were never modified). Tag the last Express+SQLite-capable revision (task 4.3) before
  deletion.

## Alternatives considered

- **Do nothing (status quo).** Keep the triplication; rely on shared-domain + conformance to contain
  risk. Reasonable while schema-change friction is not actually costing time — this is the default until
  the Decision Gate trigger is met.
- **Staged engine-swap (Knob A → Knob B).** First migrate the Express dev/test/CI stack SQLite→Postgres
  for a "one engine, two backends" rollback point, then retire Express. **Rejected** — the Postgres
  Express test suite would be rewritten against the Worker model and the Postgres backend CI retired, so
  most of the intermediate work is throwaway; and the rollback point only guards the already-safe
  dialect change while leaving the risky Worker-parity and migration-runner work unguarded. See "Why
  direct retirement" above.
- **Unify on Postgres but keep Express permanently.** A legitimate stopping point _only if_ Express is
  meant to remain a second backend indefinitely. It is not — the destination is deletion — so the
  engine-swap is pure transitional cost with no lasting payoff.
- **Full rewrite / ORM on Worker.** Rejected — reintroduces the bundle-size and native-binding problems
  that Task 8.3 avoided, for no parity benefit.
