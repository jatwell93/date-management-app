# Proposal: Retire the Express/SQLite dev backend and unify on Postgres

> **Status: DRAFT / not yet approved.** This is a decision-capture proposal, not scheduled work.
> It exists so the "collapse the duplication" idea is tracked with its real tradeoffs instead of
> living in a chat thread. Nothing here is implemented. See **Decision Gate** below.

## Why

The `use-cloudflare-r2-and-a-serverless-database` change deliberately kept **two backends**:

- `backend/` — Express + Prisma, SQLite in dev/test, Postgres schema for prod reference.
- `workers/` — Cloudflare Worker, hand-written raw SQL via `@neondatabase/serverless`.

Production runs **only** on the Worker (`api.expirymate.com.au`). Express is now a dev/test and
reference implementation. This split is intentional (Task 8.3 of that change: importing the Express
routes pulls `better-sqlite3` native bindings and the Prisma query engine, neither of which run in the
Workers runtime), and the `shared/domain/*` modules plus pglite conformance tests keep the two from
drifting on business logic.

The cost of that split is **schema and query triplication**, codified as golden rules 5 and 6 in
`openspec/project.md`. Adding one column to `Supplier` in `enhance-supplier-policy-capture` required
edits across **five to seven** artifacts:

| # | Artifact | Path |
|---|---|---|
| 1 | Prisma base schema (SQLite/dev) | `backend/prisma/schema.prisma` |
| 2 | Prisma production schema (Postgres) | `backend/prisma/production/schema.prisma` |
| 3 | Neon SQL migration + rollback | `backend/prisma/neon-sql/0007_*.sql` (×2) |
| 4 | Runtime SQLite migration | `backend/src/migrations/*` (`017-*`) |
| 5 | pglite test harness | `workers/src/__tests__/pglite-db.ts` |
| 6 | Worker raw-SQL column lists | `workers/src/database.ts` |
| 7 | Shared domain types | `shared/domain/*` |

The *risky* half of this — business logic drift — is already contained by the shared module and
conformance tests. The remaining cost is **mechanical duplication paid on every schema change**: more
files to touch, two dialects to reason about (SQLite vs Postgres), and a second full backend to keep
compiling and tested.

This proposal captures the option to remove that cost by retiring Express and running the Worker
locally against Postgres so there is **one backend and one database engine** everywhere.

## What changes

Two independently valuable knobs. Either can ship without the other; together they collapse the 5–7
per-schema-change artifacts to ~2–3.

### Knob A — Unify the dev/test database on Postgres (drop SQLite)

- Replace the SQLite dev/test path with Postgres so dev, test, and prod share one dialect.
- Retire the Prisma **base** (SQLite) schema and the runtime `src/migrations/` SQLite path.
- Local/test Postgres is provided by **pglite** (already a dependency, used by the conformance
  harness) or a **Neon dev branch** — never a heavyweight local Postgres server.
- Removes artifacts **#1 and #4**, and the entire SQLite-vs-Postgres dialect surface, without touching
  Express yet.

### Knob B — Retire the Express backend

- Run the Cloudflare Worker locally via `wrangler dev` (workerd/Miniflare) as the single dev API.
- Migrate the Express-only endpoints and any Express-only test coverage onto the Worker.
- **Rehome the non-route responsibilities that also live in `backend/`** before deletion: the six
  scheduled jobs in `backend/src/jobs/` (credit-claim, daily-metrics, daily-report-email, dunning,
  stripe-sync, trial-expiration) move to Cloudflare **Cron Triggers/Queues**, and the operational
  scripts in `backend/scripts/` (seeds, org-id audits/backfills, Neon export, webhook diagnostics,
  backup) are relocated, reimplemented, or explicitly retired.
- **Replace the authoritative production migration mechanism first.** Today production migrations run
  via `npm run migrate:prod` (`scripts/migrate-production-doppler.js`, Prisma `db push`) — a
  backend-owned script. Removing Prisma removes it, so a Prisma-independent, executable Neon migration
  runner (forward + rollback) is stood up **before** deletion and the Neon SQL migrations are promoted
  from Prisma-mirroring review SQL to the single authoritative path.
- Remove `backend/` (Express server, Prisma client, `better-sqlite3`) and the Prisma **production**
  schema only once parity, jobs, scripts, tests, and the migration runner are all confirmed. End state
  per schema change: authoritative Neon SQL migration + Worker raw SQL + shared domain (**~2–3
  artifacts**, down from 5–7).

