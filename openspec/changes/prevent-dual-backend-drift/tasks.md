# Tasks: Prevent dual-backend logic drift

## Phase 1 — Shared domain constants
- [ ] 1.1 Add `shared/domain/disposition.ts` with post-disposition status strings and a
      `DISPOSITIONED_STATUSES` set (mirroring the `shared/types/subscription.ts` import pattern).
- [ ] 1.2 Add `shared/domain/markdown.ts` with the day-window bucketing (Markdown 1 = 61-90,
      2 = 31-60, 3 = 0-30) as the single source of truth.
- [ ] 1.3 Replace hardcoded status literals with the shared constants in
      `workers/src/database.ts` (`getDetailedExpiryReport` filter, `processExpiredItem` status write)
      and `backend/src/{repositories/report.repository.ts,services/expired-item.service.ts}`.
- [ ] 1.4 Replace hardcoded markdown windows with the shared constant in the report queries and
      `backend/src/services/inventory-markdown.helpers.ts`.
- [ ] 1.5 Run existing suites green (`npm run test:db`, backend jest) to prove the refactor is
      behavior-preserving.

## Phase 2 — Cross-backend conformance tests
- [ ] 2.1 Add a conformance harness that seeds identical fixtures into the pglite (`createWorkersDatabase`)
      and better-sqlite3 (`ReportRepository`) paths.
- [ ] 2.2 Assert deep-equality (rows AND order) for: detailed expiry worklist, summary counts,
      sell-through-by-markdown-level.
- [ ] 2.3 Add a regression case per prior defect: zero counts, threshold split, sold-through
      reappearing, NULL ordering.
- [ ] 2.4 Wire the conformance suite into the existing test scripts so CI runs it.

## Phase 3 — Make the convention stick
- [ ] 3.1 Add a "dual-backend parity" Golden Rule to `openspec/project.md`.
- [ ] 3.2 Add a PR-checklist line to `AGENTS.md` (shared constants + conformance test for dual-backend logic).
- [ ] 3.3 Document the schema/migration triplication rule: a single column change kept in sync across
      `schema.prisma`, `prisma/migrations/neon/*.sql` (+ rollback), and `src/migrations/` (runtime), and
      note which path is production-authoritative (`prisma db push` via `migrate:prod`). Add to the same
      Golden Rule / PR checklist.
- [ ] 3.4 Run completion checks: `npm run lint`, backend jest, `npm run test:db`,
      `openspec validate --all`.
