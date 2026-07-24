# Design Notes: Retire Express / unify on Postgres

## Context

This change reverses a decision made deliberately in `use-cloudflare-r2-and-a-serverless-database`.
That change chose a **dual-environment strategy** (Express+SQLite for dev, Worker+Neon+R2 for prod)
and, per its Task 8.3, hand-wrote edge-native Worker handlers rather than importing Express routes,
because `better-sqlite3` (native bindings) and the Prisma query engine cannot run in the Workers
runtime. The `express-adapter.ts` "reuse 100% of the backend" plan described in `workers/README.md`
did not pan out for the real handlers; `shared/domain/*` is the salvage — the team shares the *logic*
even though it could not share the *plumbing*.

The consequence, codified in `openspec/project.md` golden rules 5 and 6, is that every schema change is
triplicated (Prisma base + Neon SQL + runtime SQLite migration) and every dual-implemented query needs
a pglite-vs-SQLite conformance test. That is safe but mechanically expensive.

## Why two knobs, sequenced

Splitting the work de-risks it and keeps each step independently shippable:

- **Knob A (unify DB on Postgres)** removes the *dialect* duplication (SQLite vs Postgres) and two
  artifacts, while leaving Express in place. If Knob B is never done, Knob A still simplifies the schema
  story and makes dev/test behave like prod.
- **Knob B (retire Express)** removes the *second backend* and Prisma entirely. It depends on Knob A
  being done first, because running the Worker as the dev API implies a Postgres-shaped dev database —
  doing Knob B on top of SQLite would be incoherent. Knob B also depends on the replacement migration
  runner and the rehoming of jobs/scripts (below) landing before any deletion.

Sequencing A→B leaves a stable rollback point in between ("one engine, two backends").

## Local database options (the "slow PC" question)

The original worry was that adding a Postgres + Workers runtime locally would bog down an already-slow
machine. The workerd runtime under `wrangler dev` is comparable to the current `ts-node` Express
process, so the deciding factor is the database:

- **pglite (preferred).** In-process WASM Postgres, already a dependency in the pglite conformance
  harness. No server process, negligible idle weight, real Postgres SQL semantics. Best fit for a slow
  PC and for tests. Open question: how faithfully pglite covers the Worker's runtime driver behaviour
  (extensions, `pg`-specific features) for *dev* use, not just conformance tests.
- **Neon dev branch.** Zero local weight, exercises the exact production engine and driver, gives Git-
  like branching for safe schema experiments. Costs: needs internet, adds query latency, consumes Neon
  free-tier compute (autosuspends when idle).
- **Native Postgres install.** Faithful and offline, but a persistent ~50–100MB idle daemon on the dev
  box.
- **Docker Postgres — rejected.** Docker Desktop on Windows is a constant RAM/CPU tax and the worst
  option on a slow machine. Explicitly not recommended.

Likely landing spot, **split by backend because the two use different DB access styles**:

- **Workers tests → pglite.** The Worker uses hand-written SQL via `@neondatabase/serverless`, and the
  existing pglite conformance harness (`workers/src/__tests__/pglite-db.ts`) already runs that SQL
  against in-process WASM Postgres. No new deps, no internet, fast. This is the clean fit.
- **Backend tests → Neon dev branch** (Prisma is the constraint). The backend uses Prisma, and Prisma
  only supports pglite through a **community-maintained** driver adapter (per Prisma's docs: community
  adapters exist for PGlite) — not an official adapter. Adopting it would add a supply-chain risk and a
  new dep for no parity benefit, so the backend test path uses the **existing** Neon/Postgres Vitest
  config (`vitest.config.neon.ts` + `test-setup-neon.js`) promoted to default, run against a Neon dev
  branch via Prisma's official `pg` adapter. This requires `NEON_CONNECTION_STRING` (Doppler) to run
  backend tests and needs internet, but it is the lowest-risk path and exercises the real production
  engine. Native Postgres remains an offline fallback.

So "pglite for tests" in the proposal applies to the workers; the backend's test DB is Neon. This split
is a consequence of the backend being Prisma-bound and the Worker being raw-SQL — it collapses only
when the backend is removed in Knob B.

## What survives

- `shared/domain/*` stays — it is the single source of truth for cross-cutting business values and
  its raw-SQL-vs-TS conformance tests remain worthwhile even with one backend (they prove the Worker's
  hand-written SQL matches the shared TypeScript rules).
- The Worker keeps hand-written SQL via `@neondatabase/serverless`; this change does not introduce an
  ORM on the Worker.
- Production is untouched throughout — it already runs solely on the Worker.

## What retires

