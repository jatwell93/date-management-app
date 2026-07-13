# Design: Brand-mediated supplier mapping & self-improving master catalogue

## Context

`add-supplier-credit-claims` (#356) resolves a write-off's supplier directly from `Product.supplierId`,
assigned per SKU. This design inserts a **brand layer** fed by a curated master catalogue so one
user action (confirm a brand's supplier, enter its policy once) fans out across all of that brand's
SKUs. It supersedes only the product→supplier linkage; the claim lifecycle is untouched.

The guiding principle throughout is **progressive enrichment**: give instant value at upload, defer
every heavier commitment to the moment of need, and make every inferred link a suggestion a human
confirms — never a fact the system asserts. That is what keeps us safe on the one real risk (shipping
wrong data) while removing the per-SKU setup cost.

## Data model

```
MasterCatalogueEntry (global, read-only reference, keyed on barcode)
        │  match: barcode → (apiSku|sigmaSku|ch2Sku) fallback
        ▼
Product.brandId ─▶ Brand ─(nullable)─▶ Supplier ─▶ (policy, from #356)
        │                                  ▲
        └─ Product.supplierId ─(override)───┘

CatalogueCorrection (org-scoped): barcode?, enteredBrandName, chosenSupplierId?, kind, status
```

- **MasterCatalogueEntry** — provider-curated, **not org-scoped** (a barcode *is* a Blackmores
  product for everyone). Columns mirror the real sheet: `barcode` (unique), `description`, `apiSku`,
  `sigmaSku`, `ch2Sku`, `brandName`, `manufacturerName`, `category`, `subCategory`, `rrp`,
  `metroPrice`. Tenants read it during import; they never write it.
- **Brand** — org-scoped: `name`, nullable `supplierId`, `source`
  (`REFERENCE` | `USER_ADDED` | `CONFIRMED`), advisory `manufacturerName`. Unique
  `(organizationId, name)`. `REFERENCE` = auto-created from the catalogue with a suggested supplier;
  `CONFIRMED` = a user has confirmed the supplier; `USER_ADDED` = the user created a brand the sheet
  missed (also emits a correction).
- **Product.brandId** — nullable FK to `Brand`. `Product.supplierId` (from #356) retained as an
  override. Supplier resolves via `resolveSupplier` (below).
- **CatalogueCorrection** — org-scoped, append-only: `barcode?`, `enteredBrandName`,
  `chosenSupplierId?`, `kind` (`UNMATCHED` | `BRAND_ADDED` | `SUPPLIER_OVERRIDE`), `status`
  (`PENDING` | `ACCEPTED` | `REJECTED`), `createdByUserId`. Applied locally on write; the central
  review flips `status` without touching other orgs.

## Supplier resolution (the superseding rule)

```
resolveSupplier(product, brand):
    return product.supplierId            # #356 per-product override wins
        ?? brand?.supplierId             # brand default (the new path)
        ?? null                          # "needs brand / needs supplier" bucket
```

Pure function in `shared/domain/brand-supplier.ts`, used by both backends and covered by a
dual-backend conformance test (golden rule 5). Because the claimable-pool rollup already groups by
"the write-off's supplier", swapping the direct field for `resolveSupplier` gives it the brand path
with no rollup change.

## Catalogue matching (import enrichment)

```
enrichProduct(uploadRow):
    entry = matchByBarcode(uploadRow.barcode)
         ?? matchByWholesalerSku(uploadRow.sku)   # tries apiSku, sigmaSku, ch2Sku
    if not entry: → "needs brand" bucket; emit CatalogueCorrection(UNMATCHED)
    brand = upsertBrand(entry.brandName, source=REFERENCE,
                        manufacturerName=entry.manufacturerName)
    product.brandId = brand.id
    # brand.supplierId stays null until confirmed → claimability "pending confirmation"
```

Barcode is the trusted key. Wholesaler-SKU fallback only *suggests* a match (a store's SKU codes
follow its primary wholesaler, so the same product carries different codes across API/Sigma/CH2);
the suggestion is surfaced for confirmation on the review screen, not auto-applied silently.

**Where it runs & failure isolation.** Enrich is a step *inside the existing queued catalogue-import
job* (`add-queued-catalogue-imports`), not a new synchronous pass — so it is already off the request
path and inherits that job's batching and retries. Each lookup is an indexed point-read
(`MasterCatalogueEntry.barcode` is unique; wholesaler-SKU columns indexed), so a ~7k-row catalogue is
a per-row `O(log n)` hit, not a scan. A miss is **not an error** — it routes the item to "needs brand"
and emits an `UNMATCHED` correction; enrich failing for one row (or the catalogue being unreachable)
degrades to "needs brand" for the affected items and never fails the import itself. The import
succeeds; enrichment is best-effort advisory.

## Claimability lifecycle (the one new state)

An expired item's disposition, all visible on the triage board:

```
expired write-off
      │
      ├─ resolveSupplier = null ───────────▶ NEEDS BRAND        (assign/confirm)
      ├─ supplier, brand.source != CONFIRMED ▶ PENDING CONFIRMATION (visible, not blocked)
      ├─ supplier confirmed, claimable ─────▶ [Begin claim]
      └─ supplier confirmed, no policy ─────▶ [Dispose (auto-flagged) — confirm]
```

`PENDING CONFIRMATION` is the only new state. Nothing is hidden and nothing is blocked: a user may
begin a claim on a "no policy" brand (rep goodwill), and a dispose is always a *confirm*, never an
auto-close — so the store watches every expiry from start to finish.

## New-user first-run journey

1. **Upload** back-office export (barcode, SKU, description, cost) from thier POS system.
2. **Auto-match** against the master catalogue → each item tagged with brand + suggested supplier.
3. **Review screen** — matched items grouped by suggested supplier, plus a "needs brand" bucket for
   unmatched rows. This *is* onboarding; it ends here.
4. **Skip policy.** No supplier confirmation or policy entry is required to finish setup.
5. **Just-in-time** — the first time a brand's item expires and hits the claimable pool, an inline
   prompt confirms that supplier and captures its policy once; from then on every item of that
   supplier's brands is resolved.

## Correction / crowd-source loop (capture-only, v1)

- Triggers: `UNMATCHED` (no catalogue hit), `BRAND_ADDED` (user creates a missing brand),
  `SUPPLIER_OVERRIDE` (user picks a different supplier than suggested).
- Effect: applies immediately **within the submitting org**; a `PENDING` `CatalogueCorrection` is
  queued for central review.
- Central review (admin): a minimal **queue read + accept/reject** on the pending corrections — no
  bulk editing, no per-org drill-down, no redistribution UI in v1. Accept → status flips to `ACCEPTED`
  and the product team folds it into the next catalogue seed by hand; reject → status flips to
  `REJECTED`, no-op. Acceptance never mutates another org's data in v1 (redistribution is deferred).
  Deliberately kept this thin so nobody builds the redistribution surface before we've decided we want
  it.
- Precedent: FRED AppCat ships imperfect and improves via user-flagged corrections a central team
  adjudicates — lower ongoing cost than hand-curating 7k rows, and it improves with use.

## Key decisions & alternatives

1. **Brand as a first-class table, not a `Product.brand` string.** Brands have behaviour — user-added,
   supplier-linked, correction-flagged, `source`-tracked. *Rejected:* a bare string; it can't carry
   the confirm/override state the whole model turns on.
2. **`resolveSupplier = override ?? brand-default`.** *Rejected:* migrating #356's `Product.supplierId`
   away — keeping it as an override is back-compatible and preserves shipped behaviour with zero data
   loss.
3. **Master catalogue global & read-only; corrections org-scoped.** *Rejected:* a shared writable
   catalogue — it manufactures the "same SKU, different brand per store" conflict. Identity is global;
   per-store divergence is a private correction until centrally accepted.
4. **Ship identity, never policy.** *Rejected:* seeding base policies — franchise/negotiation variance
   means a wrong default is worse than a blank; the user enters policy, we only link.
5. **Barcode-primary matching.** *Rejected:* SKU-primary — SKU codes are wholesaler-specific, so they
   fragment the same product across API/Sigma/CH2; barcode is the one stable key.

## Dual-backend parity (golden rules 5 & 6)

- `shared/domain/brand-supplier.ts`: `resolveSupplier`, `matchByBarcode`, `matchByWholesalerSku`.
- Conformance test compares Neon/pglite vs SQLite for `resolveSupplier` and the enrich rollup,
  including row order and org isolation.
- Schema lands in Prisma (base + production), Neon SQL (+ rollback), the next SQLite migration, and
  the pglite harness — kept in sync.

## Risks / open questions

- **Catalogue coverage** — the seed sheet is ~7k rows; long-tail misses land in "needs brand" and
  drive corrections. Acceptable, and self-improving, but early match-rate should be monitored.
- **`Manufacturer` ≠ supplier** — handled by treating it as advisory only; the confirm step is
  load-bearing, not ceremony.
- **CH2 wholesaler SKU** is not yet in the sheet; the column exists in the model so seeding it later
  is data-only, no schema change.
