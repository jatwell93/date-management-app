# Proposal: Retire Express, Prisma, and SQLite and unify on the Worker + Postgres

> **Status: DECISION GATE CLEARED — GO (2026-07-24). Phase 1 (migration foundation) may begin.** This
> began as a decision-capture proposal. The **retirement path is decided — direct, not a staged
> engine-swap**; the **measurable trigger is met** (#390, #394), the **sole-Worker dev API is approved**,
> the **local/CI database story is confirmed**, and **go/no-go is GO** (all 2026-07-24). Deletion
> (Phase 4) stays gated on the replacement migration foundation (Phase 1) and the parity audit (Phase 2);
> each production cutover keeps its own verification/rollback gate.

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

This proposal removes that cost by retiring Express, Prisma, and SQLite and running the Worker against
Postgres as the **one backend and one database engine** everywhere.

## What changes

Retire `backend/` (Express + Prisma + SQLite) and run the Cloudflare Worker as the sole backend in
every environment. The end state per schema change is **~2–3 artifacts** (authoritative Postgres
migration + Worker raw SQL + shared domain) down from 5–7.

**Guiding principle: SQLite is deleted, not migrated.** An earlier draft staged this as two "knobs" —
first swap the Express dev/test database SQLite→Postgres (Knob A), then retire Express (Knob B). We
have **rejected that staging** for the direct path, because:

- **It is throwaway work.** Knob A ports the entire Express test suite onto Postgres keeping it
  Express-shaped (`supertest`, `req`/`res`), then Knob B **rewrites** that same suite against the
  Worker's `Request`/`Response` model. Knob A's Postgres-backed backend CI is likewise stood up only to
  be retired. The bulk of Knob A is written to be discarded.
- **It de-risks the wrong half.** The engine-swap's "one engine, two backends" rollback point protects
  a *SQLite→Postgres dialect change* that pglite and the conformance tests already prove is safe. It
  does nothing for the genuinely risky work: net-new Worker capability (Stripe webhook inbound,
  invitations, storage quota, scheduled jobs) and standing up a Prisma-independent production migration
  runner.

So Express keeps running **on SQLite, untouched**, as the reference/rollback backend until the moment
it is deleted. The sequence de-risks the dangerous parts first instead:

1. **Migration foundation first.** Stand up a Prisma-independent, executable Neon migration runner
   (forward + rollback, baseline + adoption) and prove it on a real schema change against a Neon dev
   branch. This is the single most load-bearing responsibility Prisma owns today (`npm run migrate:prod`
   / `scripts/migrate-production-doppler.js`), it survives regardless of what else happens, and it
   directly de-risks production. See `design.md` "Replacement production migration path".
2. **Responsibility & parity audit.** Inventory **everything `backend/` owns** — not just HTTP routes,
   but the scheduled jobs (`backend/src/jobs/`), operational scripts (`backend/scripts/`), migration
   scripts, middleware/runtime concerns, tests, docs, and config. Each item gets a Worker/relocated
   target or an explicit retirement decision. This can run in parallel with (1).
3. **Worker parity + move dev/tests onto the Worker.** Implement the missing Worker capabilities from
   the audit; **write the migrated test coverage once**, Worker-shaped, on pglite/Neon (never the
   Express-shaped Postgres detour); run the Worker locally via `wrangler dev` as the dev API; repoint
   the frontend; and initialize the pglite conformance harness from the authoritative migrations
   (dropping the SQLite comparison arm and the embedded `SCHEMA_SQL` as separate schema sources).
4. **Delete Express + Prisma + SQLite together**, in one controlled retirement gated on (1)–(3), once
   the rehoming checklist is fully satisfied.

## Local development after this change

The concern that motivated caution — added local runtime weight on an already-slow PC — is
**avoidable**, and the direct path keeps local dev simpler because Express is never re-plumbed:

| Concern | Answer |
|---|---|
| Express dev/test during the transition | **Unchanged — stays on SQLite** until deletion. No new local DB required to keep the fallback working. |
| Worker local dev | `wrangler dev` (workerd/Miniflare) — comparable in weight to today's `ts-node` Express — pointed at a **Neon dev branch** (or pglite offline). |
| Worker + conformance tests | **pglite** (already a dependency), initialized from the authoritative migrations. |
| Migration-runner CI | Ephemeral per-run Postgres service or an auto-created Neon branch — no production secrets. |

`wrangler dev` is comparable in weight to the current `ts-node` Express process, and no heavyweight
local Postgres server (Docker especially) is required, so this does not add meaningful weight to the
dev machine.

## Scope

- **In scope:** the direct retirement of `backend/` (Express + Prisma + SQLite); a Prisma-independent
  authoritative production migration path stood up and proven **before** deletion; migrating
  Express-only route + test coverage onto the Worker (tests written once, Worker-shaped); rehoming the
  backend's scheduled jobs and operational scripts; the Worker as the sole local/dev API via
  `wrangler dev`; and rewriting the dual-backend parity conventions (golden rules 5 & 6) to their
  single-backend form.
- **In scope (docs/spec only for now):** this proposal, its design notes, task breakdown, and the
  `dual-backend-parity` spec delta. No source changes land under this change until the Decision Gate
  clears.

## Non-goals

- **Not** changing production behaviour, endpoints, auth, R2, Neon, or Hyperdrive — production already
  runs solely on the Worker and is unaffected, except for capabilities explicitly cut over to the
  Worker (notably Stripe webhooks and scheduled work), each with its own gate.
- **Not** migrating Express's database to Postgres. Express stays on SQLite and is deleted wholesale.
- **Not** removing the `shared/domain/*` modules — they remain the single source of truth and their
  raw-SQL-vs-TS conformance tests remain valuable even with one backend.
- **Not** switching ORM/query style for the Worker — it keeps hand-written SQL.
- **Not** a rewrite of business logic — this is an infrastructure/dev-experience consolidation.
- **Not** preserving unreachable Express route files merely because they exist. The audit classifies
  mounted/consumed, mounted/unconsumed, unmounted/dead, and Worker-only capabilities before deciding.
- **Not** requiring destructive down migrations. Lossless down migrations, Worker rollback with an
  expanded schema, forward fixes, and Neon point-in-time recovery are separate recovery tools.

## Decision Gate

Before any source change under this proposal, confirm all of:

1. **Trigger (measurable) — MET.** At least one of the two most recent schema changes touched **≥5 of
   the 5–7 triplication artifacts** AND the base (`schema.prisma`) and production
   (`production/schema.prisma`) Prisma schemas received a **byte-identical edit** — proving the change
   was mechanically mirrored across dialects rather than being business logic. This git-observable proxy
   replaces an earlier, unmeasurable ">30 minutes of mechanical sync" clause (wall-clock time is not
   recoverable from history); the identical-diff signal is recorded permanently and is stronger
   evidence. **Evidence:** #390 (credit-scoped markdown) and #394 (catalogue provenance) *each* touched
   **7/7** artifacts with byte-identical dual-Prisma edits. If future changes stop clearing this bar,
   the shared-domain discipline still contains the dangerous half of the duplication, so completing this
   is cleanup, not risk reduction.
2. **Worker parity coverage:** every Express-only endpoint has (or will get) an equivalent Worker
   handler and test before Express is deleted. The **known Express-only endpoints today** (pre-audit,
   see "Known Express-only surface" below) must each be on the Phase 2 rehoming checklist with a
   target before deletion.
3. **Coverage reproduced on the Worker:** the multi-tenant and service coverage the backend Vitest
   suite provides on SQLite today (tenant isolation, penetration, concurrency, feature-gate
   enforcement, authorization precedence, webhook security) has a **Worker-shaped** equivalent on
   pglite/Neon that is green **before** Express is deleted. Note this is the coverage being reproduced
   once, not the Express test suite being ported to Postgres.
4. **Migration path replaced first:** a Prisma-independent, executable Neon migration runner (forward +
   rollback, with baseline + adoption) is proven **before** Prisma/`backend/` is removed —
   `npm run migrate:prod` must not be deleted without a working successor.
5. **Non-route responsibilities rehomed:** the scheduled jobs and the operational scripts in
   `backend/` each have a Worker/relocated home or a recorded retirement decision before deletion.
6. **Retirement is direct, SQLite retained as rollback:** there is **no intermediate "Express on
   Postgres" state**. Express + Prisma + SQLite stay untouched and revertable (`git revert` of the
   branch restores the working SQLite dev backend) until Worker parity (2, 3) and the migration runner
   (4) are proven, then all three are deleted together. Do **not** convert the Express dev/test/CI
   stack to Postgres only to rewrite or discard it — that transitional work buys a rollback point for
   the already-safe dialect half while leaving the dangerous half unguarded.

