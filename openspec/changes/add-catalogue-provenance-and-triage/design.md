# Design: Seed provenance, entry retirement & platform-admin triage

## Context

`add-brand-supplier-mapping` (#358) shipped a global, read-only `MasterCatalogueEntry` catalogue
seeded from a curated workbook via `SeedService.seedMasterCatalogue` (`backend/src/services/seed.service.ts:154`).
The seed is a pure upsert-by-barcode: it walks only rows present in the new workbook, so its diff is
one-directional (`inserted / updated / unchanged`) and it has no concept of a row *leaving*. The
correction-review API (`platformCatalogueCorrectionRouter`) exists and is allowlist-gated but has no
UI. This design closes the operator's stewardship loop without changing the tenant-facing model.

Guiding principle: **the curated workbook is the source of truth; the database should converge to it,
not accumulate every version ever seeded.** Retirement is how convergence stays auditable and
reversible.

## Data model

```
MasterCatalogueEntry (global, read-only reference, keyed on barcode)
  + retiredAt: DateTime?      // NULL = active; set = dropped from the latest seed

CatalogueSeedRun (global, append-only)
  id, version (monotonic int, unique), seededAt, sourceFileName,
  inserted, updated, unchanged, retired, reinstated, errorCount
```

Both are **global, not org-scoped** — a deliberate, documented exception to golden rule 1.
`MasterCatalogueEntry` is already global (a barcode *is* a Blackmores product for everyone), and
seeding is a platform operation, not a tenant one, so there is no `organizationId` to derive from
auth. Tenants never read `CatalogueSeedRun`; only the platform admin does.

## Seed algorithm (the superseding change)

`seedMasterCatalogue(workbookPath)` becomes convergent rather than purely additive:

```
parsed      = parseMasterCatalogueWorkbook(path)         # unchanged
workbookBarcodes = set(parsed.entries.barcode)

for entry in parsed.entries:                             # forward pass (existing loop, extended)
    existing = findUnique(barcode)
    if existing and matches(existing, entry) and existing.retiredAt is null:
        unchanged += 1
    else:
        upsert(entry)                                    # create/update fields from the workbook
        if existing and existing.retiredAt is not null:  # a dropped barcode came back
            clear retiredAt; reinstated += 1             # reinstatement = refresh fields + clear retiredAt
        elif existing: updated += 1
        else:          inserted += 1

# reverse pass — the quadrant the old seed never looked at:
retiredSet = { active DB barcodes } - workbookBarcodes
for barcode in retiredSet:
    set retiredAt = seededAt; retired += 1

version = (max(CatalogueSeedRun.version) ?? 0) + 1
insert CatalogueSeedRun(version, seededAt, sourceFileName=basename(path),
                        inserted, updated, unchanged, retired, reinstated, errorCount)
```

Key properties:
- **Version starts at 1 and is consumed only on commit.** The first-ever run records version 1
  (`max(...) ?? 0) + 1`). Because `version` is assigned and the `CatalogueSeedRun` inserted inside
  the same transaction as the catalogue mutations, a run that fails and rolls back consumes **no**
  version and records **no** row — a failed seed leaves the sequence untouched. `version` carries a
  `@unique` constraint as a safety net, but it is **manually assigned** (`max+1`), not
  `@default(autoincrement())`: autoincrement on a non-`id` field behaves inconsistently across
  SQLite and Postgres and would break dual-backend parity (golden rule 5/6). Gaps are impossible
  under a single operator and harmless regardless, since the counter only reads the current max.
- **Reinstatement refreshes, it does not resurrect a stale snapshot.** A returning barcode keeps its
  **row identity and brand linkage** (same primary key, so `Product.brandId` references survive) but
  its catalogue fields are **updated from the new workbook** by the same upsert — you get the
  current description/SKUs/prices, not whatever they were when it was retired — and `retiredAt` is
  cleared.
- **Idempotent re-run still no-ops.** Re-seeding the same workbook yields all-`unchanged`, zero
  retired/reinstated, and still writes a `CatalogueSeedRun` (a run happened; the row is the audit
  fact). The `unchanged` guard now also requires `retiredAt is null` so a re-run of a sheet that
  reinstated an entry doesn't loop.
- **Retirement is reversible.** A barcode dropped in v5 and returned in v7 is reinstated (its row,
  brand linkage, and history intact) rather than re-inserted.
- **`version` is a simple monotonic counter** derived from the max existing version, assigned inside
  the same transaction as the run insert to avoid races (seeding is single-operator, but the
  transaction keeps it correct regardless).

The whole run executes in one transaction so a mid-seed failure neither half-retires the catalogue
nor records a misleading run.

## Mass-retirement guardrail

The reverse pass is powerful in the wrong direction: seed a partial or wrong workbook and every
barcode it omits gets retired in one run. Two complementary controls, both operating on the diff
computed *before* any write:

```
seedMasterCatalogue(workbookPath, { dryRun?, confirmRetirements? })

1. parse + compute the full diff (inserted/updated/unchanged/retired/reinstated),
   including the exact retired barcode set — no writes yet.
2. if dryRun:  return the result marked dryRun; write nothing; record NO CatalogueSeedRun.
               (a dry run is not a run — it must not consume a version or leave a row.)
3. activeBefore = count(active DB entries)
   if activeBefore > 0 and retired/activeBefore > RETIREMENT_THRESHOLD (default 0.10)
      and not confirmRetirements:
        throw RetirementThresholdExceeded { retired, activeBefore, proportion, threshold }
        # nothing written
4. otherwise apply (forward + reverse pass) and record the run, as above.
```

- **Dry-run** is the inspection tool: the operator sees "this workbook would retire N entries (and
  which)" and decides. It is side-effect-free by construction — no catalogue mutation, no
  provenance row, no version consumed.
