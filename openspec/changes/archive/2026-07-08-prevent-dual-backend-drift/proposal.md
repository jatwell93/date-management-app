# Proposal: Prevent dual-backend logic drift (shared constants + conformance tests)

## Why

The app runs the same domain logic twice: `workers/` (Cloudflare Workers + Neon **PostgreSQL**, the
production edge API) and `backend/` (Express + **SQLite** via better-sqlite3, used for local dev and
the Node test path). Each reimplements the same report/disposition queries in a different SQL dialect
with **no shared contract**, so the two copies silently drift. This has now caused four separate
defects in one feature area in a single week:

1. **Report-zeros bug** — the summary counts filtered on a stored `status = 'Markdown N'` that the app
   never writes, returning `0`; fixed by switching both copies to date-window math
   (`fix-expiry-summary-workers-contract`).
2. **Markdown threshold split** — `backend/src/services/inventory-markdown.helpers.ts`
   (`INVENTORY_MARKDOWN_THRESHOLDS` 30/60/90) vs the report windows; reconciled in
   `track-markdown-action-lifecycle`.
3. **Sold-through reappearing** — `getDetailedExpiryReport` had no terminal-status filter, and the two
   backends snapshot _different_ post-disposition statuses (`workers/src/database.ts:798`
   sets `'Sold Through'`; `backend/src/services/expired-item.service.ts:189` sets `'Processed'`), so a
   one-backend filter would only half-fix it. Required `NOT IN ('Processed', 'Sold Through')` in both
   (PR #258).
4. **NULLS ordering split** — the sell-through query used a bare `ORDER BY markdown_level ASC`; Postgres
   sorts NULL last, SQLite sorts NULL first, so cards rendered in a different order in prod vs dev
   (PR #258).

The root cause is identical every time: **duplicated domain logic with duplicated magic values and no
test that compares the two implementations.** A code reviewer (human or bot) catches these one at a
time, after they ship. This change addresses the _class_, not another instance.

## Analysis

**Current — duplication with an existing shared seam:**

- `shared/types/subscription.ts` is already imported by **both** backends
  (`workers/src/utils/auth.ts:20`, `backend/src/types/subscription.ts:17`) and is on the backend
  `tsconfig` include path (`backend/tsconfig.json:17`). So a cross-backend shared module is a
  **proven, existing pattern** — not new infrastructure.
- Drift-prone values are currently hardcoded as string/number literals in each backend independently:
  - Post-disposition status strings: `'Sold Through'` / `'Processed'` / `'Expired'`
    (`workers/src/database.ts:798`, `backend/src/services/expired-item.service.ts:189`).
  - Markdown day-windows (30/60/90) and the price ladder, duplicated across
    `frontend/src/lib/utils.ts`, the report queries, and `inventory-markdown.helpers.ts`.
- A real-SQL harness already exists for the production path: `@electric-sql/pglite` in-process Postgres
  (`workers/src/__tests__/pglite-db.ts`, `npm run test:db`). The backend has its own in-memory
  better-sqlite3 tests (`backend/src/tests/unit/report.repository.test.ts`). They test the **same**
  queries against **different** engines but never compare outputs to each other.

**Gaps (the scope):**

1. No single source of truth for the cross-backend domain constants, so the two SQL copies drift on
   literals (status strings, windows).
2. No **conformance test** that feeds identical seed data through both engines and asserts identical
   results — including row **ordering** — for the parity-critical queries. Ordering bugs in particular
   are invisible to any single-engine test.
3. No documented convention or PR-checklist rule that says "logic implemented in both backends must
   source shared constants and have a conformance test," so the pattern won't stick.

**Related manifestation — schema/migration triplication (same class, one layer down):**
The same "one logical change, maintained by hand in N places, with nothing comparing them" pattern
also appears at the schema layer. A single column change is expressed in **three** places:
`backend/prisma/schema.prisma` (applied to Neon in production via `npm run migrate:prod` →
`prisma db push`), a hand-written `backend/prisma/neon-sql/NNNN_*.sql` (+ `_rollback.sql`)
intended for the Neon SQL editor, and a runtime migration in `backend/src/migrations/` (intended to run via
`npm run migrate` — currently a no-op, see symptoms below). These are three paths to the same end
state with no check that they agree — e.g.
`markdownLevel` from `track-markdown-action-lifecycle` lives in all three
(`schema.prisma:320`, `neon-sql/0002_add_markdown_level_to_expired_item_transactions.sql`, runtime
migration id 9). If the hand-written `neon/*.sql` ever disagrees with `schema.prisma`, `prisma db
push` silently wins and the `.sql` file becomes a lie. This change's **convention pillar** (Phase 3)
should name this triplication explicitly so dual-backend schema changes are kept in sync the same way
domain constants are; reconciling or de-duplicating the three migration mechanisms themselves is a
larger effort left to a follow-up.

**Concrete symptoms observed while diagnosing the markdown_level rollout (2026-06-22):**

- **The `neon/` folder used to be inside `prisma/migrations/`**, so Prisma treated it as a phantom migration
  named `neon` (`prisma migrate status` lists it as "not yet applied"). Running `prisma migrate
deploy` would try to apply it and fail. Remediation: move the hand-written Neon SQL out of the
  Prisma migrations tree (`prisma/neon-sql/`).
- **`npm run migrate` is a no-op:** `backend/src/migrations/migrate.ts` exports `runMigrations` but
  never calls it (no `require.main === module` guard / invocation), so the documented local-sync
  command silently does nothing. Migrations only actually run when the server boots or the function
  is invoked directly. Remediation: invoke `runMigrations()` when the file is run as a script.
- **Two divergent local SQLite files:** the runtime/repository path uses `DATABASE_PATH` →
  `backend/database.sqlite` (better-sqlite3), while Prisma uses `DATABASE_URL=file:./database.sqlite`
  → `backend/prisma/database.sqlite`. They drift independently — at diagnosis time the runtime DB
  was missing `markdown_level` and the Prisma DB still is. Remediation: point both mechanisms at one
  local file, or document clearly which is authoritative for what.

**Explicitly out of scope (handled elsewhere / deliberately not done):**

- Reconciling the markdown **price multipliers** is the sibling change
  `reconcile-markdown-price-multipliers`; this change only provides the shared-constant _home_ it
  should land in.
- **Not** collapsing the two backends into one, and **not** building a generic cross-dialect SQL
  query builder — both are large refactors disproportionate to the problem. The status strings stay
  intentionally distinct values (changing the backend's historical `'Processed'` rows is a data
  migration we are not taking on here); the shared module captures the **set** both must filter on,
  so the filter can't drift again.

## Reuse Strategy

- **Extend the existing `shared/` module**, mirroring `shared/types/subscription.ts`: add a
  `shared/domain/markdown.ts` (day-windows / level bucketing) and `shared/domain/disposition.ts`
  (post-disposition status strings + the `DISPOSITIONED_STATUSES` set used by the worklist filter).
  Both backends import via the same relative-path pattern already in use.
- **Reuse both existing test harnesses.** The conformance suite drives the _real_ report/disposition
  methods of each backend — `createWorkersDatabase` over pglite (as in
  `workers/src/database.worklist.pglite.node.test.ts`) and `ReportRepository` over better-sqlite3 (as
  in `backend/src/tests/unit/report.repository.test.ts`) — seeds identical fixtures into each, and
  asserts deep-equality of the results.
- **Refactor in place, no behavior change.** Replace the literals in the existing queries/services with
  the shared constants; the SQL stays otherwise identical, so this is a safe, test-guarded refactor.
- **Document the rule** in `openspec/project.md` (Golden Rules) and the AGENTS.md PR checklist so future
  dual-backend work follows it.

## Implementation Steps

Phase 1 — Shared domain constants (foundation)

1. Add `shared/domain/disposition.ts`: the post-disposition status strings and a
   `DISPOSITIONED_STATUSES` set; add `shared/domain/markdown.ts`: the day-window bucketing
   (Markdown 1 = 61-90, 2 = 31-60, 3 = 0-30) as the single source of truth.
2. Replace the hardcoded literals with these constants in `workers/src/database.ts` and
   `backend/src/{repositories,services}` (status filter in `getDetailedExpiryReport`,
   `processExpiredItem` status write, the report windows). No SQL/behavior change — green tests prove it.

Phase 2 — Cross-backend conformance tests 3. Add a conformance suite that seeds identical data into the pglite (Postgres) and better-sqlite3
paths and asserts **identical** results for the parity-critical queries: detailed expiry worklist,
the summary counts, and sell-through-by-markdown-level — asserting row order, not just membership,
so the NULLS-ordering class is caught automatically. 4. Add a regression case per past defect (zeros, threshold split, sold-through reappear, NULLS order)
so each historical bug is now permanently fenced.

Phase 3 — Make the convention stick 5. Add a "dual-backend parity" Golden Rule to `openspec/project.md` and a checklist line to AGENTS.md:
any logic present in both backends sources shared constants and has a conformance test. 6. Run completion checks (`npm run lint`, backend jest, `npm run test:db`, `openspec validate --all`).
