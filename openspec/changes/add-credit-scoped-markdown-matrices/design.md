# Design: Credit-scoped markdown matrices

## Context

#338 gave each organization one configurable markdown matrix, keyed purely to days-to-expiry. #356 /
#358 / #389 gave each SKU a resolvable supplier and a capturable credit policy. The two halves have
never met: pricing does not know about credit, so a store that recovers full cost from its supplier
still discounts that stock as hard as stock it will eat entirely.

This design connects them with the smallest possible seam: **the supplier decides which matrix
applies; the matrix still decides the price.** No pricing arithmetic changes.

Guiding principle: **classify, never block.** Credit classification is an input to matrix *selection*
only. Every unknown, unbranded, or unconfirmed state still prices — it just prices conservatively.

## Data model (additive)

```
Supplier (org-scoped, from #356 + #358 + #389)
  id, name, contactEmail, contactPhone
  creditPolicyNote                    ← Store Instructions (markdown), unchanged
  policyWriteOffQty, policyCreditQty  ← claim ratio, unchanged
  followUpDays, representativeName, representativeEmail
  policyUpdatedAt                     ← bumps on policy-field change (unchanged mechanism)
  + creditType    text  default 'NONE'   ← NEW: 'NONE' | 'FULL_CREDIT'

OrganizationMarkdownConfig (from #338)
  organizationId
  band1Percentage, band2Percentage, band3Percentage
  band1Basis, band2Basis, band3Basis
  + creditScope   text  default 'NO_CREDIT'   ← NEW: 'NO_CREDIT' | 'FULL_CREDIT'
  UNIQUE(organizationId)  →  UNIQUE(organizationId, creditScope)   ← CHANGED
```

- **No new table.** `creditType` lands on `suppliers`; the second matrix is a second **row** in
  `organization_markdown_configs`.
- **Both defaults are behaviour-neutral.** Existing suppliers backfill to `'NONE'` and existing
  config rows to `'NO_CREDIT'`, so the migration cannot change a single displayed price. A price only
  moves when a user deliberately classifies a supplier *and* has edited the full-credit matrix.
- SQLite uses migration sequence `018`; `017` is occupied by supplier policy fields. Neon SQL uses
  `0008`; `0007` is occupied.

### Why a row per scope, not six more columns

The alternative — `fullCreditBand1Percentage`, `fullCreditBand1Basis`, … — doubles the column count
now and would quadruple it the moment a third scope (partial credit) appears. Row-per-scope instead:

- reuses `MarkdownConfigWriteData` and the repository's existing write shape verbatim;
- reuses the settings band-row markup verbatim for the second matrix;
- makes a future `PARTIAL_CREDIT` a new *value*, not a new migration.

The cost is that the table's unique key must change, which is a real (if mechanical) migration on all
three schema targets. That is a one-time cost against a recurring one.

## Credit scope resolution (the one derived rule)

```
creditScopeForSupplier(supplier):
    # Fail-safe: absent, unclassified, or unknown supplier prices as no-credit,
    # so the store never under-discounts stock it cannot actually claim back.
    if supplier is null:            return "NO_CREDIT"
    if supplier.creditType == "FULL_CREDIT": return "FULL_CREDIT"
    return "NO_CREDIT"

scopeForProduct(product, brand, supplierById):
    supplierId = resolveSupplier(product, brand)      # reused from #358
    return creditScopeForSupplier(supplierById(supplierId))
```

`resolveSupplier` (`shared/domain/brand-supplier.ts`) is reused unchanged — it is the same
`product.supplierId ?? brand.supplierId` chain the claimable pool already relies on, so pricing and
claiming can never disagree about who owns a SKU.

### Relationship to `ClaimabilityState`

`shared/domain/credit-claim.ts` already classifies a write-off as `NEEDS_BRAND`,
`PENDING_CONFIRMATION`, `CLAIMABLE`, or `NO_POLICY`. Credit scope is deliberately **coarser** — it
collapses everything that is not a confirmed full-credit supplier into `NO_CREDIT`:

| Claimability state       | Credit scope  | Operator sees                                   |
| ------------------------ | ------------- | ----------------------------------------------- |
| `CLAIMABLE`, full credit | `FULL_CREDIT` | `Full credit — <supplier>`                       |
| `CLAIMABLE`, `NONE`      | `NO_CREDIT`   | `<supplier> — no credit`                         |
| `NO_POLICY`              | `NO_CREDIT`   | `No credit policy on file` (links to Suppliers)  |
| `PENDING_CONFIRMATION`   | `NO_CREDIT`   | `Supplier unconfirmed — verify before pricing`   |
| `NEEDS_BRAND`            | `NO_CREDIT`   | `No brand matched` (links to catalogue review)   |