- **The threshold** is the automatic seatbelt for when the operator *doesn't* dry-run first. It is a
  **proportion of the active catalogue** (small absolute retirements — a few discontinued lines —
  are normal and never trip it; retiring a large fraction signals a wrong sheet), configurable via
  env with a 10% default. It only engages when a prior catalogue exists, so the legitimate first
  seed (empty → full) is never blocked. Over-threshold aborts write **nothing** and are recoverable
  by re-running with `confirmRetirements` after a dry-run confirms the intent.
- `RetirementThresholdExceeded` is a structured error carrying the counts so the invocation can
  surface exactly what it refused to do.

## Matching excludes retired entries (dual-backend parity)

Retirement is meaningless unless retired rows stop matching. Both matchers gain a retired filter:

- `shared/domain/*`: `matchByBarcode` / `matchByWholesalerSku` skip entries with `retiredAt != null`.
- Worker SQL: `AND retired_at IS NULL` on the barcode and wholesaler-SKU lookups.
- Conformance test (golden rule 5): a retired barcode, and a retired wholesaler-SKU-only hit, both
  fall through to the "needs brand" bucket identically across Neon/pglite and SQLite, including a
  case where an active and a retired entry share a wholesaler SKU (the active one wins).

## Provenance read & triage surface

- **Read endpoint** (backend + worker parity): platform-admin-gated
  `GET /platform/catalogue/provenance` → `{ latest: CatalogueSeedRun | null, history: CatalogueSeedRun[] }`
  (bounded, newest-first). Authorized by the **same** `PLATFORM_ADMIN_USER_IDS` numeric-allowlist
  guard already applied to `platformCatalogueCorrectionRouter`; missing/malformed config fails
  closed. No org scoping (global data).
- **Correction triage** reuses the existing `GET /catalogue-corrections` +
  `PATCH /catalogue-corrections/:id`; no new backend contract, only a UI.
- **Frontend:** one platform-admin route behind the existing allowlist-gated guard, with two sibling
  panels — provenance/version history (latest version, seededAt, sourceFileName, the diff, and a
  retired-count callout) and the `PENDING` correction queue with batch accept/reject.

## Key decisions & alternatives

1. **Soft retirement (`retiredAt`), not hard delete (decision (b), operator-chosen).** _Rejected:_
   hard delete — it destroys the audit trail and makes reinstatement a re-insert that loses brand
   linkage; _rejected:_ status quo (leave orphans) — the silent-superset bug this change exists to
   fix.
