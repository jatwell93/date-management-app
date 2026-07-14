# Design: Richer supplier policy capture, admin-gated editing & review views

## Context

The supplier record from PR #356 holds a bare `creditPolicyNote`, a claim `contactEmail`, and a structured
ratio. Real stores administer credits against a **policy document** (steps / terms / exclusions /
stock-swap rules) and a **named in-store representative** — neither is capturable today, and there is no
surface to audit policy coverage or SKU→brand matching at scale. This design adds those without
disturbing the claim lifecycle or PR #358 brand-mediated resolution.

Guiding principle: **capture, don't coerce.** Policy stays just-in-time (#358's locked guardrail);
validation only bites when a user actually authors policy; editing is admin-gated but viewing is open.

## Data model (additive)

```
Supplier (org-scoped, from #356 + #358)
  id, name, contactEmail            ← claim-send target (unchanged)
  creditPolicyNote                  ← REUSED as "Store Instructions" (markdown body)
  policyWriteOffQty, policyCreditQty, followUpDays
  + representativeName    text?     ← in-store rep (advisory contact)
  + representativeEmail   text?
  + contactPhone          text?     ← supplier phone (a valid "contact method")
  + policyUpdatedAt       datetime? ← bumps ONLY on policy-field change
  updatedAt                         ← bumps on ANY edit (unchanged)
```

- **No new table.** All four fields land on `suppliers`. `creditPolicyNote` keeps its column and
  default `''`; we only reinterpret it as markdown in the UI and require it non-empty during policy
  authoring.
- **`policyUpdatedAt` is nullable** — null means "no policy authored yet" (the JIT default) and drives
  the "Missing" status in review.

## Policy status (shared, the one derived rule)

```
hasPolicy(supplier):
    return supplier.creditPolicyNote.trim() != ""     # instructions authored

brandPolicyStatus(brand, resolvedSupplier):
    return resolvedSupplier && hasPolicy(resolvedSupplier) ? "ATTACHED" : "MISSING"
```

Pure functions in `shared/domain/supplier-policy.ts`, consumed by the policy-review read in both
backends. The Worker computes the same status in SQL (`length(trim(credit_policy_note)) > 0`);
table-driven contract tests exercise attached / missing / no-supplier / whitespace-only cases against
both implementations so SQL cannot drift (golden rule 5).

## Policy-authoring validation (server-authoritative)

```
isPolicyWrite(payload):
    any policy field present/changed: creditPolicyNote, ratio, followUpDays,
    representativeName, representativeEmail (contactPhone/contactEmail alone are just contact)

validatePolicyWrite(payload, existing):
    if isPolicyWrite:
        require creditPolicyNote.trim() != ""                       # instructions mandatory
        require contactEmail || contactPhone || representativeEmail  # ≥1 contact method
        else → 422
```

Bare creation (name only, or name + contact, no policy) skips validation entirely — the JIT path.
Validation is enforced server-side in both backends; the frontend mirrors it for UX but is not the
authority.

## Admin gating

```
POST /suppliers, PATCH /suppliers/:id:
    if isPolicyWrite(payload) and req.userRole != 'admin' → 403   # fail closed
    # non-policy create/update (name, contact) stays open to existing roles
```

Reuses `requireOrgRole('admin')` semantics inline (the write is conditional on payload, so the guard
lives in the controller, not blanket route middleware). Read endpoints are role-agnostic within the
org. `policyUpdatedAt` is stamped in the service whenever a policy field actually changes value —
idempotent no-op writes don't bump it.

**Worked examples of `isPolicyWrite` (the load-bearing edge).** The service diffs the payload against
the existing row *before* deciding:

| Payload vs. existing | policy write? | gate / validate |
| --- | --- | --- |
| `{ name }` only, new supplier | no | open; no validation |
| `{ name, contactEmail }`, no instructions | no | open; no validation |
| `{ contactEmail }` changed on existing supplier | no | open (contact ≠ policy) |
| `{ creditPolicyNote }` present but **equal** to existing | no | open; no bump |
| `{ creditPolicyNote }` present and **changed** | yes | admin-gated + validated + bump |
| `{ policyWriteOffQty }` changed | yes | admin-gated + validated + bump |
| `{ representativeName }` changed | yes | admin-gated + validated + bump |
| `{ contactPhone }` changed only | no | open; no bump (phone is contact, not policy) |

