# Tasks: Retire Express / unify on Postgres

> All source-changing tasks are **blocked on the Decision Gate** (Phase 0). Until that clears, only the
> spec/doc artifacts in this change directory exist.

## Phase 0 — Decision Gate (required before any code)

- [ ] 0.1 Confirm the trigger: schema-change friction (5–7 artifacts per column) is costing real time
  on active work, not just felt as untidy.
- [ ] 0.2 Confirm intent to run the Worker as the sole dev API (`wrangler dev`).
- [ ] 0.3 Choose the local DB story (pglite for tests + Neon dev branch for dev is the leading option;
  native Postgres fallback; Docker rejected).
- [ ] 0.4 Record go/no-go decision. If no-go, park this change; the shared-domain discipline already
  contains the risky part of the duplication.

## Phase 1 — Knob A: unify dev/test on Postgres (drop SQLite)

- [ ] 1.1 Stand up a Postgres-backed dev/test path (pglite and/or Neon dev branch); document how to run
  it without Docker.
- [ ] 1.2 Port the backend Vitest suite off `better-sqlite3` onto the Postgres-backed path; get it green.
- [ ] 1.3 Point local dev data access at Postgres (dev branch / pglite) instead of SQLite.
- [ ] 1.4 Remove the Prisma **base** (SQLite) schema and the runtime `src/migrations/` SQLite path once
  nothing depends on them.
- [ ] 1.5 Collapse the schema story: a column change now touches Postgres schema/migration + Worker SQL
  + shared domain only (no SQLite dialect).
- [ ] 1.6 Update conformance tests: keep raw-SQL-vs-shared-TS on Postgres; drop the SQLite comparison
  arm.
- [ ] 1.7 Stabilise: full CI green on the single-engine setup before starting Phase 2.

## Phase 2 — Parity audit (before removing Express)

- [ ] 2.1 Enumerate every Express-only endpoint (routes present in `backend/src/routes/*` without a
  Worker equivalent in `workers/src/index-minimal.ts`).
- [ ] 2.2 Enumerate Express-only test coverage that must be reproduced on the Worker.
- [ ] 2.3 Produce a checklist mapping each Express-only endpoint/test to its Worker target.

## Phase 3 — Knob B: retire Express

- [ ] 3.1 Implement Worker handlers + routes for each Express-only endpoint from the parity audit.
- [ ] 3.2 Reproduce the migrated test coverage on the Worker suite; get it green.
- [ ] 3.3 Run the Worker locally (`wrangler dev`) as the dev API; verify the frontend works against it
  in local dev.
- [ ] 3.4 Remove `backend/` (Express server, Prisma client, `better-sqlite3`) and the now-unused Prisma
  production schema + Neon SQL duplication that only existed to mirror Prisma.
- [ ] 3.5 Prune dependencies and scripts (`express`, `@prisma/*`, `better-sqlite3`, backend Vitest
  project) from the workspace.

## Phase 4 — Conventions & closeout

- [ ] 4.1 Rewrite `openspec/project.md` golden rules 5 & 6 for a single backend / single migration path.
- [ ] 4.2 Update the PR/contribution checklist to drop the triplicated-schema and dual-backend-parity
  rules and replace them with the single-backend equivalents.
- [ ] 4.3 Update `workers/README.md` (remove the "reuse 100% of the backend via express-adapter" framing;
  document the Worker as the sole API and the local-dev-on-Postgres flow).
- [ ] 4.4 `npx openspec validate retire-express-unify-on-postgres --strict`.
- [ ] 4.5 Archive this change once merged and live.
