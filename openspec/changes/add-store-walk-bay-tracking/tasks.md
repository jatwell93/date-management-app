## Tasks

### Shared domain
- [x] Add `CheckCycleStatus` (`active` | `completed`) and `BayCheckState` (`checked` | `not_checked` | `overdue`) types to `shared/domain/`.
- [x] Add `resolveBayState(bay, checksForCycle)` and `rollupCoverage(bays, checksForCycle)` pure helpers used by both backends.
- [x] Unit tests: bay with a check in the active cycle = checked; no check = not_checked; check only in a prior cycle = overdue; coverage % rollup per department and store.

### Schema (triplicated — golden rule 6)
- [x] Prisma (base + `production/schema.prisma`): add `StoreArea.parentId Int? @map("parent_id")` self-relation (`parent`/`children`); add `CheckCycle` and `BayCheck` models — org-scoped, cascade delete, `userId` SetNull, indexes on `(organizationId)`, `(cycleId)`, `(storeAreaId)`, `(checkedAt)`.
- [x] Neon SQL `0004_add_store_walk_bay_tracking.sql` (+ rollback): `store_areas.parent_id` FK; `check_cycles`, `bay_checks` tables; FKs, status/leaf `CHECK`s, and partial unique index `one_active_cycle_per_org`.
- [x] Runtime SQLite migrations `012-add-parent-id-to-store-areas`, `013-add-check-cycles-table`, `014-add-bay-checks-table` in `backend/src/migrations/migration.service.ts`.
- [x] Update pglite harness (`workers/src/__tests__/pglite-db.ts`) with the new columns/tables for parity.

### Backfill
- [x] Idempotent, org-scoped backfill: create a department `StoreArea` per distinct `subDepartment` (plus an "Unassigned" department for null), then set each existing flat area's `parentId`. Existing area ids (and all `InventoryItem.locationId` refs) unchanged.

### Workers (Postgres) — parity
- [x] `store-areas.ts` handlers (with `withNeonRetry`): create/list/complete `CheckCycle`; record `BayCheck` (validates active cycle + leaf bay, writes derived `lastChecked`); floor-progress read grouped by department using the shared resolver.
- [x] Worker tests (pglite): cycle lifecycle, bay-check insert updates `lastChecked`, leaf-only + active-cycle-required rejections, floor-progress shape.

### Backend (SQLite) — parity
- [x] `store-area` (or new `check-cycle`/`bay-check`) repository + service: cycle CRUD, `recordBayCheck`, `getFloorProgress`; single-active-cycle + leaf-only validation; derived `lastChecked` write.
- [x] Zod validation schemas; admin/manager gating per existing RBAC; org from auth only (golden rule 1).
- [x] Controller + routes mounted in `index.ts`.
- [x] Backend route/validation/service unit tests (cycle lifecycle, leaf rejection, no-active-cycle rejection, coverage read).

### Dual-backend conformance (golden rule 5)
- [ ] Conformance test comparing floor-progress / coverage output (including row order) across Postgres/pglite and SQLite via the shared resolver.

### Frontend
- [ ] Floor Progress view: bays grouped by department, colored checked-this-cycle / not-yet / overdue with checker name + time; tap a bay to record a `BayCheck`; cycle progress bar (dept + store %).
- [ ] Cycle controls: start a new walk, complete the active walk; empty/no-active-cycle states.
- [ ] Extend `StoreAreaManagementPage.tsx` to assign a bay's parent department.
- [ ] Extend `UsageReportPage.tsx`: per-user coverage %, bays/hour, cycle completion time, implausible-pace / all-zero-findings red flags.
- [ ] Frontend tests: floor-progress render + tap-to-check, cycle start/complete, audit metrics.

### Completion checks
- [ ] Backend + frontend lint and `tsc` clean for new files.
- [ ] Affected worker + backend + frontend tests pass.
- [ ] `npx openspec validate add-store-walk-bay-tracking --strict` passes.
