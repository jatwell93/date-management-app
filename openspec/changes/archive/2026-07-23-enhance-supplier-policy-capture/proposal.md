# Proposal: Richer supplier policy capture, admin-gated editing & policy/matching review views

## Why

`add-supplier-credit-claims` (#356) and `add-brand-supplier-mapping` (#358) shipped the claim
lifecycle and the brand-mediated supplier map, but the **"add supplier" dialogue** (the "New supplier"
mode of `AssignSupplierModal` in `SupplierCreditsPage.tsx`) still captures only `name`,
`contactEmail`, and the write-off/credit ratio. It cannot record the real-world artifact a store
actually keeps: the **full supplier policy text** (steps, terms, exclusions, stock-swap rules) plus
the **in-store representative** who administers it. Stores paste this from a Blackmores/Metagenics
sheet today and have nowhere to put it.

Two management gaps compound this: there is no view that lets a user **audit which brands have a
policy attached vs. missing**, and the existing catalogue review panel shows brand matching but not a
**SKU-level matching view** with unmatched highlighting and bulk-link. Admins cannot see, at
a glance, where policy coverage is thin or which SKUs are still unbranded.

## What changes

Enrich the supplier record with policy + representative capture, gate policy editing to admins, and
add two review surfaces — one for policy coverage, one for SKU→brand→supplier matching (extending the
existing panel rather than duplicating it).

Decisions locked with the product owner:

- **Store Instructions reuse the existing `creditPolicyNote` column, now markdown-aware.** The
  free-text policy note from #356 becomes the "Supplier Store Instructions" body: a long textarea
  supporting simple markdown (bullets, line breaks), rendered read-only for non-admins. No redundant
  second policy column.
- **Policy is required only when a policy is being authored — never at bare supplier creation.** This
  preserves #358's locked guardrail that onboarding/supplier creation completes with **no** policy
  entered (just-in-time, skippable). When a user does author/edit policy, Store Instructions **and**
  at least one contact method (contact email, contact phone, or representative email) SHALL be present
  before saving.
- **Representative and phone are distinct structured fields.** Add `representativeName`,
  `representativeEmail`, and a supplier-level `contactPhone`. `contactEmail` stays the **claim-send
  target** (unchanged from #356); the representative is the in-store human contact and never silently
  becomes the send address.
- **`policyUpdatedAt` tracks policy changes only.** A dedicated timestamp that bumps when Store
  Instructions / ratio / cadence / representative fields change — distinct from the row's `updatedAt`,
  which bumps on any edit including brand-linkage churn. This is the "Last Updated" shown in review.
- **Policy editing is admin-only; everyone can view.** Writes that set or change policy fields require
  `requireOrgRole('admin')`. Non-admins see instructions and representative details read-only. Bare
  supplier creation during triage (name + optional contact, no policy) stays available to existing
  roles.
- **Partial updates preserve omitted values.** Add `PATCH /supplier-credits/suppliers/:id` and merge
  its payload with the stored supplier before normalized diffing. Preserve legacy full `PUT` for
  compatibility, routing both through the same policy authorization and validation.
- **Policy failures are structured.** Invalid policy writes return `422` with
  `{ code, message, statusCode, errors: [{ field, message }] }`; authorization failures remain `403`.
- **Clearing policy is explicit.** Admins may call
  `DELETE /supplier-credits/suppliers/:id/policy` to clear instructions, ratio, and representative
  fields, reset cadence to 7, preserve contact fields, and stamp `policyUpdatedAt`.
- **SKU-Brand-Supplier matching extends `CatalogueReviewPanel`.** Add a SKU-level table (SKU, product
  name, brand matched/unmatched, supplier-policy attached/missing, last updated), red-highlight
  unmatched SKUs, group by brand, and **bulk-link** (select N unmatched SKUs → assign one brand).
  Reuses the #358 brand-add / correction machinery.

## Scope (v1)

- **`Supplier` fields (triplicated schema):** `representativeName` (nullable text), `representativeEmail`
  (nullable text), `contactPhone` (nullable text), `policyUpdatedAt` (nullable timestamp). Reuse
  existing `creditPolicyNote` for Store Instructions (markdown body).
- **Policy-authoring validation:** when a write includes non-empty Store Instructions (or edits any
  policy field), enforce non-empty instructions **and** ≥1 contact method; reject otherwise. Bare
  creation with no policy is unaffected.
- **Admin gating:** policy-field writes on create and update require the `admin` org role; the API
  fails closed (`403`) for non-admins. Read paths stay role-agnostic within the org.
- **`policyUpdatedAt` maintenance:** set on any write that changes a policy field; left untouched by
  non-policy edits (e.g. a brand relinking to the supplier).
- **Supplier Policy Review Dashboard (read + bulk):** per-brand rows with supplier name, policy status
  (Attached / Missing), `policyUpdatedAt`, and representative. Filter by brand / supplier / policy
  status; sort by last-updated (oldest first). Bulk-attach an existing supplier's policy to multiple
  brands, or create a new policy-bearing supplier and then attach it to the selected brands
  (admin-only).
- **Deterministic review order:** null policy timestamps first, followed by timestamp, brand name, and
  brand ID. Existing non-empty policies are backfilled from supplier `updatedAt`.
- **SKU-Brand-Supplier Matching View (extend `CatalogueReviewPanel`):** SKU-level table with
  matched/unmatched brand and policy-attached/missing columns, unmatched highlighting, group-by-brand,
  manual single-link, and bulk-link of many SKUs to one brand (emitting the #358 corrections). Replace
  the frontend's append-only "Load more" interaction with server-backed numbered pagination and add a
  compact product-title filter (`startsWith` / `contains`) plus A-Z / Z-A ordering.
- **Endpoints (backend + worker parity):** extended supplier create/update carrying the new fields
  with admin gating and policy validation; a policy-review read (brands + policy status + last
  updated); a bulk-link SKUs-to-brand write; a bulk-attach-policy write. All org-scoped, org from auth
  only.
- **Bulk contracts:** arrays accept 1–500 raw positive IDs and are deduplicated after the raw cap is
  enforced. Bulk-link accepts exactly one of `{ brandId, productIds }` or
  `{ brandName, productIds }`; a SKU linked to another brand returns `409` and rolls back the request.
- **Frontend:** enrich the add/edit supplier dialogue (instructions textarea + markdown preview, rep
  name/email, phone, read-only for non-admins); the Policy Review Dashboard tab; the extended matching
  view with bulk-link.

## Relationship to prior changes

This change **modifies** #356's "Suppliers carry a reusable credit policy" requirement (adds
representative, phone, markdown instructions, `policyUpdatedAt`, admin gating, policy-authoring
validation) and **adds** the policy-review dashboard, the SKU matching view, and bulk-link. It does
**not** touch the claim lifecycle, sending, reminders, photos, recovery reporting, catalogue master
data writes, or the correction-review authorization from #358. The follow-up only extends the
existing catalogue-review read contract with pagination, title filtering, and ordering.

## Reuse Strategy

- **Extend `CatalogueReviewPanel`** for the SKU matching view; reuse its brand-add + correction calls
  for bulk-link rather than a parallel surface.
- **Extend `PolicyReviewPanel`** for the reverse supplier-to-brand workflow. Reuse
  `SupplierPolicyFields`, `supplierPolicyDraft` / `supplierPolicyInput`, `createSupplier`, and the
  existing atomic `bulkAttachPolicy` call; do not add a second supplier form or assignment endpoint.
- **Extend `reviewBrands` in place** in Express and Worker. Preserve the existing cursor/limit request
  shape for compatibility while the frontend adopts the additive page/page-size response metadata.
- **Reuse the claimable-pool / brand rollup** for policy status (a brand's policy is its resolved
  supplier's `creditPolicyNote` non-empty) — no new resolution logic; a shared
  `hasPolicy(supplier)` / `brandPolicyStatus` helper in `shared/domain/*` keeps Worker SQL and Express
  in agreement (golden rule 5).
- **Reuse `requireOrgRole('admin')`** for policy gating; no new auth primitive.
- **Schema stays triplicated** (golden rule 6): Prisma base + production, Neon SQL `0007` (+ rollback),
  runtime SQLite migration `017-add-supplier-policy-fields`, pglite harness.

## Guardrails

- Every tenant-facing endpoint org-scoped, `organizationId` from auth only (golden rule 1); cascade
  delete inherited on existing FKs (rule 3).
- **JIT policy preserved.** Nothing here makes policy mandatory at supplier creation; validation only
  triggers when policy is actually being authored.
- **Admin gating fails closed.** A non-admin policy write returns `403`; the field is never silently
  dropped.
- `contactEmail` remains the sole claim-send target; the representative email is advisory contact and
  never used to send claims automatically.
- Markdown is rendered safely (no raw HTML injection); instructions are treated as untrusted text.

## Deferred Follow-up

- **Bulk *edit* of policy content across many suppliers at once** (v1 bulk is attach-existing-policy
  to brands + link SKUs to brand, not multi-supplier policy authoring).
- **Per-brand policy overrides** (inherited from #356/#358 deferral — policy stays supplier-level).
- **Representative directory / multiple reps per supplier** (v1 is a single structured rep).
- **Policy version history** (`policyUpdatedAt` records the latest change only; no audit trail of prior
  policy text).

## Implementation Steps

1. Shared domain: `hasPolicy(supplier)` + `brandPolicyStatus(brand, supplier)` helpers; unit tests.
2. Schema (triplicated): `Supplier.representativeName / representativeEmail / contactPhone /
   policyUpdatedAt`; Neon SQL `0007` (+ rollback), SQLite migration `017`, pglite harness; dual-backend
   conformance for policy status.
3. Backend: extend create/update with new fields + admin gating + policy-authoring validation +
   `policyUpdatedAt` maintenance; policy-review read; bulk-link SKUs; bulk-attach policy.
4. Workers: parity handlers + routes, SQL policy-status checked against the shared helper contract.
5. Frontend: enriched supplier dialogue (markdown textarea + preview, rep fields, phone, read-only for
   non-admins), Policy Review Dashboard tab, extended matching view with bulk-link.
6. Tests: shared-domain units; dual-backend conformance; backend/worker route + admin-gating +
   validation + org-scoping tests; frontend dialogue + dashboard + matching-view tests.
7. Completion: lint, affected tests, `tsc`,
   `npx openspec validate enhance-supplier-policy-capture --strict`.
8. Follow-up: add create-then-attach to Policy Review; add dual-backend numbered catalogue pagination,
   case-insensitive product-title matching, deterministic A-Z/Z-A ordering, and compact frontend
   controls with focused regression and Browser QA coverage.
