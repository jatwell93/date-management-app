# Tasks: Retire Express / unify on Postgres

> All source-changing tasks are **blocked on the Decision Gate** (Phase 0). Until that clears, only the
> spec/doc artifacts in this change directory exist.
>
> **Deletion invariant:** nothing under `backend/` is removed unless it appears in the Phase 2 rehoming
> checklist with either a verified replacement or an explicit, recorded retirement decision.

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
  nothing depends on them. (Prisma itself and the production Neon path stay until Phase 4.)
- [ ] 1.5 Collapse the SQLite dialect surface: a column change no longer needs a SQLite schema or a
  runtime SQLite migration.
- [ ] 1.6 Update conformance tests: keep raw-SQL-vs-shared-TS on Postgres; drop the SQLite comparison
  arm.
- [ ] 1.7 Stabilise: full CI green on the single-engine setup before starting Phase 2.

## Phase 2 — Responsibility & parity audit (before removing anything from `backend/`)

Inventory **everything `backend/` owns**, not just HTTP routes. For each item, record a target: a Worker
equivalent, a relocated home, or an explicit retirement decision.

- [ ] 2.1 Express-only HTTP endpoints — routes in `backend/src/routes/*` with no equivalent in
  `workers/src/index-minimal.ts`.
- [ ] 2.2 Express-only test coverage that must be reproduced on the Worker suite.
- [ ] 2.3 Scheduled jobs in `backend/src/jobs/` — `credit-claim`, `daily-metrics`, `daily-report-email`,
  `dunning`, `stripe-sync`, `trialExpiration`. Decide a home for each (Cloudflare **Cron Triggers** or
  **Queues**) or an explicit retirement.
- [ ] 2.4 Operational scripts in `backend/scripts/` — seeds (`seed-users`, `seed-tier-feature-flags`),
  audits/backfills (`audit-org-ids`, `backfill-*`, `check-*-org-ids`), data export
  (`neon-to-sqlite`, `export-excess-products`), diagnostics (`diagnose-webhook`, `verify-neon*`,
  `test-r2-connection`), and `backup.sh`. Decide relocate / reimplement / retire for each.
- [ ] 2.5 Authoritative production migration mechanism — `npm run migrate:prod`
  (`scripts/migrate-production-doppler.js`, currently Prisma `db push`). Mark it **replace, do not
  delete**; its successor is built in Phase 3 before Prisma is removed.
- [ ] 2.6 Produce a single **rehoming checklist** mapping every endpoint, test, job, script, and the
  migration path to a target or a recorded retirement decision. This checklist gates all deletion in
  Phase 4.

## Phase 3 — Establish the replacement production migration path (before deletion)

- [ ] 3.1 Choose an executable Postgres migration runner for Neon that does **not** depend on Prisma
  (e.g. promote `backend/prisma/neon-sql/*.sql` to authoritative, executed by a lightweight runner such
  as `node-pg-migrate` / `dbmate` / a small first-party script), with forward **and** rollback support.
- [ ] 3.2 Provide a production migration command to replace `migrate:prod`, living **outside** `backend/`
  (workers workspace or repo root) and running under Doppler.
- [ ] 3.3 Prove the new path end-to-end on a real schema change against a Neon dev branch, **including a
  rollback**.
- [ ] 3.4 Document the new authoritative path and its rollback (the golden-rule rewrite itself lands in
  Phase 5).

## Phase 4 — Knob B: retire Express (deletion gated on Phases 2–3)

- [ ] 4.1 Implement Worker handlers + routes for each Express-only endpoint from the audit.
- [ ] 4.2 Reproduce the migrated test coverage on the Worker suite; get it green.
- [ ] 4.3 Rehome the scheduled jobs per 2.3 (Cron Triggers / Queues) or execute their retirement; verify
  each fires on schedule.
- [ ] 4.4 Relocate/reimplement the operational scripts kept in 2.4; execute retirement of the rest.
- [ ] 4.5 Run the Worker locally (`wrangler dev`) as the dev API; verify the frontend works against it in
  local dev.
- [ ] 4.6 **Only once the rehoming checklist (2.6) is fully satisfied**, remove `backend/` (Express server,
  Prisma client, `better-sqlite3`), the Prisma production schema, and the Neon SQL files now superseded
  by the Phase 3 runner.
- [ ] 4.7 Prune dependencies and scripts (`express`, `@prisma/*`, `better-sqlite3`, the backend Vitest
  project) from the workspace.

## Phase 5 — Conventions & closeout

- [ ] 5.1 Rewrite `openspec/project.md` golden rules 5 & 6 for a single backend / single migration path,
  naming the Phase 3 runner as the authoritative mechanism (replacing `prisma db push`).
- [ ] 5.2 Update the PR/contribution checklist to drop the triplicated-schema and dual-backend-parity
  rules and replace them with the single-backend equivalents.
- [ ] 5.3 Update `workers/README.md` (remove the "reuse 100% of the backend via express-adapter" framing;
  document the Worker as the sole API, the local-dev-on-Postgres flow, and where jobs/scripts now live).
- [ ] 5.4 `npx openspec validate retire-express-unify-on-postgres --strict`.
- [ ] 5.5 Archive this change once merged and live.