### Decision Gate outcome

- **Status:** ✅ **Cleared — GO (2026-07-24).** All Phase 0 prerequisites are recorded; Phase 1 (the
  migration foundation) is unparked and may begin. Phase 4 deletion stays gated on Phases 1–2.
- **Criterion 1 (measurable trigger) — MET.** The unmeasurable ">30 minutes" clause was revised to the
  git-observable identical-dual-Prisma-edit proxy (see criterion 1). Evidence on file: #390 and #394
  each touched **7/7** triplication artifacts with **byte-identical** edits to the base and production
  Prisma schemas — mechanical mirroring, not business logic.
- **Sole-Worker dev API — APPROVED (2026-07-24)** by the product owner (jatwell93): `wrangler dev`
  becomes the sole local dev API and Express is retired as a dev backend. Satisfies criterion 2's
  product-decision prerequisite and gate task 0.2.
- **Sequencing decision — RESOLVED (direct path).** The staged Knob A→B engine-swap is rejected in
  favour of direct retirement, for the reasons in "What changes" and criterion 6.
- **Local/CI database story — CONFIRMED (2026-07-24)** (task 0.3): Express dev/test stays on SQLite
  untouched; Worker + conformance tests on pglite; Worker local dev via `wrangler dev` against a Neon
  branch; migration-runner CI on an ephemeral Postgres / per-run Neon branch with no production secrets;
  no Docker.
