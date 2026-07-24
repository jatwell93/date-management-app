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
- **It de-risks the wrong half.** The intermediate rollback point protects a SQLite→Postgres *dialect*
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
  (extensions, `pg`-specific features) for *dev* use, not just conformance tests.
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
  and driver; pglite is the offline fallback for behaviours that do not need the real driver.
- **Migration-runner CI → ephemeral Postgres / per-run Neon branch.** The Phase 1 runner is proven
  against isolated targets with no production secrets.

The Worker-shaped test coverage written in Phase 3.2 must, from the start, satisfy the isolation and
fail-closed properties the staged draft was going to retrofit onto the Neon harness:

- initialize schema from the authoritative Phase 1 migrations/baseline, not an embedded `SCHEMA_SQL`;
- fail closed when PostgreSQL setup or credentials are missing (never skip);
- give every local/CI run an isolated database or schema namespace and clean it up even on failure;
- never point destructive test setup at a shared development or production database (explicit per-run
  target identity + allow token);
- preserve coverage thresholds; and
- keep pull-request CI runnable without exposing production credentials (ephemeral CI PostgreSQL service
  or a per-run Neon branch with equivalent isolation).

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

- **Relocate and promote `backend/prisma/neon-sql/*.sql`** from Prisma-mirroring review/operator SQL
  into a permanent path outside `backend/`; that relocated history becomes the single authoritative,
  executable migration set and survives deletion of the backend workspace.
- **Run it with a lightweight runner** (`node-pg-migrate`, `dbmate`, or a small first-party script) that
  supports forward migration and rollback, invoked under Doppler from outside `backend/` (workers
  workspace or repo root).
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

| Flow | Realistic failure | Required protection |
|---|---|---|
| PostgreSQL tests | Shared/production URL receives destructive reset | Explicit target identity, per-run namespace, fatal preflight |
| Test cleanup | Reset fails and dirty data reaches tests | Drop/recreate isolated namespace; cleanup failure exits non-zero |
| Migration adoption | Existing object has same name but different definition | Catalog fingerprint; explicit `adopt --dry-run`; refuse mismatch |
| Migration execution | Two deploys race or a non-transactional step is interrupted | Advisory lock, timeout, ledger state, documented resume/repair |
| Worker deploy | Code requiring a column deploys before schema | Expand-first workflow gate and database-backed smoke test |
| Scheduled job | Cron retry performs duplicate billing/email/write | Idempotency key/claim, overlap prevention, retry and alert tests |
| Stripe webhook | Duplicate/replayed event applies side effects twice | Raw-byte signature verification and durable event idempotency |
| Backend deletion | Undocumented capability disappears | Capability, consumer, test, docs and config manifests |

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

| Lane | Work | Depends on |
|---|---|---|
| A | Migration baseline, adoption, runner, deployment integration (Phase 1) | Phase 0 |
| B | Mounted route/consumer/security and test manifests (Phase 2) | Phase 0 |
| C | Scheduled actions, scripts, docs/config inventory (Phase 2) | Phase 0 |
| D | Worker parity + Worker-shaped tests + cutovers (Phase 3) | A, B, C |
| E | Delete Express + Prisma + SQLite together (Phase 4) | A–D |

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
- **Unify on Postgres but keep Express permanently.** A legitimate stopping point *only if* Express is
  meant to remain a second backend indefinitely. It is not — the destination is deletion — so the
  engine-swap is pure transitional cost with no lasting payoff.
- **Full rewrite / ORM on Worker.** Rejected — reintroduces the bundle-size and native-binding problems
  that Task 8.3 avoided, for no parity benefit.