`contactPhone` and `contactEmail` are *contact*, not *policy* — changing them alone is neither
admin-gated nor a `policyUpdatedAt` bump, but their presence satisfies the ≥1-contact rule when some
*other* field does make it a policy write.

## Error handling & UX treatment

Distinct failures map to distinct status codes and distinct UI treatments — the frontend MUST NOT
collapse them into one generic error:

| Condition | Status | UI treatment |
| --- | --- | --- |
| Policy authored without instructions or without a contact method | **422** | Inline field errors on the offending inputs ("Store instructions required", "Add an email or phone"); form stays open, submit re-enabled. |
| Non-admin attempts a policy-field write | **403** | Permission notice ("Only admins can edit supplier policy — ask an org admin"); policy fields render read-only, not an input error. |
| Bulk-attach to a supplier with no instructions | **422** | Blocking message on the picker; the attach button stays disabled until a policy-bearing supplier is chosen. |
| Bulk operation partial concern (e.g. some `productIds` already linked) | **200** with a per-item result summary | Non-fatal: report `{ linked, skipped, alreadyLinked }` as a toast/summary; the operation is not rolled back for already-satisfied rows. |
| Bulk request exceeds the batch cap | **422** | Client caps selection to the max and shows the limit; the server rejects oversized requests defensively. |

The bulk endpoints return a **result summary object**, never a bare 204, so the UI can show exactly
what changed versus what was a no-op.

## Bulk operations: bounded & atomic (not a throughput problem)

Realistic bulk sizes are small — a store bulk-links tens of SKUs, bulk-attaches to a few hundred
brands at the extreme. The risks are **atomicity** and an **unbounded request**, not throughput, so:

- Each bulk write runs in **one transaction**: all rows apply or none do (partial *input* that is
  already-satisfied is reported, not failed — see the table above).
- Each request is **capped** (e.g. ≤500 ids); oversized requests are rejected `422` rather than
  streamed. The cap is a defensive bound, mirrored client-side.
- Writes touch indexed columns (`Product.id`, `Brand.id`, `Supplier.id`, all org-scoped); no scan.
- Corrections are inserted in the same transaction as the links they describe, so a correction never
  outlives a rolled-back link.

No load-testing task is warranted at this scale; the conformance and route tests assert atomicity,
the cap, and the result-summary shape instead.

## Supplier Policy Review Dashboard

A read grouped by **brand**, each row: brand name, resolved supplier name, policy status
(Attached / Missing via `brandPolicyStatus`), `policyUpdatedAt`, representative name.

```
GET /supplier-credits/policy-review
    ?brand= &supplier= &status=ATTACHED|MISSING   # filters
    &sort=lastUpdatedAsc                          # oldest-first default (prioritise stale)
    → [{ brandId, brandName, supplierId, supplierName, policyStatus,
         policyUpdatedAt, representativeName }]
```

**Bulk-attach workflow (admin).** From the dashboard the admin: (1) multi-selects brand rows —
typically the "Missing" ones surfaced by the filter; (2) picks one **existing** supplier from a
picker (the supplier must already have store instructions, so this attaches a *real* policy, never a
blank one); (3) confirms. The server then, in **one transaction**, sets each selected brand's
`supplierId` to that supplier via #358's `confirmBrandSupplier` semantics and emits one
`SUPPLIER_OVERRIDE` correction per brand. It applies immediately within the org. No new correction
kind, no policy authoring in this flow (it reuses an existing supplier's policy by reference — the
whole point of the supplier-level model).

```
POST /supplier-credits/policy-review/bulk-attach
    { supplierId, brandIds: number[] }            # supplierId must resolve to a supplier with policy
    → { attached: n, corrections: n }             # atomic; 422 if supplier has no instructions
```

## SKU-Brand-Supplier Matching View (extends `CatalogueReviewPanel`)

