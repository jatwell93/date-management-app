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

Two independently valuable knobs. Either can ship without the other; together they collapse 5–7
artifacts to ~2.

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
- Remove `backend/` (Express server, Prisma client, `better-sqlite3`) once parity and test coverage
  are confirmed on the Worker.
- Removes artifacts **#2, #3** (Prisma entirely), leaving only the Worker's raw SQL + Neon migrations
  + shared domain (~2 artifacts per schema change).

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
  route + test coverage onto the Worker.
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

1. **Trigger:** schema-change friction (touching 5–7 artifacts) is actually costing meaningful time on
   real work, not just felt as untidy.
2. **Worker parity coverage:** every Express-only endpoint has (or will get) an equivalent Worker
   handler and test before Express is deleted.
3. **Test story on Postgres:** the backend/service test suite that runs on SQLite today has a
   Postgres-backed equivalent (pglite or Neon branch) that is green.
4. **Sequencing:** Knob A ships and stabilises before Knob B, so a rollback point exists between "one
   database engine" and "one backend".

If the trigger is not met, this stays parked — the shared-domain discipline already contains the
dangerous part of the duplication, so completing this is cleanup, not risk reduction.

## Impact

- **`openspec/project.md` golden rules 5 & 6** — rewritten for a single backend / single migration path
  once Knob B lands (captured as MODIFIED requirements in the `dual-backend-parity` spec delta).
- **`backend/`** — removed at the end of Knob B.
- **`workers/`** — becomes the sole API for all environments; gains any Express-only endpoints.
- **CI** — the backend Vitest project and SQLite migration steps retire; the Worker suite and pglite
  conformance become the whole backend test story.
- **Developer onboarding** — one backend to run (`wrangler dev`) and one dialect (Postgres) to learn.

## Implementation Steps (high level; detail in `tasks.md`)

1. **Decision Gate** review — go/no-go with the trigger and prerequisites above.
2. **Knob A:** stand up Postgres-backed dev/test (pglite or Neon branch); port the backend test suite
   off SQLite; delete the SQLite Prisma base schema and runtime `src/migrations/` path.
3. **Parity audit:** enumerate Express-only endpoints and test coverage that must move to the Worker.
4. **Knob B:** implement/verify Worker parity for those endpoints; run the Worker locally as the dev
   API; delete `backend/` and Prisma once green.
5. **Conventions:** rewrite golden rules 5 & 6; update the PR checklist; `npx openspec validate
   retire-express-unify-on-postgres --strict`.
