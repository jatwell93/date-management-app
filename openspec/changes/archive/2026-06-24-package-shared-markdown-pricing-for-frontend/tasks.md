## Tasks

### Prove the gap
- [x] Add or update frontend coverage/build assertions showing markdown pricing delegates to the shared ladder rather than hardcoding 75/60/50/0 in `frontend/src/lib/utils.ts`.

### Package shared domain for frontend
- [x] Configure frontend build/test tooling so `frontend/src/lib/utils.ts` can consume `shared/domain/markdown.ts` through a constrained import path that works in CRACO/CRA production builds.
- [x] Preserve existing `calculateMarkdownPrice` and `calculateMarkdownPercentage` exports as compatibility wrappers.

### Verify behavior
- [x] Keep the frontend value guard for 75/60/50/0 and cost-derived prices.
- [x] Confirm no rounding is introduced; currency/display formatting remains responsible for rounding.
- [x] Show an expired badge instead of markdown pricing on ScanPage for day-zero and already-expired stock.

### Completion checks
- [x] Focused frontend utils tests pass.
- [x] Frontend production build passes.
- [x] Backend affected markdown tests pass.
- [x] `npx openspec validate package-shared-markdown-pricing-for-frontend --strict` is valid.
