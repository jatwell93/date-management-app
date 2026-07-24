# Tasks: Retire Express, Prisma, and SQLite — unify on the Worker + Postgres

> All source-changing tasks are **blocked on the Decision Gate** (Phase 0). Until that clears, only the
> spec/doc artifacts in this change directory exist.
>
> **Direct path:** there is no intermediate "Express on Postgres" state. Express + Prisma + SQLite stay
> untouched as the rollback backend until Worker parity and the migration runner are proven, then all
> three are deleted together (Phase 4).
>
> **Deletion invariant:** nothing under `backend/` is removed unless it appears in the Phase 3 rehoming
> checklist with either a verified replacement or an explicit, recorded retirement decision.

## Phase 0 — Decision Gate (required before any code)

- [x] 0.1 Confirm the trigger — **MET (2026-07-24)**. The unmeasurable ">30 minutes of mechanical sync"
  clause was revised to a git-observable proxy: a schema change touches **≥5 of the 5–7 triplication
  artifacts** AND the base + production Prisma schemas receive a **byte-identical edit** (mechanical
  mirroring, not business logic). Evidence: **#390** (credit-scoped markdown) and **#394** (catalogue
  provenance) each touched **7/7** artifacts with byte-identical dual-Prisma edits (verified via
  `git show` diff comparison). The proposal Decision Gate criterion 1 carries the revised wording.
- [x] 0.2 Sole-Worker dev API — **APPROVED (2026-07-24)** by the product owner (jatwell93): run the
  Worker (`wrangler dev`) as the sole local dev API and retire Express as a dev backend.
- [ ] 0.3 Confirm the local/CI DB story for the direct path. **Recommendation:** Express dev/test stays
  on **SQLite, untouched** until deletion; Worker + conformance tests use **pglite**; Worker local dev
  uses `wrangler dev` against a developer-owned **Neon branch** (pglite offline fallback); the migration
  runner's required pull-request CI uses an ephemeral PostgreSQL service or an auto-created per-run Neon
  branch without production secrets; a separate scheduled Neon compatibility job exercises the provider.
  Record the final choice and ownership.
- [ ] 0.4 Record the go/no-go decision after 0.1–0.3 and this engineering review are complete. The
  sequencing question (staged vs direct) is **already resolved to the direct path** — see the proposal
  Decision Gate outcome; do not re-litigate it here. Source work remains paused until 0.1–0.3 are
  recorded.

## Phase 1 — Establish the authoritative PostgreSQL migration foundation (before anything is deleted)

> Highest-priority, highest-value work: it replaces the single most load-bearing thing Prisma owns
> (`npm run migrate:prod`), survives regardless of the rest, and directly de-risks production. Runs in
> parallel with the Phase 2 audit.

- [ ] 1.1 Choose an executable Postgres migration runner for Neon that does **not** depend on Prisma.
  Relocate `backend/prisma/neon-sql/*.sql` to a permanent path outside `backend/` and promote the
  relocated files—not the runner alone—to the authoritative migration history. Require forward and
  rollback support, an applied-migration ledger with identity/checksum validation, ordering checks,
  and explicit transaction rules. Use a dedicated `schema_migrations` ledger; reconcile/retain the
  legacy `migrations` table. Acquire a PostgreSQL advisory lock, make transactional DDL plus ledger
  write atomic, bound lock/statement timeouts, and define resume/repair for explicit non-transactional
  migrations.
- [ ] 1.2 Build a canonical PostgreSQL baseline because the current Neon SQL series assumes an older
  schema already exists. Prove empty database → baseline → all migrations → latest schema fingerprint,
  covering tables, columns, constraints, indexes, defaults, functions, checks, and partial indexes.
- [ ] 1.3 Build an explicit one-time adoption command for the existing production-shaped database.
  `adopt --dry-run` performs read-only catalog-definition checks, refuses mismatches, emits a reviewable
  report, and only a separate approved adoption stamps baseline/checksum metadata. Adoption never treats
  "object already exists" as proof the object is correct.
- [ ] 1.4 Provide separate ordered commands outside `backend/` for migration status/preflight/apply,
  required idempotent reference-data seed, and schema/data verification. Require a dedicated DDL
  migration role, allowlisted target identity, redacted output, explicit production confirmation,
  and rejection of development/restore/pooled application targets.
