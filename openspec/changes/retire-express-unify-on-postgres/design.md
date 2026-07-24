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
