# Proposal: Store-walk bay-check tracking (floor progress + audit)

## Why

Stores run an **expiry-check circuit**: a staff member walks the retail floor bay by bay,
checking use-by dates. Today this is coordinated on a **printed floorplan** — you highlight a bay
and initial it so the team knows where the walk is up to and can move straight to the next bay. The
app has no equivalent, so "where are we up to" lives on paper and there is no trustworthy record of
who checked what.

The data model is already *most* of the way there but is missing the key primitive. `StoreArea`
carries a single `lastChecked` timestamp (`backend/prisma/schema.prisma:193`) — it stores the
*answer* ("when was this last checked") but throws away the *event* that produced it (who, exactly
when, which walk). Every workaround a user might reach for — a fake far-future "marker" product to
tag the end of a bay, or inferring the last-checked bay from the newest `InventoryItem.createdAt` —
is a symptom of that missing event. Those break the moment a bay is checked and **nothing new is
added**, which is common.

## What changes

Model the missing primitive: a **bay check is a first-class event**, independent of whether any
product was added. `StoreArea.lastChecked` is demoted to a derived cache; the event log becomes the
source of truth. On top of it sit repeatable **check cycles** (one full store walk) and a live
**floor-progress** view that replaces the printed floorplan.

Decisions locked with the product owner:

- **Whole-bay granularity.** One tap = "Bay 3 checked." Category stays a reporting attribute, never
  a checklist unit — stores are laid out spatially (bays), not taxonomically, and a bay routinely
  spans parts of several categories.
- **Repeatable cycles.** A full circuit is a named `CheckCycle` ("July walk") so the app can answer
  "are we done with *this* walk?" and measure coverage %, not just show a stale per-bay date.
- **Mostly-online.** Bay checks are ordinary server-side writes. Offline queueing via
  `frontend/src/lib/offline-sync.ts` is **out of scope** for v1.

## Scope (v1)

- **Department → Bay hierarchy.** `StoreArea` gains a nullable self-reference `parentId`. Departments
  are parent rows; bays are leaf rows. `InventoryItem.locationId` keeps pointing at the **bay
  (leaf)**, so no existing inventory rows move. Existing flat areas are backfilled as bays under a
  synthesized department (derived from `subDepartment` where present, else an "Unassigned"
  department).
- **`CheckCycle`** — one row per store walk (`name`, `status` active/completed, `startedAt`,
  `completedAt`). Typically one active cycle per org at a time.
- **`BayCheck`** — the event log (`cycleId`, `storeAreaId` = bay, `userId`, `checkedAt`,
  `itemsAddedCount`, optional `notes`). One tap on the floor = one row.
- **Endpoints** (workers + backend parity): manage cycles (create / list / complete), record a bay
  check, and a **floor-progress** read that returns each bay's check state for the active cycle.
- **Floor Progress view** — bays grouped by department, colored checked-this-cycle / not-yet /
  overdue, with the checker's name + time; tapping a bay records a `BayCheck`.
- **Audit** — extend `frontend/src/pages/UsageReportPage.tsx` with per-user coverage %, bays/hour,
  cycle completion time, and an implausible-pace / all-zero-findings red flag.

## Analysis

**Where today's tracking lives.**
- `StoreArea` (`backend/prisma/schema.prisma:188-203`) — flat `name` + nullable `subDepartment` +
  `lastChecked`; unique on `(organizationId, name, subDepartment)`.
- Workers CRUD in `workers/src/handlers/store-areas.ts`; backend equivalents in
  `store-area.{repository,service,controller,routes}.ts`; frontend in
  `frontend/src/pages/StoreAreaManagementPage.tsx`.
- `InventoryItem.locationId → StoreArea` (`schema.prisma:169,175`) — the bay link we preserve.
- `AuditLog` and `ItemTransaction` already record `userId` + timestamp for item edits, so the
  who/when pattern is established; bay checks add the *location-level* event that is missing.

**Config / event home.** Per the multi-tenant golden rules (org-scoped, `organizationId` from auth
only, cascade delete), cycles and checks are new org-scoped tables, not JSON blobs. Defaults preserve
current behavior: no cycle and no checks means the floor view simply shows every bay as "not yet
checked," and `lastChecked` continues to display exactly as it does today.

## Reuse Strategy

- **Extend `StoreArea`, don't fork it.** Add `parentId` as a nullable self-relation; a null parent =
  department, a set parent = bay. Existing single-level areas remain valid rows (backfilled as bays),
  so current CRUD keeps working.
- **Derive cycle/bay state in shared code.** Put the "is this bay checked in the active cycle?" and
  coverage-rollup logic in `shared/domain/*` so workers (Postgres/pglite) and backend (SQLite)
  produce identical results, covered by a conformance test (golden rule 5) — the same parity pattern
  the markdown-matrix change used.
- **`lastChecked` becomes a derived cache**, written from the latest `BayCheck.checkedAt`. No reader
  of `lastChecked` has to change; the event log just becomes its authoritative source.
- **Schema stays triplicated** (golden rule 6): Prisma (base + production), Neon SQL `0004` +
  rollback, and runtime SQLite migrations `012`/`013`/`014`; pglite harness
  (`workers/src/__tests__/pglite-db.ts`) updated for parity.

## Guardrails

- A `BayCheck.storeAreaId` MUST reference a **leaf bay** (a `StoreArea` with a non-null `parentId`),
  never a department — validated server-side.
- At most **one active `CheckCycle` per organization**; recording a bay check requires an active
  cycle. Enforced in the service layer (and a partial unique index where the backend supports it).
- All new endpoints are org-scoped with `organizationId` derived from auth, never the client payload
  (golden rule 1); cascade delete on every new FK (golden rule 3).
- `itemsAddedCount` is a denormalized counter written at check time so audit red-flags (many bays,
  zero findings) don't require scanning the inventory table.

## Deferred Follow-up

- **Offline bay checks** (queue + sync via `offline-sync.ts`) — deferred; v1 is mostly-online.
- **Sub-bay / category-level checks** and **partial-bay notes as structured data** — v1 is whole-bay.
- **Configurable "overdue" thresholds** and scheduled/auto-created cycles — v1 creates cycles
  manually.
- **A visual drag-to-place floorplan map** — v1 lists bays grouped by department; spatial coordinates
  are a later enhancement.

## Implementation Steps

1. Shared domain: `CheckCycleStatus`, bay-state + coverage rollup helpers with a single resolver
   used by both backends.
2. Schema (triplicated): `StoreArea.parentId`, `CheckCycle`, `BayCheck` in Prisma (base +
   production), Neon SQL `0004` (+ rollback) with FK/CHECK constraints and the one-active-cycle
   partial index, and runtime SQLite migrations `012`/`013`/`014`; update the pglite harness.
3. Backfill: existing flat `StoreArea` rows become bays under a synthesized department per org.
4. Workers: cycle + bay-check + floor-progress handlers in `store-areas.ts` (with retry wrappers),
   writing the derived `lastChecked` on each check.
5. Backend: repository/service/controller/routes parity for cycles, bay checks, and floor progress;
   validation (leaf-only, active-cycle-required); mounted in `index.ts`.
6. Frontend: Floor Progress view (bays by department, tap-to-check, cycle progress bar); cycle
   start/complete controls; extend `UsageReportPage` with coverage / throughput / red-flags.
7. Tests: shared-domain unit tests, dual-backend conformance for bay-state + coverage, worker +
   backend route/validation tests, frontend floor-progress + audit tests.
8. Completion checks: backend + frontend lint, affected tests, `tsc`, and
   `npx openspec validate add-store-walk-bay-tracking --strict`.
