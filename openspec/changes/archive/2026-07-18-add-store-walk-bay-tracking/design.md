# Design: Store-walk bay-check tracking

## Context

The physical process is spatial and bay-driven; the schema stores only a derived `lastChecked`
timestamp per `StoreArea`. This design records the underlying **event** and layers **cycles** and a
**floor-progress** read on top, while preserving every existing reader of `StoreArea` and
`InventoryItem.locationId`.

## Data model

### `StoreArea.parentId` (self-relation)

```
StoreArea
  id
  parentId  Int?  -> StoreArea.id   // null = department, set = bay (leaf)
  ...existing fields (name, subDepartment, lastChecked)
```

- A **department** is a `StoreArea` with `parentId = null` and no inventory.
- A **bay** is a `StoreArea` with a non-null `parentId`; `InventoryItem.locationId` points here,
  unchanged.
- Existing unique key `(organizationId, name, subDepartment)` is retained; bays additionally sit
  under a parent. (No unique change is required for v1; names stay unique per org as today.)

**Why self-reference rather than a new `Department` table:** bays and departments share every
attribute (`name`, org scope, timestamps), inventory already targets `StoreArea`, and a self-relation
keeps existing CRUD, tenant filters, and the `locationId` FK working with zero data movement. A
separate table would force a migration of `InventoryItem.locationId` and duplicate the tenant plumbing.

### `CheckCycle`

```
CheckCycle
  id, organizationId
  name          // "July walk"
  status        // 'active' | 'completed'
  startedAt, completedAt?
```

At most one `active` cycle per org (service-enforced + partial unique index on Postgres). Completing a
cycle sets `status='completed'` and `completedAt`.

### `BayCheck`

```
BayCheck
  id, organizationId
  cycleId       -> CheckCycle.id   (cascade)
  storeAreaId   -> StoreArea.id    (must be a leaf bay)
  userId        -> User.id (SetNull, like AuditLog)
  checkedAt
  itemsAddedCount  // denormalized counter for audit
  notes?
```

One row per bay tap. On insert, the service also updates the bay's `StoreArea.lastChecked =
checkedAt` (derived cache). A bay is "checked this cycle" iff a `BayCheck` exists for
`(cycleId, storeAreaId)`.

## Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Check unit | Whole bay | Matches the paper floorplan; spatial not taxonomic. Product owner confirmed. |
| Cycles | First-class, repeatable | Enables "done with this walk?" + coverage %. Product owner confirmed. |
| Offline | Out of scope v1 | Mostly-online confirmed; plain server writes, no client IDs/conflict logic. |
| Department modeling | `StoreArea.parentId` self-relation | Preserves `locationId` FK + tenant plumbing; no inventory migration. |
| `lastChecked` | Derived cache of latest `BayCheck` | No existing reader changes; event log is source of truth. |
| Bay-state/coverage logic | `shared/domain/*` resolver | Dual-backend parity (golden rule 5) via one conformance test. |

## Triplicated schema plan (golden rule 6)

| Location | Change |
| --- | --- |
| `backend/prisma/schema.prisma` (+ `production/schema.prisma`) | `StoreArea.parentId` self-relation; `CheckCycle`, `BayCheck` models; relations + indexes + cascade. |
| `backend/prisma/neon-sql/0004_add_store_walk_bay_tracking.sql` (+ rollback) | `ALTER TABLE store_areas ADD parent_id`; `CREATE TABLE check_cycles`, `bay_checks`; FKs, `CHECK`/leaf constraints, partial unique index `one_active_cycle_per_org`. |
| `backend/src/migrations/migration.service.ts` | Runtime SQLite migrations `012` (parent_id), `013` (check_cycles), `014` (bay_checks). |
| `workers/src/__tests__/pglite-db.ts` | Mirror new columns/tables so pglite parity tests match Postgres. |

SQLite has no partial unique index parity with the Neon one — the single-active-cycle rule is
enforced in the service layer on both backends, with the Postgres partial index as defense in depth
(documented like the existing `uploads_one_active_catalogue_per_org` note in `schema.prisma`).

## Backfill

For each org: create one department `StoreArea` per distinct existing `subDepartment` (and an
"Unassigned" department for null), then set every existing (flat) area's `parentId` to the matching
department. Existing areas keep their `id`, so all `InventoryItem.locationId` references stay valid.
Idempotent and org-scoped.

## Dual-backend parity

The bay-state and coverage rollup are pure functions over `{ bays, checksForCycle }` in
`shared/domain/`. Both the workers floor-progress handler and the backend service call the same
resolver, so a single conformance test comparing Postgres/pglite vs SQLite outputs (including row
order) satisfies golden rule 5.

## Out of scope

Offline queueing, sub-bay/category checks, auto-scheduled cycles, configurable overdue thresholds,
and a coordinate-based visual floorplan (see proposal "Deferred Follow-up").