- **Go/no-go — GO (2026-07-24)** (task 0.4): Phase 1 (migration foundation) is unparked. Deletion
  (Phase 4) remains gated on Phases 1–2, and each production cutover keeps its own verification/rollback
  gate.

### Known Express-only surface (pre-audit, to be confirmed in Phase 2)

Routes in `backend/src/routes/*` with **no equivalent** in `workers/src/index-minimal.ts` today:

| Route file | Routes | Worker status |
|---|---|---|
| `webhook.routes.ts` | `POST /api/webhooks/stripe` | ❌ Missing — Worker handles Clerk webhooks only. **Stripe webhook inbound handler is a retirement blocker.** |
| `organization-invite.routes.ts` | 6 (create/accept/list/delete/revoke/bulk-delete) | ❌ Missing |
| `storage-quota.routes.ts` | `GET /:userId`, `GET /:userId/can-upload` | ❌ Missing and actively called by the frontend |
| `database.backup.routes.ts` | create, list, restore | ❌ Missing; decide against Neon-native recovery |
| `subscription.routes.ts` | cancel, portal, checkout, convert-trial (4 of 6) | 🟡 Partial — Worker has `current` + `trial-status` only |
| `auth.routes.ts` | logout (mounted at two prefixes) | ❌ Missing |
| `health.routes.ts` | liveness, readiness, metrics, DB metrics/health, alerts | 🟡 Worker health exists; contract parity unverified |
| `product.routes.ts` | export, update, delete, legacy upload | 🟡 Worker product surface is partial |
| `report.routes.ts` | monthly markdown, status update, usage, advanced analytics | 🟡 Worker report surface is partial |

This list is a starting point for Phase 2 task 2.1, not its conclusion — the audit re-derives it from
mounted source and consumers at deletion time. `admin.metrics.routes.ts` is deliberately absent because
it is currently unmounted; Phase 2 classifies it as dead or intentionally restored rather than creating
a new Worker capability by accident.

## Impact

- **`openspec/project.md` golden rules 5 & 6** — rewritten for a single backend / single migration path
  (captured as MODIFIED requirements in the `dual-backend-parity` spec delta).
- **Production migration mechanism** — `npm run migrate:prod`
  (`scripts/migrate-production-doppler.js`, Prisma `db push`) is replaced by a Prisma-independent Neon
  migration runner (forward + rollback) that lives outside `backend/`; the Neon SQL migrations become
  the authoritative path rather than a mirror of Prisma. Built and proven in Phase 1, **before**
  anything is deleted.
