# Token Migration Strategy

> Decision: **Deprecate** `inventory-*` Tailwind colors (not immediate removal). Semantic tokens added alongside existing tokens. Components migrated incrementally across 4 waves.

## Migration Phases

### Phase 0 — Token Foundation (Current)
- ✅ Created `design-tokens.json` and `design-tokens.css` (raw brand tokens)
- ✅ Created `tokens.ts` (typed TS exports)
- ✅ Created `semantic-tokens.ts` (6 semantic categories)
- ✅ Added `semantic-*` color namespace to `tailwind.config.js`
- ✅ Deduplicated `globals.css` / `index.css`
- ✅ `inventory-*` tokens marked as DEPRECATED in source

### Wave 1 — Navigation Shell & Token Compliance
- Migrate header, sidebar, footer, login/auth pages
- Add ESLint/lint compliance check
- Establish baseline non-compliance count

### Wave 2 — Forms, Buttons, Alerts, Badges
- Migrate all 14 shadcn UI components in `components/ui/`
- Replace `inventory-*` class references with `semantic-*`

### Wave 3 — Dashboard Cards, Tables, Charts
- Migrate all 12 page components
- Apply data-viz semantic tokens to charts

### Wave 4 — Scanner Surfaces
- Migrate scanner components to semantic tokens
- Apply `.scanner-context` adaptation profile

### Post-Wave — Cleanup
- Remove `inventory-*` from `tailwind.config.js`
- Remove deprecated `--inventory-*` CSS custom properties from `globals.css`
- Run codemod to catch any remaining `inventory-*` class usage

## Codemod Commands

When ready to remove `inventory-*` entirely:

```bash
# Find all remaining inventory-* class usage
grep -rn "inventory-" frontend/src/ --include="*.tsx" --include="*.ts" --include="*.css"

# Suggested replacements (manual review required):
# inventory-primary-500 → semantic-secondary (sky blue)
# inventory-primary-700 → semantic-secondary-active
# inventory-secondary-700 → semantic-primary (teal)
# inventory-success-* → semantic-success-*
# inventory-warning-* → semantic-warning-*
# inventory-error-* → semantic-critical-*
# inventory-neutral-* → Tailwind slate-* or semantic-surface-*
```

## Rollback Procedure

If issues arise during migration:

1. Semantic tokens are additive — reverting component changes restores old `inventory-*` usage
2. `inventory-*` tokens remain fully functional until explicit removal
3. `git revert` any wave commit to restore pre-migration state
4. No database or backend changes involved — purely frontend styling

## Timeline

| Phase | Scope | Risk |
|-------|-------|------|
| Phase 0 | Foundation only, no visual changes | None |
| Wave 1 | Nav shell + auth pages (~5 files) | Low |
| Wave 2 | UI components (~14 files) | Low-Medium |
| Wave 3 | Page components (~12 files) | Medium |
| Wave 4 | Scanner components (~5 files) | Low |
| Cleanup | Remove deprecated tokens | Low (after full migration) |
