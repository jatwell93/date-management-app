# Tasks: Retire Express, Prisma, and SQLite — unify on the Worker + Postgres

> **Phase 0 Decision Gate: CLEARED — GO (2026-07-24).** Phase 1 (migration foundation) may begin;
> Phases 3–4 (Worker parity, deletion) stay gated on Phases 1–2, and each production cutover keeps its
> own verification/rollback gate.
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
- [x] 0.3 Local/CI DB story — **CONFIRMED (2026-07-24)** by the product owner (jatwell93):
  - Express dev/test → stays on **SQLite, untouched** until deletion (the rollback backend; no new local DB).
  - Worker + conformance tests → **pglite** (already a dependency).
  - Worker local dev → `wrangler dev` against a developer-owned **Neon branch**. PGlite remains the
    offline test/conformance engine; it is not claimed as a `wrangler dev` database adapter.
  - Migration-runner PR CI → an ephemeral PostgreSQL service with **no production secrets**. A separate
    scheduled job uses an isolated, auto-created Neon branch to exercise provider-specific behaviour.
  - No local Docker or heavyweight local Postgres server is required; hosted CI may use a service
    container internally.
- [x] 0.4 Go/no-go — **GO (2026-07-24)**. All Phase 0 prerequisites are recorded (0.1 trigger met, 0.2
      sole-Worker approved, 0.3 DB story confirmed, sequencing resolved to the direct path). **Phase 1
      (migration foundation) is unparked and may begin.** Phases 3–4 (Worker parity, deletion) remain gated
      on Phases 1–2 completing, and every production cutover keeps its own verification/rollback gate.

## Phase 1 — Establish the authoritative PostgreSQL migration foundation (before anything is deleted)

> Highest-priority, highest-value work: it replaces the single most load-bearing thing Prisma owns
> (`npm run migrate:prod`), survives regardless of the rest, and directly de-risks production. After
> task 1.1 captures the current migration contract, the remaining work may run in parallel with the
> Phase 2 audit.

- [x] 1.1 Inventory **all backend-owned migration scripts** before choosing their replacement:
      `migrate-production-doppler.js` (the authoritative `npm run migrate:prod`),
      `migrate-production-simple.js`, `migrate-production.ts`, `migrate.js`, `verify-migration.js`,
      `list-migrations.ts`, plus the runtime SQLite migration runner
      (`backend/src/migrations/{migrate.ts,migration.service.ts,migration.model.ts}` and the numbered
      `*-*.migration.ts` files). Record the current production command's full contract—schema push,
      required tier/reference seed, and post-migration verification—and mark every script **replace, do
      not delete** until the successor reproduces or explicitly retires its responsibility. **Captured in
      `design.md` under “Phase 1.1 migration ownership inventory” (2026-07-24), including the additional
      migration/backfill and preflight executables, every package migration/reset entry point, all 19
      active embedded SQLite migrations, four standalone numbered files, supporting seed/preflight
      dependencies, and the complete contents of both backend-owned SQL-history families.**
- [x] 1.2 Choose an executable Postgres migration runner for Neon that does **not** depend on Prisma.
      Relocate `backend/prisma/neon-sql/*.sql` to a permanent path outside `backend/` and promote the
      relocated files—not the runner alone—to the authoritative migration history. Require forward
      migration plus an explicit recovery mechanism appropriate to each migration's declared
      reversibility/data-loss class, an applied-migration ledger with identity/checksum validation,
      ordering checks, and explicit transaction rules. Use a dedicated `schema_migrations` ledger;
      reconcile/retain the legacy `migrations` table. Acquire a PostgreSQL advisory lock, make
      transactional DDL plus ledger write atomic, bound lock/statement timeouts, and define resume/repair
      for explicit non-transactional migrations. **Implemented at the repo root with `pg`
      (`src/database/migrations/`), with the authoritative history and strict manifest relocated to
      `database/migrations/`. Focused contract tests cover ordering, undeclared/missing files, checksums,
      locking, atomic rollback, and interrupted non-transactional state. Every inherited down is explicitly
      manual-only/destructive; 0004 is partial. The legacy `migrations` table is retained but not
      reinterpreted, and the apply CLI remains fail-closed until task 1.3 installs the canonical baseline.**
- [ ] 1.3 Build a canonical PostgreSQL baseline because the current Neon SQL series assumes an older
      schema already exists. Prove empty database → baseline → all migrations → latest schema fingerprint,
      covering tables, columns, constraints, indexes, defaults, functions, checks, and partial indexes.
- [ ] 1.4 Build an explicit one-time adoption command for the existing production-shaped database.
      `adopt --dry-run` performs read-only catalog-definition checks, refuses mismatches, emits a reviewable
      report, and only a separate approved adoption stamps baseline/checksum metadata. Adoption never treats
      "object already exists" as proof the object is correct.
- [ ] 1.5 Provide separate ordered commands outside `backend/` for migration status/preflight/apply,
      required idempotent reference-data seed, and schema/data verification. Require a dedicated DDL
      migration role, allowlisted target identity, redacted output, explicit production confirmation,
      and rejection of development/restore/pooled application targets.
- [ ] 1.6 Prove the runner end-to-end against isolated PostgreSQL/Neon targets: fresh install,
      existing-schema adoption, concurrent invocation refusal, interruption/recovery, checksum/catalog
      drift, safe down migration, forward fix, Worker rollback with expanded schema, and restore recovery.
      **Perform at least one real schema change with a working rollback on a Neon dev branch** — this is the
      gate that lets Prisma be removed in Phase 4.