- [ ] 1.5 Prove the runner end-to-end against isolated PostgreSQL/Neon targets: fresh install,
  existing-schema adoption, concurrent invocation refusal, interruption/recovery, checksum/catalog
  drift, safe down migration, forward fix, Worker rollback with expanded schema, and restore recovery.
  **Perform at least one real schema change with a working rollback on a Neon dev branch** — this is the
  gate that lets Prisma be removed in Phase 4.
- [ ] 1.6 Integrate migrations into deployment: validate history; store dry-run/status output as an
  artifact; verify Neon PITR/backup readiness; apply expand-compatible schema; verify postconditions;
  seed/verify prerequisites; deploy Worker; run real database readiness plus schema-dependent smoke
  tests; observe a canary window with explicit stop/rollback thresholds. Migration-only changes must
  trigger this workflow, and manual deploy commands must not bypass compatibility checks.
- [ ] 1.7 Require expand/migrate/contract metadata for every schema change, including compatibility,
  reversibility/data-loss class, backfill/resume plan, and the later contract deployment. Do not use
  destructive down migrations as the default rollback.
- [ ] 1.8 Verify production recovery before first migration: active Neon retention/PITR, named
  pre-migration recovery point, restore-to-new-branch drill, application verification, RPO/RTO, and
  responsible operator.
- [ ] 1.9 Add structured migration logs/status and alerts for failure, advisory-lock timeout, checksum
  mismatch, drift, duration, target identity, migration ID, and deployment SHA. Make Worker health
  execute a real database readiness query and verify Cloudflare observability/Sentry are enabled.
- [ ] 1.10 Document the new authoritative path and its rollback (the golden-rule rewrite itself lands in
  Phase 5).

## Phase 2 — Responsibility & parity audit (parallel with Phase 1; before removing anything)

Inventory **everything `backend/` owns**, not just HTTP routes. For each item, record a target: a Worker
equivalent, a relocated home, or an explicit retirement decision.

- [ ] 2.1 Generate a mounted-route matrix from `backend/src/index.ts` plus router mount prefixes—not
  filenames. For every Express and Worker method/path, record mounted/reachable status, frontend or
  operator consumer, auth type, role, tenant derivation, feature/usage limits, validation, rate limit,
  raw-body needs, request/response/status contract, side effects, and keep/replace/retire decision.
  Classify mounted+consumed, mounted+unconsumed, unmounted/dead, and Worker-only routes. Re-derive the
  full list; known gaps include Stripe webhook, invitations, storage quota, subscription
  checkout/cancel/portal/convert-trial, logout, health/metrics/alerts, product export/update/delete/
  legacy-upload, advanced reports, and backup create/list/restore. Do not implement the currently
  unmounted `admin.metrics.routes.ts` merely because its file exists.
- [ ] 2.2 Produce a test-coverage manifest mapping every backend test file/behaviour to an existing
  Worker equivalent, a **Worker-shaped rewrite** (Phase 3.2), or an explicit retirement. Preserve named
  gates for tenant isolation, penetration, concurrency, feature limits, webhook security, scheduled-job
  idempotency, authorization precedence, and negative/error cases; zero rows may remain unresolved at
  deletion. The Express test suite is **not ported to Postgres** — it keeps running on SQLite until
  deletion; this manifest is what its coverage maps onto in the Worker suite.
- [ ] 2.3 Produce an action-level schedule matrix from actual `SchedulerService` registrations and
  dormant job exports—not a six-file list. Include markdown recalculation, backup, trial expiration,
  dunning, Stripe sync, both credit-claim schedules, webhook monitoring, metrics, and report email.
  Record active/dormant/test-only status, cron/timezone, inputs/secrets, retries, overlap prevention,
  idempotency, observability, failure recovery, and Cron Trigger/Queue/retire target.
- [ ] 2.4 Operational scripts in `backend/scripts/` — seeds (`seed-users`, `seed-tier-feature-flags`),
  audits/backfills (`audit-org-ids`, `backfill-*`, `check-*-org-ids`), data export
  (`neon-to-sqlite`, `export-excess-products`), diagnostics (`diagnose-webhook`, `verify-neon*`,
  `test-r2-connection`), and `backup.sh`. Decide relocate / reimplement / retire for each. **Also
  decide the backup capability's home:** `backup.sh` + `backend/src/routes/database.backup.routes.ts`
  together implement operator-triggered backup — pick a Worker route, Neon-native backups, or a
  scheduled R2 export via a Cron Trigger, and put the backup route on the rehoming checklist.