- **Scheduled jobs** — the `backend/src/jobs/` jobs move to Cloudflare Cron Triggers/Queues (or are
  explicitly retired) before `backend/` is deleted.
- **Operational scripts** — `backend/scripts/` seeds, audits/backfills, Neon export, webhook
  diagnostics, and backup are relocated, reimplemented, or explicitly retired per the audit.
- **`backend/`** — Express server, Prisma client, `better-sqlite3`, the Prisma **base** (SQLite) schema,
  the runtime `src/migrations/` SQLite migration runner, and the Prisma **production** schema are all
  removed together at the end, only after the rehoming checklist is fully satisfied. **SQLite is never
  ported to Postgres — it is deleted.**
- **`workers/`** — becomes the sole API for all environments; gains any Express-only endpoints and the
  rehomed jobs/scripts. The abandoned `workers/src/index.ts` + `workers/src/express-adapter.ts` (the
  "reuse 100% of the backend" approach that did not pan out) are deleted alongside `backend/`.
- **CI** — `.github/workflows/backend-test.yml` (backend Vitest + the dedicated multi-tenant test job:
  cross-tenant isolation, penetration, concurrency, feature-gate enforcement) keeps running on SQLite
  **untouched** during the transition and is retired with `backend/`, after its multi-tenant coverage
  is rehomed onto the Worker suite. A new required Worker/database-conformance workflow is added.
- **Frontend dev config** — `frontend/src/lib/api.service.ts` defaults to `http://localhost:3001`
  (Express); `.env.example` and `vite.config.ts` carry `REACT_APP_API_URL`. The retirement repoints the
  dev default to the `wrangler dev` origin (port 8787) and updates `.env.example`.
- **Developer onboarding** — one backend to run (`wrangler dev`) and one dialect (Postgres) to learn.

## Implementation Steps (high level; detail in `tasks.md`)

1. **Decision Gate** review — go/no-go with the trigger and prerequisites above (sequencing already
   resolved to the direct path).
2. **Migration foundation:** stand up a Prisma-independent, executable Neon migration runner (forward +
   rollback) outside `backend/`, with baseline + adoption, and prove it on a real schema change against
   a Neon dev branch. Nothing is deleted until this succeeds.
3. **Responsibility & parity audit:** inventory everything `backend/` owns — Express-only endpoints,
   tests, scheduled jobs, operational scripts, migration scripts, middleware/runtime concerns, docs,
   and config — and map each to a Worker/replacement target or an explicit retirement. This checklist
   gates deletion. Runs in parallel with step 2.
4. **Worker parity + move dev/tests onto the Worker:** implement/verify Worker parity; write the
   migrated coverage once against the Worker model; rehome jobs and scripts; run `wrangler dev` as the
   dev API and repoint the frontend; initialize pglite conformance from the authoritative migrations
   and drop the SQLite arm.
5. **Delete Express + Prisma + SQLite together** once the rehoming checklist is satisfied and the
   migration runner has performed a real schema change with rollback.
6. **Conventions:** rewrite golden rules 5 & 6 (naming the new migration runner); update the PR
   checklist; `npx openspec validate retire-express-unify-on-postgres --strict`.

## Definition of Done (measurable)

The change is complete when **all** of the following hold:

- A real schema change made after this lands requires **no SQLite-specific artifact** and touches
  **≤3 artifact categories**: the authoritative PostgreSQL migration, the Worker SQL/data mapping, and
  shared domain types when the domain contract changes.
- `backend/` (Express, Prisma, `better-sqlite3`, both Prisma schemas, the runtime SQLite migration
  runner) is deleted; `wrangler dev` is the sole dev API and the frontend works against it locally.
- The Phase 3 rehoming checklist is fully satisfied — every endpoint, test, job, script, and the
  migration path has a replacement or a recorded retirement.
- The Prisma-independent Neon migration runner has performed a real schema change **with a rollback**,
  and golden rules 5 & 6 are rewritten naming it as authoritative.
- **Invariant throughout:** production behaviour, endpoints, auth, R2, Neon, and Hyperdrive are
  unchanged except for capabilities explicitly cut over to the Worker (notably Stripe webhooks and
  scheduled work). Each such cutover has its own verification, monitoring, and rollback gate. Until the
  final deletion, the SQLite-backed Express backend remains a working, revertable fallback.
