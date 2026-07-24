# Tasks: Retire Express / unify on Postgres

> All source-changing tasks are **blocked on the Decision Gate** (Phase 0). Until that clears, only the
> spec/doc artifacts in this change directory exist.
>
> **Deletion invariant:** nothing under `backend/` is removed unless it appears in the Phase 2 rehoming
> checklist with either a verified replacement or an explicit, recorded retirement decision.

## Phase 0 — Decision Gate (required before any code)

- [x] 0.1 Confirm the trigger: schema-change friction (5–7 artifacts per column) is costing real time
  on active work, not just felt as untidy. **Cleared 2026-07-24** — the `enhance-supplier-policy-capture`
  change touched 5–7 artifacts per column add, meeting the measurable bar in `proposal.md`.
- [x] 0.2 Confirm intent to run the Worker as the sole dev API (`wrangler dev`). **Cleared 2026-07-24.**
- [x] 0.3 Choose the local DB story (pglite for tests + Neon dev branch for dev is the leading option;
  native Postgres fallback; Docker rejected). **Cleared 2026-07-24** — pglite for tests + Neon dev
  branch for local dev, native Postgres as offline fallback.
- [x] 0.4 Record go/no-go decision. **GO — recorded 2026-07-24.** Knob A source work may proceed;
  Knob B remains gated on Phases 2–3 per the sequencing rule.

## Phase 1 — Knob A: unify dev/test on Postgres (drop SQLite)

- [ ] 1.1 Stand up a Postgres-backed dev/test path (pglite and/or Neon dev branch); document how to run
  it without Docker. Add the `wrangler dev` local config (`.dev.vars` / `wrangler.toml` dev section)
  that points the Worker at the Neon dev branch (vs production Hyperdrive), and document which
  behaviours need the Neon dev branch because pglite cannot model them.
- [ ] 1.2 Point the existing backend Vitest suite at the Postgres-backed path (pglite for fast tests,
  Neon dev branch where pglite cannot model the behaviour) instead of `better-sqlite3`; get it green.
  The tests stay **Express-shaped** (`supertest`, Express `req`/`res`) in this phase — they only swap
  the database engine. The rewrite against the Worker `Request`/`Response` model is a Knob B task (4.2).
- [ ] 1.3 Point local dev data access at Postgres (dev branch / pglite) instead of SQLite.
- [ ] 1.3a Provide a Postgres dev-data seed/setup script so devs switching off SQLite can populate a
  fresh Neon dev branch / pglite instance without manual SQL. (Replaces the local SQLite DB devs have
  today; the existing `backend/scripts/seed-*` scripts are the starting point but may need a Postgres
  target.)
- [ ] 1.4 Remove the Prisma **base** (SQLite) schema and the runtime `src/migrations/` SQLite path once
  nothing depends on them. The runtime path is **code, not just SQL**: inventory and remove
  `backend/src/migrations/migrate.ts`, `migration.service.ts`, `migration.model.ts`, and the numbered
  `*-*.migration.ts` files. (Prisma itself and the production Neon path stay until Phase 4.) Keep the
  SQLite artifacts recoverable on a rollback branch until 1.7 stabilises — see `design.md` "Knob A
  itself needs a rollback".
- [ ] 1.5 Collapse the SQLite dialect surface: a column change no longer needs a SQLite schema or a
  runtime SQLite migration.
- [ ] 1.6 Update conformance tests: keep raw-SQL-vs-shared-TS on Postgres; drop the SQLite comparison
  arm. The conformance tests already live in `workers/src/__tests__/` (no backend-owned suite to
  migrate), so this is a workers-side edit.
- [ ] 1.7 Update `.github/workflows/backend-test.yml` to run the backend Vitest + multi-tenant test
  jobs on Postgres (pglite/Neon) instead of SQLite; then stabilise — full CI green on the single-engine
  setup before starting Phase 2. (The workflow itself is retired in Phase 4.7 once the Worker suite
  absorbs its coverage.)

## Phase 2 — Responsibility & parity audit (before removing anything from `backend/`)

Inventory **everything `backend/` owns**, not just HTTP routes. For each item, record a target: a Worker
equivalent, a relocated home, or an explicit retirement decision.

- [ ] 2.1 Express-only HTTP endpoints — routes in `backend/src/routes/*` with no equivalent in
  `workers/src/index-minimal.ts`. **Known today (pre-audit, from `proposal.md`):** `webhook.routes.ts`
  POST `/api/webhooks/stripe` (Worker has Clerk webhooks only — **Stripe webhook inbound handler is a
  Knob B blocker**), `organization-invite.routes.ts` (6 routes), `storage-quota.routes.ts` (2),
  `admin.metrics.routes.ts`, `database.backup.routes.ts`, and the cancel/portal/checkout/webhook-handler
  routes in `subscription.routes.ts` (Worker has `current` + `trial-status` only). The audit re-derives
  the full list from source at deletion time.