- [ ] 2.5 Inventory **all backend-owned migration scripts** and mark each **replace, do not delete**
  until the Phase 1 runner supersedes it: `migrate-production-doppler.js` (the authoritative
  `npm run migrate:prod`), `migrate-production-simple.js`, `migrate-production.ts`, `migrate.js`,
  `verify-migration.js`, `list-migrations.ts`, plus the runtime SQLite migration runner
  (`backend/src/migrations/{migrate.ts,migration.service.ts,migration.model.ts}` and the numbered
  `*-*.migration.ts` files). Record the current production command's full contract: schema push,
  required tier/reference seed, and post-migration verification, so Phase 1 reproduces it.
- [ ] 2.6 Produce a single **rehoming checklist** mapping every endpoint, test, job, script, and the
  migration path to a target or a recorded retirement decision. Include middleware/runtime concerns
  (CORS, auth, tenant/role gates, rate limiting, error shape, Sentry, health/readiness, environment
  validation, shutdown), frontend network call sites, docs/runbooks, configuration, env templates,
  assets/generated files, package commands, workflows, and root tooling. This checklist gates all
  deletion in Phase 4.

## Phase 3 — Worker parity + move dev/tests onto the Worker (gated on Phases 1–2)

> Build the Worker up beside the still-running SQLite Express backend. Coverage is written **once**,
> Worker-shaped — never the Express-shaped Postgres detour.

- [ ] 3.1 Implement Worker handlers + routes for each Express-only endpoint from the audit. **Must
  include the Stripe webhook inbound handler** (`POST /api/webhooks/stripe`) — the Worker handles Clerk
  webhooks only today, so this is net-new, not a port.
- [ ] 3.2 Write the migrated test coverage **once, against the Worker's `Request`/`Response` model** on
  pglite/Neon (there is no Express-shaped Postgres intermediate to port from). Reproduce the named gates
  from 2.2 — tenant isolation, penetration, concurrency, feature limits, webhook security,
  scheduled-job idempotency, authorization precedence — and get it green before any deletion.
- [ ] 3.3 Rehome the scheduled jobs per 2.3 (Cron Triggers / Queues) or execute their retirement; verify
  each fires on schedule. Add the Worker `scheduled()` dispatcher and Wrangler Cron Trigger
  declarations; test dispatch, overlap prevention, retry/idempotency, and alerting.
- [ ] 3.4 Relocate/reimplement the operational scripts kept in 2.4 (including the backup capability);
  execute retirement of the rest.
- [ ] 3.5 Initialize the pglite conformance harness from the **authoritative Phase 1 migrations/baseline**
  instead of its embedded `SCHEMA_SQL`, and drop the SQLite comparison arm — conformance becomes "raw
  SQL vs shared TS on Postgres". The conformance tests already live in `workers/src/__tests__/`
  (`database.conformance.node.test.ts`, `database.credit-claim.conformance.node.test.ts`,
  `database.supplier-policy.conformance.node.test.ts`, etc.), so this is a workers-side edit. Add a
  fresh-database drift test so the harness stops being an independent schema source.
- [ ] 3.6 Run the Worker locally (`wrangler dev`) as the dev API; verify the frontend works against it in
  local dev. Add the `wrangler dev` local config (`.dev.vars` / `wrangler.toml` dev section) pointing at
  a developer-owned Neon branch (vs production Hyperdrive), and document which behaviours need the Neon
  branch because pglite cannot model them.
- [ ] 3.7 Repoint the frontend dev API base URL from Express (port 3001) to the `wrangler dev` origin
  (port 8787): update the default in `frontend/src/lib/api.service.ts`, `frontend/.env.example`, and any
  `REACT_APP_API_URL` references in `vite.config.ts` / docs. Inventory every frontend network call and
  route it through the shared URL builder unless intentionally same-origin; browser-test frontend
  port 3002 → Worker port 8787 for storage quota, subscription checkout/cancel/portal, uploads, errors,
  and CORS.
- [ ] 3.8 Cut Stripe webhooks over as a production change: add typed secret/config, raw-byte signature
  verification, supported-event contract, durable event idempotency/replay handling, Stripe endpoint
  registration, shadow/dev verification, monitored cutover, and rollback. Keep the old Express receiver
  available until Stripe delivery to the Worker is confirmed.
