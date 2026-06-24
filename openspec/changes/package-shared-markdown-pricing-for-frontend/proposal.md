# Proposal: Package shared markdown pricing for frontend

## Why

`reconcile-markdown-price-multipliers` fixes the dangerous backend bug by moving the backend price
calculation to `shared/domain/markdown.ts`, but the frontend still defines the same 75/60/50/0
discount ladder in `frontend/src/lib/utils.ts`. The frontend values are currently correct and locked
by `frontend/src/lib/__tests__/utils.test.ts`, but there are still two definitions of the discount
ladder.

The attempted direct import from `frontend/src/lib/utils.ts` to `shared/domain/markdown.ts` failed
the CRACO/CRA production build with:

```text
Module not found: Error: You attempted to import ../../../shared/domain/markdown which falls outside
of the project src/ directory. Relative imports outside of src/ are not supported.
```

This is a packaging/build-boundary problem, not a pricing-algorithm problem.

## Analysis

**Current:**
- `shared/domain/markdown.ts` owns `MARKDOWN_WINDOWS`, `MARKDOWN_DISCOUNT_PERCENTAGES`,
  `getMarkdownDiscountPercentageForDays`, and `calculateMarkdownPriceFromCost`.
- `backend/src/services/inventory-markdown.helpers.ts` can import `shared/domain/markdown.ts`
  because backend TypeScript already permits that monorepo boundary.
- `frontend/src/lib/utils.ts` still implements `calculateMarkdownPercentage` locally because the CRA
  module scope blocks relative imports outside `frontend/src`.
- `frontend/src/lib/__tests__/utils.test.ts` already asserts the interim guard values:
  30d/5d -> 75%, 31d/60d -> 60%, 61d/90d -> 50%, 91d -> 0%, and the corresponding prices for a
  cost of 100.

**Affected:**
- `frontend/craco.config.js`
- `frontend/tsconfig.json`
- `frontend/src/lib/utils.ts`
- `frontend/src/lib/__tests__/utils.test.ts`
- Possibly package/workspace metadata if the cleanest solution is to expose `shared/domain` as a
  package-style import rather than relaxing CRA module scope.

## Reuse Strategy

- Reuse the shared ladder already introduced in `shared/domain/markdown.ts`.
- Prefer a narrow package/workspace alias or CRACO module-scope adjustment that allows the frontend
  to import shared domain code without weakening frontend imports generally.
- Keep `calculateMarkdownPrice` and `calculateMarkdownPercentage` exported from
  `frontend/src/lib/utils.ts` as compatibility wrappers so existing frontend callers do not change.
- Preserve the existing no-rounding behavior; display formatting remains responsible for currency
  rounding.

## Implementation Steps

1. Add a failing frontend test or build assertion proving `frontend/src/lib/utils.ts` delegates to
   the shared markdown ladder instead of hardcoding 75/60/50/0 locally.
2. Configure the frontend build/test toolchain to consume `shared/domain/markdown.ts` through a
   constrained import path.
3. Update `frontend/src/lib/utils.ts` to delegate `calculateMarkdownPrice` and
   `calculateMarkdownPercentage` to shared domain helpers.
4. Keep or update `frontend/src/lib/__tests__/utils.test.ts` as the cheap interim/canonical value
   guard.
5. Run focused frontend utility tests, frontend build, backend affected markdown tests, and
   `openspec validate package-shared-markdown-pricing-for-frontend --strict`.