- [ ] 2.2 Express-only test coverage that must be reproduced on the Worker suite.
- [ ] 2.3 Scheduled jobs in `backend/src/jobs/` — `credit-claim`, `daily-metrics`, `daily-report-email`,
  `dunning`, `stripe-sync`, `trialExpiration`. Decide a home for each (Cloudflare **Cron Triggers** or
  **Queues**) or an explicit retirement.
- [ ] 2.4 Operational scripts in `backend/scripts/` — seeds (`seed-users`, `seed-tier-feature-flags`),
  audits/backfills (`audit-org-ids`, `backfill-*`, `check-*-org-ids`), data export
  (`neon-to-sqlite`, `export-excess-products`), diagnostics (`diagnose-webhook`, `verify-neon*`,
  `test-r2-connection`), and `backup.sh`. Decide relocate / reimplement / retire for each. **Also
  decide the backup capability's home:** `backup.sh` + `backend/src/routes/database.backup.routes.ts`
  together implement operator-triggered backup — pick a Worker route, Neon-native backups, or a
  scheduled R2 export via a Cron Trigger, and put the backup route on the rehoming checklist.
- [ ] 2.5 Authoritative production migration mechanism — `npm run migrate:prod`
  (`scripts/migrate-production-doppler.js`, currently Prisma `db push`). Mark it **replace, do not
  delete**; its successor is built in Phase 3 before Prisma is removed. **Inventory all backend-owned
  migration scripts**, not just the one: `migrate-production-doppler.js`, `migrate-production-simple.js`,
  `migrate-production.ts`, `migrate.js`, `verify-migration.js`, `list-migrations.ts` — each is replaced
  by the Phase 3 runner or explicitly retired.
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

- [ ] 4.1 Implement Worker handlers + routes for each Express-only endpoint from the audit. **Must
  include the Stripe webhook inbound handler** (`POST /api/webhooks/stripe`) — the Worker handles Clerk
  webhooks only today, so this is net-new, not a port.
- [ ] 4.2 **Rewrite** the migrated test coverage against the Worker's `Request`/`Response` model (not a
  port — the Express `supertest`/`req`/`res` constructs from Phase 1.2 do not exist on the Worker); get
  it green.
- [ ] 4.3 Rehome the scheduled jobs per 2.3 (Cron Triggers / Queues) or execute their retirement; verify
  each fires on schedule.
- [ ] 4.4 Relocate/reimplement the operational scripts kept in 2.4 (including the backup capability);
  execute retirement of the rest.
- [ ] 4.5 Run the Worker locally (`wrangler dev`) as the dev API; verify the frontend works against it in
  local dev.
- [ ] 4.5a Repoint the frontend dev API base URL from Express (port 3001) to the `wrangler dev` origin
  (port 8787): update the default in `frontend/src/lib/api.service.ts`, `frontend/.env.example`, and any
  `REACT_APP_API_URL` references in `vite.config.ts` / docs.
- [ ] 4.6 **Only once the rehoming checklist (2.6) is fully satisfied**, remove `backend/` (Express server,
  Prisma client, `better-sqlite3`), the Prisma production schema, and the Neon SQL files now superseded
  by the Phase 3 runner. **Also delete** `workers/src/index.ts` and `workers/src/express-adapter.ts`
  (the abandoned express-adapter entry point — `index-minimal.ts` is the real one).
- [ ] 4.7 Prune dependencies and scripts from the workspace: remove `express`, `@prisma/*`,
  `better-sqlite3`, and the backend Vitest project from `package.json` files (root, `backend/`, and any
  workspace-level). Remove the now-dead npm scripts (`migrate:prod`, `dev:backend`, `seed:*`, etc.).
  Retire `.github/workflows/backend-test.yml` and rehome its multi-tenant test coverage (cross-tenant
  isolation, penetration, concurrency, feature-gate enforcement) onto the Worker suite.

## Phase 5 — Conventions & closeout

- [ ] 5.1 Rewrite `openspec/project.md` golden rules 5 & 6 for a single backend / single migration path,
  naming the Phase 3 runner as the authoritative mechanism (replacing `prisma db push`).
- [ ] 5.2 Update the PR/contribution checklist to drop the triplicated-schema and dual-backend-parity
  rules and replace them with the single-backend equivalents.
- [ ] 5.3 Update `workers/README.md` (remove the "reuse 100% of the backend via express-adapter" framing;
  document the Worker as the sole API, the local-dev-on-Postgres flow, and where jobs/scripts now live).
- [ ] 5.4 `npx openspec validate retire-express-unify-on-postgres --strict`.
- [ ] 5.5 Archive this change once merged and live.
