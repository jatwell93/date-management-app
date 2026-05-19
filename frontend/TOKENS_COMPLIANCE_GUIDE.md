# Token Compliance Guide

## Overview

All frontend components must use the **semantic token system** for styling. Direct use of hardcoded colors, deprecated `inventory-*` classes, or raw Tailwind gray utilities is prohibited in new code.

This guide explains the compliance rules, approved token references, and the exceptions process.

---

## Token Hierarchy

```
design-tokens.json (raw brand values)
  → tokens.ts (typed TS constants)
  → semantic-tokens.ts (intent-based mappings)
  → tailwind.config.js (Tailwind theme extensions)
  → globals.css (CSS custom properties)
```

Components consume tokens at two levels:
1. **Tailwind classes** — `bg-semantic-primary`, `text-popover-foreground`, `border-border`, etc.
2. **CSS custom properties** — `var(--semantic-primary)`, `var(--text-primary)`, etc.

---

## Approved Token References

### shadcn/ui System Tokens (HSL-based)

These are the standard shadcn tokens defined in `globals.css` `:root` / `.dark` blocks:

| Token | Usage |
|-------|-------|
| `background` / `foreground` | Page-level background and text |
| `card` / `card-foreground` | Card surfaces |
| `popover` / `popover-foreground` | Dropdown menus, popovers |
| `primary` / `primary-foreground` | Primary buttons, nav bar |
| `secondary` / `secondary-foreground` | Secondary buttons |
| `muted` / `muted-foreground` | Muted backgrounds and text |
| `accent` / `accent-foreground` | Hover states in menus |
| `destructive` / `destructive-foreground` | Delete buttons, error actions |
| `border` | Default border color |
| `input` | Form input borders |
| `ring` | Focus ring color |

### Semantic Brand Tokens

These map brand intent to PharmIQ brand colors:

| Token | Tailwind Class | Hex | Usage |
|-------|---------------|-----|-------|
| `semantic-primary` | `bg-semantic-primary`, `text-semantic-primary` | `#0F766E` (teal) | CTAs, selection states, focus rings |
| `semantic-secondary` | `bg-semantic-secondary` | `#0EA5E9` (sky blue) | Data viz, informational highlights |
| `semantic-warning` | `bg-semantic-warning` | `#D97706` (amber) | Alerts, pending badges, validation warnings **only** |
| `semantic-success` | `bg-semantic-success` | `#10B981` (green) | Confirmations, active badges |
| `semantic-critical` | `bg-semantic-critical` | `#DC2626` (red) | Errors, destructive actions |

### Surface & Text Tokens

| Token | Usage |
|-------|-------|
| `semantic-surface-1` through `4` | Background layers (light/dark adaptive) |
| `semantic-text-primary` through `muted` | Text hierarchy |
| `semantic-data-viz-1` through `6` | Chart series colors |

---

## Prohibited Patterns

The compliance checker (`scripts/check-token-compliance.js`) detects these patterns:

### Errors (block merge)
- **Hardcoded hex in `style` attributes** — `style={{ color: '#0F766E' }}`
- **Hardcoded hex in `className` via Tailwind arbitrary values** — `className="bg-[#0F766E]"`
- **Hardcoded Tailwind color utilities** — `bg-blue-500`, `text-white`, `text-red-600`, `border-green-200`
- **Raw amber utilities** — `bg-amber-50`, `text-amber-800`, `fill-amber-500`

### Warnings (tracked against baseline)
- **Deprecated `inventory-*` classes** — `text-inventory-error-500`, `bg-inventory-primary-600`
- **Hardcoded Tailwind gray classes** — `bg-gray-100`, `text-gray-800`, `border-gray-200`
- **Hardcoded `bg-white`** — use `bg-background`, `bg-card`, or `bg-popover` instead

---

## Migration Reference

| Old Pattern | New Pattern |
|------------|-------------|
| `bg-gray-100` | `bg-background` or `bg-muted` |
| `bg-gray-200` | `bg-muted` |
| `bg-white` | `bg-background`, `bg-card`, or `bg-popover` |
| `text-gray-800` | `text-foreground` |
| `text-gray-600` | `text-muted-foreground` |
| `border-gray-200` | `border-border` |
| `border-gray-600` | `border-border` |
| `hover:bg-gray-100` | `hover:bg-accent` |
| `text-inventory-error-500` | `text-semantic-critical` |
| `bg-inventory-primary-600` | `bg-semantic-secondary` or `bg-primary` |
| `text-inventory-warning-500` | `text-semantic-warning` |
| `bg-inventory-success-500` | `bg-semantic-success` |

---

## Running the Compliance Check

```bash
# Check current violations
npm run token-compliance

# Set baseline (after intentional migration wave)
npm run token-compliance:baseline
```

The check runs automatically in CI on every PR via GitHub Actions.

---

## Exceptions Process

Some cases legitimately require raw color values:

1. **Third-party library overrides** — e.g., Clerk component theming, chart library configuration
2. **SVG fill/stroke values** — inline SVG attributes that don't support CSS variables
3. **CSS keyframe animations** — where CSS variables may cause performance issues

### How to request an exception

1. Add a comment above the line: `/* token-exception: <reason> */`
2. The compliance checker excludes files in `theme/` and test files by default
3. For broader exceptions, document in this file under "Approved Exceptions" below

### Approved Exceptions

| File | Pattern | Reason |
|------|---------|--------|
| `src/theme/*` | Raw hex values | Token definition files |
| `globals.css` | HSL values | CSS variable definitions |
| `tailwind.config.js` | Brand hex references | Theme configuration source |

---

## Baseline Policy

- The baseline tracks the **total count** of existing violations
- New violations above baseline **block merge** in CI
- After each migration wave, re-run `npm run token-compliance:baseline` to update
- Current Phase 7 baseline: **0 violations**. New hardcoded colors, deprecated `inventory-*` classes, raw amber utilities, and hardcoded gray/white utilities should be treated as rollout blockers unless explicitly documented as approved exceptions.
