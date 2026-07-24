# Proposal: Credit-scoped markdown matrices

## Why

`add-user-configurable-markdown-matrix` (#338) made the markdown ladder configurable, but it models
only **half** of the in-store decision. Today a reduced price is a pure function of *how close the
item is to expiry*: the org's one matrix picks a percentage and a basis for each of the three bands
(band 1 = 61–90 days, band 2 = 31–60, band 3 = 0–30).

What a store actually does is decide **twice**. Before choosing a discount, the operator classifies
the item by its supplier's credit policy:

- **The supplier gives full credit back** — as a rebate or a stock swap, the store recovers the whole
  cost. The item is then marked down only lightly (~20%, flat across all three cycles). The small
  discount still does its two jobs: it signals to the shopper that the stock is short-dated (the
  "was / now" sticker), and it flags to the store that the item must come off the shelf and a claim
  must be raised. Discounting harder would burn margin the supplier was going to refund anyway.
- **No credit policy** — the store eats the loss, so the normal aggressive matrix applies (default
  50 / 60 / 75% off) to actually move the stock before it expires.

`add-supplier-credit-claims` (#356), `add-brand-supplier-mapping` (#358), and
`enhance-supplier-policy-capture` (#387/#389) built all the plumbing needed to know **which supplier
owns a SKU** — `Supplier`, `Brand.supplierId`, `resolveSupplier(product, brand)`, the policy capture
dialogue. None of it is consulted at markdown time. The pricing surfaces and the credit surfaces are
two systems that never meet.

## What changes

An organization configures **one markdown matrix per credit scope** instead of one matrix overall.
Every pricing surface resolves the scanned item's supplier, picks the matching matrix, and shows the
operator which matrix applied and why.

Decisions locked with the product owner:

- **Credit type is explicit, not inferred.** Add `Supplier.creditType` (`NONE` | `FULL_CREDIT`), set
  in the existing supplier policy dialogue. Inferring "full credit" from a 1:1
  `policyWriteOffQty`/`policyCreditQty` ratio was rejected: most existing policies are free-text with
  `NULL` ratios, so the signal would be both implicit and usually absent.
- **Two scopes only in v1.** `NO_CREDIT` and `FULL_CREDIT`. Partial and percentage-based credit
  policies are deferred; v1 assumes a 1-for-1 policy as the product owner described.
- **Unknown resolves to `NO_CREDIT`, and never blocks pricing.** A SKU with no brand, an unconfirmed
  reference brand, or a supplier with no policy still prices immediately — using the no-credit
  matrix. This fails safe: the store never under-discounts stock it cannot actually claim. A warning
  badge nudges the operator toward the Supplier Credits page, but no markdown is ever withheld.
- **No per-scan override.** The badge is read-only. A wrong classification is fixed by correcting the
  supplier policy, which then corrects every future SKU — one source of truth. Because nothing is
  persisted, a per-scan override would evaporate on the next view and the worklist would silently
  disagree with the printed sticker.
- **Basis stays a per-band user choice.** Cost or retail remains the org's business decision on both
  matrices, exactly as #338 shipped it. The full-credit matrix is seeded at 20/20/20 off **cost** so
  that an org with no retail data uploaded can never be rejected on a matrix it never touched; the
  settings card hints that many stores run this off retail.
- **Identical validation for both matrices.** The 0–100 bound, the non-decreasing rule
  (Markdown 1 ≤ 2 ≤ 3, which a flat 20/20/20 satisfies), and retail-basis-requires-retail-data all
  apply per scope. One validator, no divergence between the two backends.
- **Changing a matrix warns; it does not migrate.** Markdown prices are never persisted anywhere —
  every surface computes them live — so a matrix change already re-prices all existing stock
  instantly. The only real-world residue is **physical stickers already on the shelf**. Saving shows
  a confirm dialog explaining this; the Detailed Expiry Report worklist already doubles as the
  re-sticker list, and the Markdown Calculator re-prices individual items on demand.

## Scope (v1)

- **`Supplier.creditType`** (text, default `'NONE'`), added to the shared `POLICY_FIELDS` list so it
  automatically inherits #389's admin gating, normalized policy diffing, and `policyUpdatedAt`
  stamping. No new authorization primitive and no new endpoint.
- **`OrganizationMarkdownConfig.creditScope`** (text, default `'NO_CREDIT'`), with the table's unique
  key moving from `organizationId` to `(organizationId, creditScope)` — one row per scope.
- **Shared domain:** `CREDIT_SCOPES`, `MarkdownMatrixSet`, `DEFAULT_FULL_CREDIT_MARKDOWN_MATRIX`,
  `selectMatrix(set, scope)`, `resolveMarkdown(item, days, set, scope)`, and
  `creditScopeForSupplier(supplier)`. The existing single-matrix functions are left untouched.
- **`GET/PUT /markdown-config`** carry the full matrix set; both backends stay in parity.
- **Credit scope on read paths:** the product-by-barcode / by-SKU lookups and the expiry-entry and
  detailed-expiry-report rows gain a server-derived `creditScope`, since those payloads carry
  `costPrice`/`retailPrice` but no supplier today.
- **Frontend:** a second matrix editor in Settings with the save-confirmation dialog; a read-only
  scope badge on the Scan page, both expiry tables, and the Markdown Calculator; a credit-type
  selector in the supplier policy dialogue (read-only for non-admins, like the other policy fields).

## Relationship to prior changes

This change **modifies** #338's "Each organization configures its own 3-band markdown matrix"
requirement (one matrix becomes one matrix per credit scope) and **modifies** #356's "Suppliers carry
a reusable credit policy" requirement (adds `creditType`). It **adds** the scope-resolution rule, the
fail-safe fallback, and the forward-notice-on-save behaviour.

It does **not** touch the claim lifecycle, claim sending, reminders, photos, recovery reporting, the
brand-matching or catalogue-review surfaces, the day-to-expiry band windows, or the retail-price
upload path.

## Reuse Strategy

- **Add `creditType` to `POLICY_FIELDS`** in `shared/domain/supplier-policy.ts` rather than writing
  new gating. `isPolicyWrite`, `validatePolicyWrite`, the `policyUpdatedAt` stamp, and the
  `requireOrgRole('admin')` check all derive from that array, so classification inherits every one of
  them for free.
- **Reuse `resolveSupplier(product, brand)`** (`shared/domain/brand-supplier.ts`) for supplier
  resolution — the same helper the claimable pool already uses. No second resolution path.
- **Reuse the existing pricing maths.** `resolveMarkdown` composes `calculateMarkdownPrice` and
  `getMarkdownBandConfig` over `selectMatrix(...)`; no new arithmetic, so
  `backend/src/tests/unit/markdown-matrix.test.ts` stays valid as-is.
- **Row-per-scope reuses `MarkdownConfigWriteData`** and the existing band-row markup verbatim for
  the second matrix, and leaves room for a future `PARTIAL_CREDIT` scope without another migration.
- **Extend the supplier policy dialogue and `SupplierPolicyFields`** rather than adding a second
  supplier form.
- **Schema stays triplicated** (golden rule 6): Prisma base + production, Neon SQL `0008`
  (+ rollback), runtime SQLite migration `018`, pglite harness.

## Guardrails

- Every tenant-facing endpoint stays org-scoped with `organizationId` from auth only (golden rule 1).
- **Behaviour-neutral until opt-in, twice over.** Suppliers backfill to `creditType = 'NONE'` and the
  `NO_CREDIT` matrix keeps today's stored values, so no org sees a single price change until someone
  deliberately classifies a supplier.
- **Pricing never fails closed.** Every unknown or partially-matched supplier state still yields a
  price; the classification only ever chooses *which* matrix, never *whether* to price.
- **Admin gating fails closed.** A non-admin `creditType` write returns `403`; the field is never
  silently dropped.
- Dual-backend parity is explicit (golden rule 5): shared values from `shared/domain/*` with a
  conformance test comparing SQLite and Postgres/pglite output, including row order.

## Deferred Follow-up

- **Partial / percentage credit policies** (e.g. 50% credit, or 3-for-1 ratios driving a third
  matrix). v1 is the binary full-credit / no-credit split.
- **Per-brand policy overrides** — inherited from the #356/#358 deferral; policy stays supplier-level.
- **An "items affected by this policy change" report.** The product owner's preferred v1 nudge is
  prompting the user to the Supplier Credits page to review that supplier's items.
- **Per-scan manual override** of the resolved credit scope.
- **Matrix change history**, which a diff-based "needs re-sticker" report would require.

## Implementation Steps

1. Shared domain: credit scope vocabulary, `MarkdownMatrixSet`, `selectMatrix`, `resolveMarkdown`,
   `creditScopeForSupplier`; `creditType` added to `POLICY_FIELDS`; unit tests.
2. Schema (triplicated): `Supplier.creditType`; `OrganizationMarkdownConfig.creditScope` + composite
   unique; Neon SQL `0008` (+ rollback), SQLite migration `018`, pglite harness; behaviour-neutral
   backfill.
3. Backend: scope-aware markdown-config repository/service/schema/controller; `creditType` through
   the existing supplier write path; `creditScope` on the product-lookup and expiry read payloads.
4. Workers: parity handlers for the matrix set and the `creditScope` projections, checked by
   dual-backend conformance.
5. Frontend: two-matrix Settings editor with the save-confirmation dialog; scope badges on the Scan
   page, expiry tables, and calculator; credit-type selector in the supplier policy dialogue.
6. Tests: shared-domain units; migration behaviour-neutrality; backend/worker route, admin-gating,
   and org-scoping tests; dual-backend conformance; frontend settings, badge, and pricing tests.
7. Completion: `rtk lint`, diff-scoped backend/frontend suites under Doppler plus a no-Doppler parity
   run, `npm run test:db`, `rtk tsc`, and
   `npx openspec validate add-credit-scoped-markdown-matrices --strict`.