- `backend/` Express server, its Prisma client, and `better-sqlite3` (end of Knob B).
- Prisma base (SQLite) schema and the runtime `src/migrations/` SQLite path (Knob A). The runtime
  path is **code, not just SQL**: `backend/src/migrations/{migrate.ts,migration.service.ts,
  migration.model.ts}` plus the numbered `*-*.migration.ts` files constitute a hand-rolled SQLite
  migration runner that is removed alongside the schema.
- `workers/src/index.ts` and `workers/src/express-adapter.ts` — the abandoned "reuse 100% of the
  backend via the express-adapter" approach (described in `workers/README.md`) that did not pan out
  because `better-sqlite3` and the Prisma engine cannot run in the Workers runtime. `index-minimal.ts`
  is the real entry point; the adapter pair is deleted in Knob B.
- The SQLite side of the conformance tests; conformance becomes "raw SQL vs shared TS on Postgres"
  rather than "Postgres vs SQLite". The conformance tests already live in `workers/src/__tests__/`
  (`database.conformance.node.test.ts`, `database.credit-claim.conformance.node.test.ts`,
  `database.supplier-policy.conformance.node.test.ts`, etc.), so dropping the SQLite arm is a
  workers-side edit — there is no backend-owned conformance suite to migrate.
- The Prisma-based production migration mechanism (`npm run migrate:prod` /
  `scripts/migrate-production-doppler.js`), **replaced first** by a Prisma-independent Neon migration
  runner (see below) — never deleted without a successor. Note there are **several** backend-owned
  migration scripts, not one: `migrate-production-doppler.js`, `migrate-production-simple.js`,
  `migrate-production.ts`, `migrate.js`, `verify-migration.js`, and `list-migrations.ts`. Each is
  inventoried in Phase 2 task 2.5 and either replaced by the new runner or explicitly retired.
- Golden rules 5 and 6 in their current dual-backend form.

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

- **Promote `backend/prisma/neon-sql/*.sql`** from Prisma-mirroring review/operator SQL to the single
  authoritative, executable migration set.
- **Run it with a lightweight runner** (`node-pg-migrate`, `dbmate`, or a small first-party script) that
  supports forward migration and rollback, invoked under Doppler from outside `backend/` (workers
  workspace or repo root).
- **Prove it on a real schema change against a Neon dev branch, including rollback**, before Prisma is
  removed. This is the successor to `migrate:prod` and becomes the "one authoritative path" named in the
  rewritten golden rule 6.

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
- **Test coverage regression.** The backend Vitest suite runs on SQLite today. Mitigation: in Knob A,
  point the existing Express-shaped tests at a Postgres-backed path (pglite/Neon branch) and require
  green — the tests stay Express-shaped (`supertest`, Express `req`/`res`) but hit Postgres instead of
  SQLite. In Knob B, those tests are **rewritten** against the Worker's `Request`/`Response` model
  (not "ported" — the Express constructs do not exist on the Worker), so the effort is larger than a
  dialect swap. Phase 1.2 and 4.2 reflect this distinction.
- **pglite/prod driver divergence for dev.** pglite is not the `@neondatabase/serverless` driver.
  Mitigation: use a Neon dev branch for behaviours pglite cannot model; keep pglite for fast tests.
- **Loss of the SQLite rollback path.** Mitigation: sequence A before B; keep the change reversible by
  landing Knob A independently and stabilising before Knob B.
- **Knob A itself needs a rollback.** If the Postgres-backed dev/test path (pglite + Neon dev branch)
  proves unworkable after Knob A lands — e.g. pglite cannot model a runtime behaviour the suite depends
  on, or the Neon dev branch is too slow/flaky for local dev — the SQLite path must be recoverable.
  Mitigation: land Knob A on its own branch and keep the SQLite Prisma base schema + runtime migration
  runner on `main` (or a tagged rollback branch) until Phase 1.7 (full CI green on single-engine) is
  satisfied. Do not delete the SQLite artifacts from git history; the rollback is `git revert` of the
  Knob A commit plus restoring the SQLite dev config. Only after 1.7 stabilises is the SQLite path
  considered gone.

## Alternatives considered

- **Do nothing (status quo).** Keep the triplication; rely on shared-domain + conformance to contain
  risk. Reasonable while schema-change friction is not actually costing time — this is the default until
  the Decision Gate trigger is met.
- **Knob A only.** Unify on Postgres but keep Express. Removes the dialect duplication and two
  artifacts with much less work than a full Express retirement; a legitimate stopping point.
- **Full rewrite / ORM on Worker.** Rejected — reintroduces the bundle-size and native-binding problems
  that Task 8.3 avoided, for no parity benefit.