## Local development after this change

The concern that motivated this — added local runtime weight on an already-slow PC — is **avoidable**.
`wrangler dev` (workerd) is comparable in weight to the current `ts-node` Express process; the real
question is where Postgres comes from:

| Local DB option | Weight on a slow PC | Verdict |
|---|---|---|
| Docker Postgres | Heavy — Docker Desktop is a constant RAM/CPU tax | ❌ Avoid |
| Native Postgres install | Moderate (~50–100MB idle) | 🟡 Acceptable |
| Neon dev branch (cloud) | ~Zero local weight; needs internet + latency | 🟢 Good |
| pglite (in-process WASM Postgres) | Very light; no server; already used for worker tests | 🟢 Preferred |

The migration does **not** require running heavyweight Postgres locally, so it does not add meaningful
weight to the dev machine.

## Scope

- **In scope:** the two knobs above; updating the dual-backend parity conventions (golden rules 5 & 6)
  to their single-backend form; a local-dev-on-Postgres story that avoids Docker; migrating Express-only
  route + test coverage onto the Worker; rehoming the backend's scheduled jobs and operational scripts;
  and standing up a Prisma-independent authoritative production migration path before Prisma is removed.
- **In scope (docs/spec only for now):** this proposal, its design notes, task breakdown, and the
  `dual-backend-parity` spec delta. No source changes land under this change until the Decision Gate
  clears.

## Non-goals

- **Not** changing production behaviour, endpoints, auth, R2, Neon, or Hyperdrive — production already
  runs solely on the Worker and is unaffected.
- **Not** removing the `shared/domain/*` modules — they remain the single source of truth and their
  raw-SQL-vs-TS conformance tests remain valuable even with one backend.
- **Not** switching ORM/query style for the Worker — it keeps hand-written SQL.
- **Not** a rewrite of business logic — this is an infrastructure/dev-experience consolidation.

## Decision Gate

Before any source change under this proposal, confirm all of:

1. **Trigger (measurable):** at least one of the two most recent schema changes touched **5+ of the
   5–7 triplication artifacts** AND required **>30 minutes of mechanical sync** across them (not
   business logic). The signal is the artifact count + sync time on real merged work, not a feeling
   of untidiness. If neither recent change clears that bar, this stays parked — the shared-domain
   discipline already contains the dangerous part of the duplication, so completing it is cleanup,
   not risk reduction.
2. **Worker parity coverage:** every Express-only endpoint has (or will get) an equivalent Worker
   handler and test before Express is deleted. The **known Express-only endpoints today** (pre-audit,
   see "Known Express-only surface" below) must each be on the Phase 2 rehoming checklist with a
   target before deletion.
3. **Test story on Postgres:** the backend/service test suite that runs on SQLite today has a
   Postgres-backed equivalent (pglite or Neon branch) that is green.
4. **Sequencing:** Knob A ships and stabilises before Knob B, so a rollback point exists between "one
   database engine" and "one backend".
5. **Migration path replaced first:** a Prisma-independent, executable Neon migration runner (forward +
   rollback) is proven **before** Prisma/`backend/` is removed — `npm run migrate:prod` must not be
   deleted without a working successor.
6. **Non-route responsibilities rehomed:** the six scheduled jobs and the operational scripts in
   `backend/` each have a Worker/relocated home or a recorded retirement decision before deletion.

### Decision Gate outcome

- **Status:** ✅ **Cleared — go.** Recorded on 2026-07-24. The trigger (criterion 1) is met by the
  `enhance-supplier-policy-capture` change, which touched 5–7 artifacts per column add. Knob A
  source work may proceed; Knob B remains gated on Phases 2–3 per the sequencing rule.

### Known Express-only surface (pre-audit, to be confirmed in Phase 2)

Routes in `backend/src/routes/*` with **no equivalent** in `workers/src/index-minimal.ts` today:

| Route file | Routes | Worker status |
|---|---|---|
| `webhook.routes.ts` | `POST /api/webhooks/stripe` | ❌ Missing — Worker handles Clerk webhooks only. **Stripe webhook inbound handler is a Knob B blocker.** |
| `organization-invite.routes.ts` | 6 (create/accept/list/delete/revoke/bulk-delete) | ❌ Missing |
| `storage-quota.routes.ts` | `GET /:userId`, `GET /:userId/can-upload` | ❌ Missing |
| `admin.metrics.routes.ts` | admin metrics | ❌ Missing |
| `database.backup.routes.ts` | backup trigger | ❌ Missing |
| `subscription.routes.ts` | cancel, portal, checkout, webhook-handler (4 of 6) | 🟡 Partial — Worker has `current` + `trial-status` only |