The badge carries the nuance so the operator can act on it; the *price* only ever depends on the
two-value scope. This keeps the pricing rule trivially testable and the claim vocabulary free to
evolve independently.

## Pricing (unchanged arithmetic)

```
selectMatrix(set, scope):
    return set[scope]

resolveMarkdown(item, daysToExpiry, set, scope):
    matrix = selectMatrix(set, scope)
    return {
      price: calculateMarkdownPrice(item, daysToExpiry, matrix),   # existing
      band:  getMarkdownBandConfig(daysToExpiry, matrix),          # existing
      scope: scope,
    }
```

`resolveMarkdown` is pure composition over the #338 functions, which keep their current signatures.
Consequences:

- `backend/src/tests/unit/markdown-matrix.test.ts` stays valid without edits.
- Retail-basis-falls-back-to-cost, the `null` return for expired (≤ 0 days) and > 90-day stock, and
  the day-to-band windows all behave identically on both matrices for free.
- Call sites migrate one at a time; nothing is forced to change in a single commit.

`useMarkdownMatrix` is likewise kept as a thin `NO_CREDIT` wrapper over the new
`useMarkdownMatrices`, so untouched frontend call sites keep compiling.

## Defaults

```
DEFAULT_MARKDOWN_MATRIX_SET = {
  NO_CREDIT:   { band1: 50% cost, band2: 60% cost, band3: 75% cost },   # existing #338 default
  FULL_CREDIT: { band1: 20% cost, band2: 20% cost, band3: 20% cost },   # new
}
```

The full-credit default encodes the product owner's flat-20% rule. It is seeded on the **cost** basis
even though the reference practice is off retail, because the save validator rejects a retail band
when the org has no retail data — a retail-basis default would let an org open Settings, touch
nothing, press Save, and be rejected on a matrix it never edited. The settings card carries a hint
that many stores set this to 20% off retail, and the basis remains a free per-band choice on both
matrices.

Flat 20/20/20 satisfies the existing non-decreasing rule, which is `≤` rather than `<`
(`MarkdownMatrixSettings.tsx:27`), so the same validator applies to both matrices unchanged.

## Retroactivity: there is nothing to migrate

**Markdown prices are never persisted.** There is no `markdown_price` column on `InventoryItem` or
`Product`; every surface — the Scan page, both expiry tables, the Markdown Calculator, and
`inventory.service.ts` — calls `calculateMarkdownPrice(item, days, matrix)` live at render time. #338
made this an explicit requirement: *"Matrix changes recompute prices live … without any per-row
snapshot or migration."*

Therefore:

- Editing a matrix **already** re-prices every existing in-window item, instantly, everywhere. A
  "forward-only" notice would be factually wrong.
- A bulk recompute job would have nothing to write to.
- The only real residue is **physical stickers already on the shelf**, which no database change can
  fix.

So the save flow is a confirm dialog, not a migration. The Detailed Expiry Report worklist already
lists in-window stock at current prices — it *is* the re-sticker list — and the Markdown Calculator
re-prices individual items on demand for a user walking the aisle.

The same reasoning is why a per-scan override is rejected: with nothing persisted, an override would
vanish on the next render and the worklist would quietly contradict the printed sticker.

## Read-path plumbing

The main implementation cost is not logic but threading `creditScope` onto payloads that carry
`costPrice`/`retailPrice` but no supplier today:

| Surface                                  | Payload needing `creditScope`                |
| ---------------------------------------- | -------------------------------------------- |
| Scan page, Markdown Calculator           | `GET /products/by-barcode/:barcode`, `/by-sku/:sku` |
| Expiry Entries table                     | expiry-entry rows                            |
| Detailed Expiry Report worklist          | detailed-expiry-report rows                  |
| Backend price resolution                 | `inventory.service.ts` markdown price by id  |

Each is derived server-side via `resolveSupplier` → `creditScopeForSupplier`, in both the Express and
Worker backends, with a conformance test pinning the two together (golden rule 5).

## Alternatives considered

- **Infer full credit from a 1:1 ratio.** Zero schema change, but most existing policies are
  free-text with `NULL` ratios, so nearly every supplier would read as no-credit and the signal would
  be invisible to the user setting it. Rejected for an explicit field.
- **Treat "has any policy note" as full credit.** Conflates *we hold their policy document* with
  *they refund us the cost* — wrong for partial-credit and no-credit suppliers whose policies stores
  still file. Rejected.
- **Optimistically use the full-credit matrix for `PENDING_CONFIRMATION`.** Risks under-discounting
  stock the store ends up eating when the guessed supplier is wrong. Rejected in favour of the
  fail-safe direction.
- **A dedicated "needs re-sticker" report** diffing old against new prices. Requires storing matrix
  history purely to support it, and the live worklist already serves the purpose. Deferred.
