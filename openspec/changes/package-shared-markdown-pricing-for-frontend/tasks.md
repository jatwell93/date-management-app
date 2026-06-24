## Tasks

### Prove the gap
- [ ] Add or update frontend coverage/build assertions showing markdown pricing delegates to the shared ladder rather than hardcoding 75/60/50/0 in `frontend/src/lib/utils.ts`.

### Package shared domain for frontend
- [ ] Configure frontend build/test tooling so `frontend/src/lib/utils.ts` can consume `shared/domain/markdown.ts` through a constrained import path that works in CRACO/CRA production builds.
- [ ] Preserve existing `calculateMarkdownPrice` and `calculateMarkdownPercentage` exports as compatibility wrappers.

### Verify behavior
- [ ] Keep the frontend value guard for 75/60/50/0 and cost-derived prices.
- [ ] Confirm no rounding is introduced; currency/display formatting remains responsible for rounding.

### Completion checks
- [ ] Focused frontend utils tests pass.
- [ ] Frontend production build passes.
- [ ] Backend affected markdown tests pass.
- [ ] `npx openspec validate package-shared-markdown-pricing-for-frontend --strict` is valid.