This list is a starting point for Phase 2 task 2.1, not its conclusion — the audit re-derives it from
source at deletion time.

## Impact

- **`openspec/project.md` golden rules 5 & 6** — rewritten for a single backend / single migration path
  once Knob B lands (captured as MODIFIED requirements in the `dual-backend-parity` spec delta).
- **Production migration mechanism** — `npm run migrate:prod`
  (`scripts/migrate-production-doppler.js`, Prisma `db push`) is replaced by a Prisma-independent Neon
  migration runner (forward + rollback) that lives outside `backend/`; the Neon SQL migrations become
  the authoritative path rather than a mirror of Prisma.
- **Scheduled jobs** — the six `backend/src/jobs/` jobs move to Cloudflare Cron Triggers/Queues (or are
  explicitly retired) before `backend/` is deleted.
- **Operational scripts** — `backend/scripts/` seeds, audits/backfills, Neon export, webhook
  diagnostics, and backup are relocated, reimplemented, or explicitly retired per the audit.
- **`backend/`** — removed at the end of Knob B, only after the rehoming checklist is fully satisfied.
- **`workers/`** — becomes the sole API for all environments; gains any Express-only endpoints and the
  rehomed jobs/scripts. The abandoned `workers/src/index.ts` + `workers/src/express-adapter.ts` (the
  "reuse 100% of the backend" approach that did not pan out) are deleted in Knob B.
- **CI** — `.github/workflows/backend-test.yml` (backend Vitest + the dedicated multi-tenant test job:
  cross-tenant isolation, penetration, concurrency, feature-gate enforcement) is updated in Knob A to
  run on Postgres, then retired in Knob B with its multi-tenant coverage rehomed onto the Worker suite.
- **Frontend dev config** — `frontend/src/lib/api.service.ts` defaults to `http://localhost:3001`
  (Express); `.env.example` and `vite.config.ts` carry `REACT_APP_API_URL`. Knob B repoints the dev
  default to the `wrangler dev` origin (port 8787) and updates `.env.example`. This is a Knob B
  dependency, not a Knob A one.
- **Developer onboarding** — one backend to run (`wrangler dev`) and one dialect (Postgres) to learn.

## Implementation Steps (high level; detail in `tasks.md`)

1. **Decision Gate** review — go/no-go with the trigger and prerequisites above.
2. **Knob A:** stand up Postgres-backed dev/test (pglite or Neon branch); port the backend test suite
   off SQLite; delete the SQLite Prisma base schema and runtime `src/migrations/` path.
3. **Responsibility & parity audit:** inventory everything `backend/` owns — Express-only endpoints,
   tests, the six scheduled jobs, the operational scripts, and the production migration mechanism — and
   map each to a Worker/replacement target or an explicit retirement. This checklist gates deletion.
4. **Replacement migration path:** stand up a Prisma-independent, executable Neon migration runner
   (forward + rollback) outside `backend/` and prove it on a real schema change before Prisma is removed.
5. **Knob B:** implement/verify Worker parity; rehome jobs and scripts; run the Worker locally as the
   dev API; delete `backend/` and Prisma only once the checklist is satisfied.
6. **Conventions:** rewrite golden rules 5 & 6 (naming the new migration runner); update the PR
   checklist; `npx openspec validate retire-express-unify-on-postgres --strict`.

## Definition of Done (measurable)

The change is complete when **all** of the following hold:

- **Knob A DoD:** a real schema change made after Knob A touches **≤3 artifacts** (Neon SQL migration +
  Worker raw SQL + shared domain types), requires **no** SQLite Prisma schema and **no** runtime SQLite
  migration, and CI is green on the single-engine (Postgres-only) setup.
- **Knob B DoD (in addition):** `backend/` is deleted; `wrangler dev` is the sole dev API and the
  frontend works against it locally; the Phase 2 rehoming checklist is fully satisfied (every endpoint,
  test, job, script, and the migration path has a replacement or recorded retirement); the
  Prisma-independent Neon migration runner has performed a real schema change **with a rollback**; and
  golden rules 5 & 6 are rewritten naming the new runner as authoritative.
- **Invariant throughout:** production behaviour, endpoints, auth, R2, Neon, and Hyperdrive are
  unchanged — production already runs solely on the Worker.