- [ ] 1.7 Integrate migrations into deployment: validate history; store dry-run/status output as an
      artifact; verify Neon PITR/backup readiness; apply expand-compatible schema; verify postconditions;
      seed/verify prerequisites; deploy Worker; run real database readiness plus schema-dependent smoke
      tests; observe a canary window with explicit stop/rollback thresholds. Migration-only changes must
      trigger this workflow, and manual deploy commands must not bypass compatibility checks.
- [ ] 1.8 Require expand/migrate/contract metadata for every schema change, including compatibility,
      reversibility/data-loss class, backfill/resume plan, and the later contract deployment. Do not use
      destructive down migrations as the default rollback.
- [ ] 1.9 Verify production recovery before first migration: active Neon retention/PITR, named
      pre-migration recovery point, restore-to-new-branch drill, application verification, RPO/RTO, and
      responsible operator.
- [ ] 1.10 Add structured migration logs/status and alerts for failure, advisory-lock timeout, checksum
      mismatch, drift, duration, target identity, migration ID, and deployment SHA. Make Worker health
      execute a real database readiness query and verify Cloudflare observability/Sentry are enabled.
- [ ] 1.11 Document the new authoritative path and its recovery policies (the golden-rule rewrite itself lands in
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
- [ ] 2.5 Produce a single **rehoming checklist** mapping every endpoint, test, job, script, and the
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
- [ ] 3.8 Before implementation, record the currently registered production Stripe endpoint, the
      deployment that receives it, and the exact rollback target; do not assume the undeployed Express
      reference backend is reachable. Then cut Stripe webhooks over as a production change: add typed
      secret/config, raw-byte signature verification, supported-event contract, durable event
      idempotency/replay handling, Stripe endpoint registration, shadow/dev verification, monitored
      cutover, and rollback. Keep a deployable rollback receiver—normally the previous Worker
      deployment/route, or a deliberately temporary receiver—until Stripe delivery to the new Worker
      handler is confirmed.
- [ ] 3.9 Add one required database-conformance workflow triggered by `workers/**`, `shared/**`,
      authoritative migrations/schemas, and relevant root package/lock files. Run the Worker PGlite
      conformance job and the migration-runner job against an ephemeral PostgreSQL service with no
      production secrets; combine them in an always-reporting required gate. Fail rather than skip when
      the database is unavailable. Add a separate scheduled compatibility job against an isolated,
      auto-created Neon branch with guaranteed cleanup.

## Phase 4 — Delete Express + Prisma + SQLite together (gated on Phases 1–3)

- [ ] 4.0 Tag the last Express+SQLite-capable revision immediately before the retirement commit so the
      fallback is recoverable by `git revert`/checkout if a post-deletion regression appears. Document and
      test the exact recovery commands while the tagged revision is still present.
- [ ] 4.1 **Only once the rehoming checklist (2.5) is fully satisfied and the Phase 1 runner has proven a
      real reversible schema change and its down path (1.6)**, remove `backend/` in one controlled retirement: the Express
      server, Prisma client, `better-sqlite3`, the Prisma **base** (SQLite) schema, the runtime
      `src/migrations/` SQLite migration runner (`migrate.ts`, `migration.service.ts`, `migration.model.ts`,
      numbered `*-*.migration.ts`), and the Prisma **production** schema. Delete only the obsolete copies of
      Neon SQL after their history/checksums have been preserved in the authoritative Phase 1 location.
      **Also delete** `workers/src/index.ts` and `workers/src/express-adapter.ts` (the abandoned
      express-adapter entry point — `index-minimal.ts` is the real one).
- [ ] 4.2 Prune dependencies and scripts from the workspace: remove `express`, `@prisma/*`,
      `better-sqlite3`, and the backend Vitest project from `package.json` files (root, `backend/`, and any
      workspace-level). Remove the now-dead npm scripts (`migrate:prod`, `dev:backend`, `seed:*`, the
      superseded migration scripts from 1.1, etc.). Retire `.github/workflows/backend-test.yml` — its
      multi-tenant coverage (cross-tenant isolation, penetration, concurrency, feature-gate enforcement) is
      already rehomed onto the Worker suite in Phase 3.2, so removing it loses nothing.

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

| Review        | Trigger               | Why                  | Runs | Status         | Findings                                                                                                                                        |
| ------------- | --------------------- | -------------------- | ---: | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| CEO Review    | `/plan-ceo-review`    | Scope & strategy     |    0 | —              | Optional; no product expansion proposed                                                                                                         |
| Codex Review  | review feedback       | Independent review   |    2 | Addressed      | (1) Migration ownership + full backend audit added; (2) staged engine-swap identified as throwaway — plan re-sequenced to direct retirement     |
| Eng Review    | `/plan-eng-review`    | Architecture & tests |    1 | Addressed      | Phase 0 decisions cleared; migration dependency, CI target, Stripe rollback topology, recovery semantics, and deletion checkpoint made explicit |
| Design Review | `/plan-design-review` | UI/UX gaps           |    0 | Not applicable | Infrastructure/backend consolidation                                                                                                            |
| DX Review     | `/plan-devex-review`  | Developer experience |    0 | Covered here   | Local DB, CI, commands, rollback, and docs included                                                                                             |

- **RESOLVED:** staged-versus-direct retirement sequence (direct path); measurable friction trigger
  (0.1, met by #390/#394); sole-Worker product approval (0.2, 2026-07-24); local/CI database story
  (0.3, 2026-07-24); go/no-go (0.4, **GO** 2026-07-24).
- **UNRESOLVED:** none in Phase 0.
- **VERDICT:** **Phase 0 Decision Gate cleared — GO.** Phase 1 (migration foundation) is unparked;
  Phases 3–4 remain gated on Phases 1–2. Strict OpenSpec validation is required after every further
  edit, and each production cutover retains its own verification/rollback gate.
