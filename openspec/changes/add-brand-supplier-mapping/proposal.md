# Proposal: Brand-mediated supplier mapping & self-improving master catalogue

## Why

`add-supplier-credit-claims` (#356) shipped a working claim lifecycle, but the supplier map it builds
is per-SKU: `Product.supplierId` is assigned one product at a time. In the real world a store carries
~100 Blackmores SKUs; only ~20 expire in a year, yet each expired SKU still needs its supplier
assigned before it can be claimed. The pain is entirely a **granularity mismatch** — the expensive
dimension (thousands of SKUs) is linked one row at a time, while the cheap dimension (a few hundred
brands, ~72 suppliers) is where the policy actually lives.

Critically, the linkage stores need — `product → brand → supplier` — **does not exist in their own
data.** A back-office export (FRED Office, Z-office, other POS) carries SKU / alias / description /
cost / retail / department / category, but no brand and no supplier. The only source of that linkage is a curated reference catalogue
the *product team* maintains (a ~7k-row master list; a 100-row sample lives in
`supplier-doc-examples/sample_100_ipa_price_brands.xlsx`). Meanwhile supplier **policy** content
varies by franchise (Priceline scatters it across an intranet; IPA dumps it in one table; DCO and
others differ) and by negotiation, so shipping a base policy risks asserting *wrong* information.

The split that resolves this: **the product team ships identity data (barcode → brand → supplier);
the user enters policy content.** Stores already do this by hand — one real store kept a Google doc:
"each time we matched a brand to a supplier we noted it down with the policy — *credit → do this, no
credit → dispose*." This change digitises that artifact.

## What changes

Insert a **brand layer** between product and supplier, fed by a curated master catalogue, and make
every inferred link a **suggestion the user confirms** rather than a fact the system asserts.

Decisions locked with the product owner:

- **Supplier resolution becomes `product.supplier ?? product.brand.supplier`.** The shipped
  `Product.supplierId` becomes a per-product *override*; the brand link is the *default*. PR #356
  behaviour is preserved; the brand layer only pre-fills the default path. Policy stays on the
  supplier (a supplier owns many brands — IPA's "Blackmores & Bioceuticals" supplier → brands
  Blackmores + BioCeuticals, one shared policy).
- **A curated master catalogue provides identity, not policy.** Keyed on **barcode** (the one
  wholesaler-independent identifier), carrying description, per-wholesaler SKUs (`API PDE`,
  `Sigma PDE`, with `CH2` to come), `Brand`, `Manufacturer`, category, and reference prices. `Manufacturer`
  is *usually but not always* the supplier (Cancer Council's manufacturer is "Vitality Brands"), so
  it seeds a *suggestion*, never an assertion.
- **Match is barcode-primary, wholesaler-SKU fallback.** A store's SKU codes follow its main
  wholesaler (API's PDE if API is their primary, Sigma's if Sigma), so the fallback matches the
  store SKU against *any* wholesaler-SKU column.
- **Users confirm and correct; corrections flow back centrally (capture-only in v1).** When the sheet
  doesn't match an item, or a user overrides a suggested supplier / adds a missing brand, the system
  records a **correction event** (barcode, brand, supplier, org). It applies **immediately in that
  org**, and pools into a central review queue the product team adjudicates — the FRED AppCat model.
  Nothing is redistributed store-to-store automatically; "review + redistribute" is a later toggle.
- **Onboarding is upload + match; policy capture is just-in-time and skippable.** Setup finishes the
  moment the catalogue is matched (instant value: items tagged with brand + suggested supplier). A
  supplier's policy is entered **once**, inline, the first time one of its items expires and enters
  the claimable pool, then fans out to every item of that supplier's brands.
- **Every expired item runs a visible start-to-finish disposition, two CTAs, never blocked.**
  Claimable brand → **"Begin claim"**; no-policy brand → **"Dispose (auto-flagged) — confirm"**.
  Everything stays visible end-to-end (a rep may help out even on a "no policy" brand — the policy
  advises, it never blocks, preserving the #356 guardrail).

## Scope (v1)

- **`Brand`** — org-scoped: `name`, nullable `supplierId`, `source` (`REFERENCE` | `USER_ADDED` |
  `CONFIRMED`), optional `manufacturerName` (from the catalogue, advisory). Unique `(organizationId, name)`.
- **`Product.brandId`** — nullable link to `Brand`; supplier resolves via
  `product.supplier ?? product.brand.supplier`. `Product.supplierId` retained as an override.
- **`MasterCatalogueEntry`** — the curated reference row: `barcode` (unique key), `description`,
  `apiSku`, `sigmaSku`, `ch2Sku`, `brandName`, `manufacturerName`, `category`, `subCategory`,
  `rrp`, `metroPrice`. Provider-curated; read-only to tenants. (Global reference, not org-scoped.)
- **`CatalogueCorrection`** — org-scoped correction event: `barcode?`, `enteredBrandName`,
  `chosenSupplierId?`, `kind` (`UNMATCHED` | `BRAND_ADDED` | `SUPPLIER_OVERRIDE`), `status`
  (`PENDING` | `ACCEPTED` | `REJECTED`), `createdByUserId`. Applied locally on write; reviewed centrally.
- **Product enrichment on import:** match uploaded products by barcode → wholesaler-SKU fallback;
  attach `brandId` (create `Brand` from the catalogue with `source = REFERENCE` if new) and seed the
  brand's suggested supplier/manufacturer. Unmatched items land in a "needs brand" bucket.
- **Claimability state:** an expired item whose supplier is not yet confirmed surfaces as
  `pending confirmation` — visible, not blocked; resolved on first interaction.
- **Endpoints (backend + worker parity):** catalogue match/enrich for an import batch; list brands +
  suggested suppliers; confirm a brand→supplier; add a missing brand; record a correction; the
  central correction review read (admin).
- **Frontend:** the post-upload **review screen** (matched items grouped by suggested supplier + a
  "needs brand" bucket), inline brand-add + supplier-confirm, the just-in-time policy prompt on first
  claim, and the two-CTA disposition (Begin claim / confirm dispose) on the existing Supplier Credits
  triage board.

## Relationship to `add-supplier-credit-claims`

This change **supersedes** the "Products map to a supplier and the map builds through use" requirement
from #356 with a brand-mediated version, and adds the catalogue, brand, correction, and progressive-
onboarding capabilities around it. It does **not** touch the claim lifecycle, sending, reminders,
photos, or recovery reporting — those consume whatever supplier resolution returns, unchanged.

## Reuse Strategy

- **Resolution stays a pure `shared/domain` function** (`resolveSupplier(product, brand)`), covered by
  the existing dual-backend conformance pattern (golden rule 5) so Neon/pglite and SQLite agree.
- **Reuse the queued catalogue-import pipeline** (`add-queued-catalogue-imports`,
  `harden-product-import-pipeline`) — the enrich step hooks the existing import, not a new one.
- **Reuse the claimable-pool rollup**; it groups by resolved supplier, so it inherits the brand path
  with no rollup rewrite.
- **Schema stays triplicated** (golden rule 6): Prisma base + production, Neon SQL (+ rollback),
  runtime SQLite migration, pglite harness.

## Guardrails

- Every tenant-facing endpoint org-scoped, `organizationId` from auth only (golden rule 1); cascade
  delete on every new tenant FK (rule 3). `MasterCatalogueEntry` is global read-only reference data.
- **Suggestions never assert.** A catalogue-derived supplier is `source`-marked and shown as pending
  until a user confirms; the "no policy / dispose" flag never blocks a claim.
- Corrections apply **only within the submitting org** in v1; central acceptance is a separate,
  audited step and never mutates another org's data automatically.
- Barcode is the trusted key; wholesaler-SKU fallback only *suggests* a match for user confirmation.

## Deferred Follow-up

- **Redistributing accepted corrections** back into the master catalogue for all orgs (v1 is
  capture + central review only).
- **Metro/RRP price seeding & catalogue-driven cost/retail onboarding** — the catalogue carries these
  columns, but pre-seeding a store's cost/retail is a separate onboarding feature, not credit linkage.
- **Wholesaler-routed claims** (expired-on-receipt via API/Sigma/CH2) — a receiving/RTV flow distinct
  from shelf-expiry credit claims, which always route to the manufacturer-supplier.
- **Brand-level (vs supplier-level) policies** — inherited from #356's deferral.

## Implementation Steps

1. Shared domain: `resolveSupplier(product, brand)` + catalogue match helpers
   (`matchByBarcode`, `matchByWholesalerSku`); unit tests.
2. Schema (triplicated): `Brand`, `Product.brandId`, `MasterCatalogueEntry`, `CatalogueCorrection`;
   Neon SQL (+ rollback), SQLite migration, pglite harness; dual-backend conformance for
   `resolveSupplier` + enrich.
3. Backend: catalogue enrich-on-import, brand list/confirm/add, correction record + central review;
   wire into the existing import pipeline.
4. Workers: parity handlers + routes sharing the `shared/domain` resolvers.
5. Frontend: post-upload review screen, inline brand-add/supplier-confirm, JIT policy prompt on first
   claim, two-CTA disposition on the triage board.
6. Seed the master catalogue from the curated sheet (barcode, wholesaler SKUs, brand, manufacturer).
7. Tests: shared-domain units; dual-backend conformance; backend/worker route + org-scoping tests;
   frontend review-screen + disposition tests.
8. Completion: lint, affected tests, `tsc`, `npx openspec validate add-brand-supplier-mapping --strict`.
