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
  doing Knob B on top of SQLite would be incoherent.

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

Likely landing spot: **pglite for tests + a Neon dev branch for local dev**, with native Postgres as a
fallback for offline work. This keeps local weight low without Docker.

## What survives

- `shared/domain/*` stays — it is the single source of truth for cross-cutting business values and
  its raw-SQL-vs-TS conformance tests remain worthwhile even with one backend (they prove the Worker's
  hand-written SQL matches the shared TypeScript rules).
- The Worker keeps hand-written SQL via `@neondatabase/serverless`; this change does not introduce an
  ORM on the Worker.
- Production is untouched throughout — it already runs solely on the Worker.

## What retires

- `backend/` Express server, its Prisma client, and `better-sqlite3` (end of Knob B).
- Prisma base (SQLite) schema and the runtime `src/migrations/` SQLite path (Knob A).
- The SQLite side of the conformance tests; conformance becomes "raw SQL vs shared TS on Postgres"
  rather than "Postgres vs SQLite".
- Golden rules 5 and 6 in their current dual-backend form.

## Risks and mitigations

- **Express-only endpoint gaps.** Some routes may exist only in Express. Mitigation: a parity audit
  (task 3) enumerates them before any deletion; Express is not removed until each has a tested Worker
  equivalent.
- **Test coverage regression.** The backend Vitest suite runs on SQLite today. Mitigation: port it to a
  Postgres-backed path (pglite/Neon branch) and require green before deleting Express.
- **pglite/prod driver divergence for dev.** pglite is not the `@neondatabase/serverless` driver.
  Mitigation: use a Neon dev branch for behaviours pglite cannot model; keep pglite for fast tests.
- **Loss of the SQLite rollback path.** Mitigation: sequence A before B; keep the change reversible by
  landing Knob A independently and stabilising before Knob B.

## Alternatives considered

- **Do nothing (status quo).** Keep the triplication; rely on shared-domain + conformance to contain
  risk. Reasonable while schema-change friction is not actually costing time — this is the default until
  the Decision Gate trigger is met.
- **Knob A only.** Unify on Postgres but keep Express. Removes the dialect duplication and two
  artifacts with much less work than a full Express retirement; a legitimate stopping point.
- **Full rewrite / ORM on Worker.** Rejected — reintroduces the bundle-size and native-binding problems
  that Task 8.3 avoided, for no parity benefit.