SKU-level table: SKU, product name, brand (Matched / **Unmatched** — red highlight),
supplier-policy (Attached / Missing), last updated. Grouped by brand for scanning. Actions:

- **Manual link** — reuse the existing single brand-add / assign path.
- **Bulk-link** — select N unmatched SKUs → assign one brand in a single request; server upserts the
  brand (via #358 `addBrand` semantics) and links each product, emitting one `BRAND_ADDED` correction
  per SKU.

```
POST /supplier-credits/brands/bulk-link
    { brandName | brandId, productIds: number[] }
    → { linked: n, brandId, corrections: n }   # org-scoped, atomic
```

The panel keeps its current brand-review mode; the SKU table is an additional mode/tab, not a
replacement.

## Frontend dialogue changes

The "New supplier" mode of `AssignSupplierModal` (and a parallel edit mode) gains:

- **Store Instructions** — `<textarea>` with a live markdown **preview** toggle; rendered read-only
  (preview-only) when `userRole != 'admin'`.
- **Representative name / email**, **contact phone** inputs.
- Client-side mirror of policy validation (instructions + ≥1 contact) shown inline; server remains
  authoritative.

**Markdown decision (locked).** Render with **`react-markdown`** configured to disallow raw HTML
(no `rehype-raw`; `skipHtml`/default sanitisation on), restricted to the subset the policy text
actually uses — paragraphs, line breaks, bullet and ordered lists, bold/italic. No images, no links
that auto-execute, no HTML passthrough. Instructions are untrusted text. `react-markdown` is chosen
over a hand-rolled formatter because the checkbox/step/exclusion structure of the real Blackmores/
Metagenics samples is genuinely list-heavy and a formatter would grow into a partial markdown parser;
it is tree-shakeable and the render surface is one textarea preview, so bundle impact is bounded. The
same renderer is reused read-only wherever instructions are displayed (dialogue preview, dashboard row
expansion).

## Key decisions & alternatives

1. **Reuse `creditPolicyNote`, no second policy column.** _Rejected:_ a new `storeInstructions`
   column — it would duplicate the policy field, split the "has policy?" check, and churn every
   consumer. The note *is* the instructions; we only make it markdown-aware and required-when-authoring.
2. **`policyUpdatedAt` separate from `updatedAt`.** _Rejected:_ reusing `updatedAt` — it bumps on
   brand relinks and non-policy edits, defeating "oldest policy first" prioritisation.
3. **Structured representative, not a note.** _Rejected:_ folding rep into instructions — the dashboard
   needs a queryable representative column, and email/phone need their own validation.
4. **Policy-conditional admin gate in the controller.** _Rejected:_ blanket `requireOrgRole('admin')`
   route middleware — it would block managers from the JIT bare-supplier creation they do during
   triage. Gate only policy writes.
5. **Extend the panel; don't fork it.** _Rejected:_ a standalone matching page — it would duplicate the
   #358 brand-add / correction plumbing and drift.
6. **Validation server-authoritative, mirrored on client.** _Rejected:_ client-only validation — trust
   boundary; both backends enforce it.

## Dual-backend parity (golden rules 5 & 6)

- `shared/domain/supplier-policy.ts`: `hasPolicy`, `brandPolicyStatus`, `isPolicyWrite`,
  `validatePolicyWrite`.
- Contract tests compare Worker SQL vs. SQLite/Express for policy status, validation outcomes,
  `policyUpdatedAt` bump-vs-no-bump, admin gating, row order, and org isolation.
- Schema lands in Prisma (base + production), Neon SQL `0007` (+ rollback), SQLite migration `008`, and
  the pglite harness — kept in sync.

## Risks / open questions

- **Markdown dependency footprint** — prefer the smallest safe renderer; a raw-HTML-disabled
  `react-markdown` is the default. If bundle cost is a concern, a minimal formatter is the fallback.
- **Policy-write detection edge cases** — a payload that includes `creditPolicyNote` unchanged should
  not trip validation/admin gate; the service diffs against existing values before treating it as a
  policy write.
- **`contactPhone` as a valid contact method** — accepted as free text (no strict phone parsing) to
  avoid rejecting international/store formats; presence is what validation checks.
