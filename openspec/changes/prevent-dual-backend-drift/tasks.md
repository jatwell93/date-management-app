# Tasks: Prevent dual-backend logic drift

## Phase 1 — Shared domain constants

- [x] 1.1 Add `shared/domain/disposition.ts` with post-disposition status strings and a
      `DISPOSITIONED_STATUSES` set (mirroring the `shared/types/subscription.ts` import pattern).
- [x] 1.2 Add `shared/domain/markdown.ts` with the day-window bucketing (Markdown 1 = 61-90,
      2 = 31-60, 3 = 0-30) as the single source of truth.
- [x] 1.3 Replace hardcoded status literals with the shared constants in
      `workers/src/database.ts` (`getDetailedExpiryReport` filter, `processExpiredItem` status write)
      and `backend/src/{repositories/report.repository.ts,services/expired-item.service.ts}`.
- [x] 1.4 Replace hardcoded markdown windows with the shared constant in the report queries and
      `backend/src/services/inventory-markdown.helpers.ts`.
- [x] 1.5 Run existing suites green (`npm run test:db`, backend jest) to prove the refactor is
      behavior-preserving.

## Phase 2 — Cross-backend conformance tests

- [x] 2.1 Add a conformance harness that seeds identical fixtures into the pglite (`createWorkersDatabase`)
      and better-sqlite3 (`ReportRepository`) paths.
- [x] 2.2 Assert deep-equality (rows AND order) for: detailed expiry worklist, summary counts,
      sell-through-by-markdown-level.
- [x] 2.3 Add a regression case per prior defect: zero counts, threshold split, sold-through
      reappearing, NULL ordering.
- [x] 2.4 Wire the conformance suite into the existing test scripts so CI runs it.

## Phase 3 — Make the convention stick

- [x] 3.1 Add a "dual-backend parity" Golden Rule to `openspec/project.md`.
- [x] 3.2 Add a PR-checklist line to `AGENTS.md` (shared constants + conformance test for dual-backend logic).
- [x] 3.3 Document the schema/migration triplication rule: a single column change kept in sync across
      `schema.prisma`, `prisma/neon-sql/*.sql` (+ rollback), and `src/migrations/` (runtime), and
      note which path is production-authoritative (`prisma db push` via `migrate:prod`). Add to the same
      Golden Rule / PR checklist.
- [ ] 3.4 Run completion checks: `npm run lint`, backend jest, `npm run test:db`,
      `openspec validate --all`.

## Phase 4 — Migration-mechanism quick wins (concrete remediations found 2026-06-22)

- [x] 4.1 Move the hand-written Neon SQL out of `prisma/migrations/` (e.g. to `prisma/neon-sql/`) so
      Prisma stops treating `neon` as a phantom migration and `prisma migrate deploy` is unblocked.
- [x] 4.2 Fix `backend/src/migrations/migrate.ts` to actually invoke `runMigrations()` when run as a
      script (guard with `require.main === module`), so `npm run migrate` is no longer a no-op.
      Also add `import 'reflect-metadata'` as the first line: migration 006 pulls in
      `inventory.service` (tsyringe DI), which the server loads via `index.ts` but the standalone
      CLI did not — without it `npm run migrate` runs and then crashes on a fresh database. Covered
      by a behavioral test (`backend/src/tests/unit/migrate-entrypoint.test.ts`) that runs the real
      script as a subprocess against a temp DB and asserts the schema was created.
- [x] 4.3 Resolve the two divergent local SQLite files (runtime `DATABASE_PATH` →
      `backend/database.sqlite` vs Prisma `DATABASE_URL` → `backend/prisma/database.sqlite`): point both
      at one file or document which is authoritative.

## Known issues / follow-ups

- **`tsc -p workers/tsconfig.json` reports ~52 `TS1206` "Decorators are not valid here" errors.**
  These come from `backend/` repositories/services (tsyringe decorators), not from workers code. They
  surface only because `workers/src/database.conformance.node.test.ts` imports `ReportRepository` from
  `backend/src/`, bridging the backend source into the workers TS program, where the decorator emit
  settings differ from the backend's own tsconfig.
  - **Not a CI failure / not blocking:** the workers typecheck gate is `npm run lint` →
    `tsc --noEmit -p tsconfig.deploy.json`, which excludes test files and passes clean. `npm run test:db`
    (vitest, transpile-only) also passes. The errors appear only with the non-deploy `tsconfig.json`,
    which is not wired into any check.
  - **Pre-existing:** introduced with the conformance test's cross-backend import, independent of the
    #1–#4 review fixes.
  - **If we ever wire `tsconfig.json` into a check** (full-project typecheck/IDE strictness), options:
    (a) give the conformance test a dedicated tsconfig that aligns `experimentalDecorators` /
    `emitDecoratorMetadata` with the backend, (b) exclude `*.node.test.ts` from the base `tsconfig.json`
    include the way `tsconfig.deploy.json` does, or (c) import the backend repo through a type-only/seam
    that doesn't drag the decorated classes into the workers program.