- [ ] 3.9 Add one required database-conformance workflow triggered by `workers/**`, `shared/**`,
  authoritative migrations/schemas, and relevant root package/lock files. Run the Worker PGlite
  conformance job and the migration-runner job (ephemeral Postgres / per-run Neon branch, no production
  secrets); combine them in an always-reporting required gate. Fail rather than skip when the database
  is unavailable.

## Phase 4 — Delete Express + Prisma + SQLite together (gated on Phases 1–3)

- [ ] 4.1 **Only once the rehoming checklist (2.6) is fully satisfied and the Phase 1 runner has proven a
  real schema change with rollback (1.5)**, remove `backend/` in one controlled retirement: the Express
  server, Prisma client, `better-sqlite3`, the Prisma **base** (SQLite) schema, the runtime
  `src/migrations/` SQLite migration runner (`migrate.ts`, `migration.service.ts`, `migration.model.ts`,
  numbered `*-*.migration.ts`), and the Prisma **production** schema. Delete only the obsolete copies of
  Neon SQL after their history/checksums have been preserved in the authoritative Phase 1 location.
  **Also delete** `workers/src/index.ts` and `workers/src/express-adapter.ts` (the abandoned
  express-adapter entry point — `index-minimal.ts` is the real one).
- [ ] 4.2 Prune dependencies and scripts from the workspace: remove `express`, `@prisma/*`,
  `better-sqlite3`, and the backend Vitest project from `package.json` files (root, `backend/`, and any
  workspace-level). Remove the now-dead npm scripts (`migrate:prod`, `dev:backend`, `seed:*`, the
  superseded migration scripts from 2.5, etc.). Retire `.github/workflows/backend-test.yml` — its
  multi-tenant coverage (cross-tenant isolation, penetration, concurrency, feature-gate enforcement) is
  already rehomed onto the Worker suite in Phase 3.2, so removing it loses nothing.
- [ ] 4.3 Tag the last Express+SQLite-capable revision before deletion so the fallback is recoverable by
  `git revert`/checkout if a post-deletion regression appears. Document the exact recovery commands.

## Phase 5 — Conventions & closeout

- [ ] 5.1 Rewrite `openspec/project.md` golden rules 5 & 6 for a single backend / single migration path,
  naming the Phase 1 runner as the authoritative mechanism (replacing `prisma db push`).
- [ ] 5.2 Update the PR/contribution checklist to drop the triplicated-schema and dual-backend-parity
  rules and replace them with the single-backend equivalents.
- [ ] 5.3 Update `workers/README.md` (remove the "reuse 100% of the backend via express-adapter" framing;
  document the Worker as the sole API, the local-dev-on-Postgres flow, and where jobs/scripts now live).
- [ ] 5.3a Update or explicitly retire all dual-environment/Express/SQLite guidance in root `README.md`,
  `AGENTS.md`, `docs/` developer, environment, QA, troubleshooting, security, deployment, backup and
  operational runbooks. Rehome still-valid material from `backend/docs/` before deleting the directory.
- [ ] 5.4 `npx openspec validate retire-express-unify-on-postgres --strict`.
- [ ] 5.5 Archive this change once merged and live.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---:|---|---|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | Optional; no product expansion proposed |
| Codex Review | review feedback | Independent review | 2 | Addressed | (1) Migration ownership + full backend audit added; (2) staged engine-swap identified as throwaway — plan re-sequenced to direct retirement |
| Eng Review | `/plan-eng-review` | Architecture & tests | 1 | Issues open | Consolidated gaps documented; Phase 0 trigger + approvals unresolved |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | Not applicable | Infrastructure/backend consolidation |
| DX Review | `/plan-devex-review` | Developer experience | 0 | Covered here | Local DB, CI, commands, rollback, and docs included |

- **RESOLVED:** staged-versus-direct retirement sequence — **direct path chosen** (no transitional
  Express-on-Postgres state; SQLite retained as rollback until deletion); measurable friction trigger
  (0.1, met by #390/#394); sole-Worker product approval (0.2, approved 2026-07-24).
- **UNRESOLVED:** local/CI database choice confirmation (0.3 — recommendation drafted) and the final
  go/no-go record (0.4).
- **VERDICT:** two of the four Phase 0 blockers cleared; implementation stays paused until 0.3 is
  confirmed and 0.4 records go/no-go. Strict OpenSpec validation is required after every further edit.