2. **Staleness handled structurally, not as a correction kind.** A dropped-then-orphaned entry is a
   seed-diff fact, detectable by set difference the moment it happens — no need to wait for a user to
   flag it, so `CatalogueCorrection.kind` is untouched.
3. **`CatalogueSeedRun` global, not org-scoped.** Consistent with `MasterCatalogueEntry`; org-scoping
   global reference data would be meaningless and violate the "identity is global" principle from
   #358. Documented exception to golden rule 1.
4. **Persist the result the seed already returns.** _Rejected:_ a separate provenance-computation
   pass — `MasterCatalogueSeedResult` is exactly the payload; the only new computation is the reverse
   (retired) pass and the `version` counter.
5. **Reuse the allowlist guard for the provenance read.** _Rejected:_ a new platform-auth primitive —
   #358's numeric-allowlist fail-closed guard already exists and is the right trust boundary.
6. **Retirement threshold as a proportion of the active catalogue, not an absolute count.** _Rejected:_
   an absolute floor — normal churn (a handful of discontinued lines) and a catastrophic wrong-sheet
   seed differ by *ratio*, not by a fixed number that would need re-tuning as the catalogue grows.
   _Rejected:_ making dry-run the only guard — it protects only the disciplined operator; the
   threshold is the seatbelt for the run that skips inspection.

## Considered and deliberately excluded (single-operator scope)

These are real concerns for a contended, high-scale, always-on service; they are **out of scope
because seeding here is one operator running one synchronous command against a ~7k-row global
reference table**. Recorded so the omissions are intentional, not oversights:

- **Transaction isolation tuning, deadlock handling, concurrency tests.** No concurrent seed path
  exists; there is a single writer. Default isolation is correct and a deadlock requires two writers.
- **Version-sequence recovery / max-version ceiling / autoincrement.** `max(version)+1` is
  gap-tolerant by construction; the manual counter is the dual-backend-portable choice (see Key
  decisions). An int ceiling is unreachable at this cadence.
- **Source-file-deleted-mid-transaction race.** The workbook is fully parsed into memory
  (`parseMasterCatalogueWorkbook`) *before* the transaction opens, so the file handle is not held
  across the commit.
- **Retirement batching / timeout avoidance.** One transaction over a 7k-row table is trivial;
  batching would only *weaken* the atomicity this design depends on.
- **A dedicated `retired_at` index.** Matching filters on already-indexed `barcode` (unique) and
  wholesaler-SKU columns plus a `retired_at IS NULL` predicate; a standalone index earns nothing
  until the deferred "list retired entries" view exists. Added later with that view if needed.
- **Seed-failure alerting, per-entry audit logs, run-history retention, real-time UI refresh.** The
  operator reads the run result directly; `CatalogueSeedRun` is itself the audit log; run volume is a
  handful per year; and a weekly on-site operator does not need push updates. Each is a "later, if
  earned" concern, not a v1 one.

(The mass-retirement dry-run / confirmation, previously listed here, was **promoted into v1** — see
"Mass-retirement guardrail" above.)

## Dual-backend parity (golden rules 5 & 6)

- `shared/domain/brand-supplier.ts`: retired-aware `matchByBarcode` / `matchByWholesalerSku`.
- Conformance test compares Worker SQL vs SQLite/Express matching for retired barcode, retired
  wholesaler-SKU fallthrough, and active-wins-over-retired shared-SKU.
- Schema triplicated: Prisma base + production, Neon SQL `0008` (+ rollback), SQLite `018`, pglite
  harness — `retiredAt` and `CatalogueSeedRun` kept in sync across all four.

## Risks / open questions

- **First run against a full production workbook will retire nothing** (empty prior state) and record
  version 1 — the expected baseline.
- **A partially-curated workbook could mass-retire** real entries if the operator seeds a subset by
  mistake. Mitigated in v1 by the mass-retirement guardrail (dry-run inspection + proportional
  threshold that aborts an over-threshold run without confirmation — see "Mass-retirement
  guardrail"), the reversibility of retirement, and the prominent per-run `retired` count in the
  provenance panel. Open sub-question: the 10% default threshold is a first guess; the operator may
  want to tune it once real churn rates are observed in the trial.
- **`version` counter races** are prevented by assigning it inside the run's transaction; single
  operator makes contention moot in practice.
