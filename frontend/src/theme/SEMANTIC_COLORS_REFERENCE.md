# PharmIQ Semantic Colors Reference

> Single source of truth for semantic token mappings. All components MUST reference semantic tokens, never raw brand tokens.

## Token Categories

### 1. `semantic-primary` — CTAs, Selection, Navigation

| Token | Value | Source | Usage |
|-------|-------|--------|-------|
| `semantic-primary` | `#0F766E` | brand teal | Primary buttons, active nav, focus rings, selection states |
| `semantic-primary-foreground` | `#FFFFFF` | — | Text on primary backgrounds |
| `semantic-primary-hover` | `#115E59` | teal-800 | Hover state for primary interactive elements |
| `semantic-primary-active` | `#134E4A` | teal-900 | Active/pressed state |
| `semantic-primary-muted` | `#CCFBF1` | teal-100 | Subtle primary backgrounds (badges, chips) |
| `semantic-primary-muted-foreground` | `#0F766E` | brand teal | Text on muted primary backgrounds |

### 2. `semantic-secondary` — Data Viz, Informational, Links

| Token | Value | Source | Usage |
|-------|-------|--------|-------|
| `semantic-secondary` | `#0EA5E9` | brand sky-blue | Data visualization primary, informational highlights, links |
| `semantic-secondary-foreground` | `#FFFFFF` | — | Text on secondary backgrounds |
| `semantic-secondary-hover` | `#0284C7` | sky-600 | Hover state |
| `semantic-secondary-active` | `#0369A1` | sky-700 | Active/pressed state |
| `semantic-secondary-muted` | `#F0F9FF` | brand sky-light | Subtle info backgrounds |
| `semantic-secondary-muted-foreground` | `#0369A1` | sky-700 | Text on muted secondary backgrounds |

### 3. `semantic-warning` — Alerts, Pending, Validation Warnings

> ⚠️ **Amber Restraint**: This token is restricted to alert/emphasis contexts ONLY. See `AMBER_USAGE_GUIDE.md`.

| Token | Value | Source | Usage |
|-------|-------|--------|-------|
| `semantic-warning` | `#D97706` | brand amber | Warning alerts, pending badges, form validation warnings |
| `semantic-warning-foreground` | `#FFFFFF` | — | Text on warning backgrounds |
| `semantic-warning-hover` | `#B45309` | amber-700 | Hover state |
| `semantic-warning-active` | `#92400E` | amber-800 | Active/pressed state |
| `semantic-warning-muted` | `#FEF3C7` | amber-100 | Subtle warning backgrounds |
| `semantic-warning-muted-foreground` | `#92400E` | amber-800 | Text on muted warning backgrounds |

### 4. `semantic-success` — Confirmations, Active States

| Token | Value | Source | Usage |
|-------|-------|--------|-------|
| `semantic-success` | `#10B981` | brand green | Success confirmations, active badges, positive indicators |
| `semantic-success-foreground` | `#FFFFFF` | — | Text on success backgrounds |
| `semantic-success-hover` | `#059669` | green-600 | Hover state |
| `semantic-success-active` | `#047857` | green-700 | Active/pressed state |
| `semantic-success-muted` | `#D1FAE5` | green-100 | Subtle success backgrounds |
| `semantic-success-muted-foreground` | `#047857` | green-700 | Text on muted success backgrounds |

### 5. `semantic-critical` — Errors, Destructive Actions

| Token | Value | Source | Usage |
|-------|-------|--------|-------|
| `semantic-critical` | `#DC2626` | brand red | Error messages, destructive buttons, scan failures |
| `semantic-critical-foreground` | `#FFFFFF` | — | Text on critical backgrounds |
| `semantic-critical-hover` | `#B91C1C` | red-700 | Hover state |
| `semantic-critical-active` | `#991B1B` | red-800 | Active/pressed state |
| `semantic-critical-muted` | `#FEE2E2` | red-100 | Subtle error backgrounds |
| `semantic-critical-muted-foreground` | `#991B1B` | red-800 | Text on muted critical backgrounds |

### 6. `semantic-surface` — Backgrounds, Card Layers

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `semantic-surface-1` | `#FFFFFF` | `#0F172A` | Page background, base layer |
| `semantic-surface-2` | `#F8FAFC` | `#1E293B` | Card backgrounds, elevated surfaces |
| `semantic-surface-3` | `#F1F5F9` | `#334155` | Nested containers, table headers |
| `semantic-surface-4` | `#E2E8F0` | `#475569` | Borders, dividers, disabled backgrounds |
| `semantic-canvas` | `#070E1A` | `#070E1A` | Scanner camera placeholder canvas and modal overlays with opacity modifiers |

### 7. `semantic-text` — Text Hierarchy

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `semantic-text-primary` | `#0F172A` | `#F1F5F9` | Headings, primary content |
| `semantic-text-secondary` | `#475569` | `#CBD5E1` | Body text, descriptions |
| `semantic-text-tertiary` | `#64748B` | `#94A3B8` | Captions, timestamps |
| `semantic-text-muted` | `#94A3B8` | `#64748B` | Placeholder text, disabled labels |
| `semantic-text-inverse` | `#FFFFFF` | `#0F172A` | Text on dark/light contrasting backgrounds |

### 8. `semantic-data-viz` — Chart Series Colors

| Token | Value | Source | Usage |
|-------|-------|--------|-------|
| `semantic-data-viz-1` | `#0F766E` | brand teal | Primary data series |
| `semantic-data-viz-2` | `#0EA5E9` | brand sky-blue | Secondary data series |
| `semantic-data-viz-3` | `#D97706` | brand amber | Tertiary data series |
| `semantic-data-viz-4` | `#10B981` | brand green | Fourth data series |
| `semantic-data-viz-5` | `#DC2626` | brand red | Fifth data series |
| `semantic-data-viz-6` | `#0F172A` | brand navy | Sixth data series |

## Tailwind Class Usage

```html
<!-- Primary button -->
<button class="bg-semantic-primary text-semantic-primary-foreground hover:bg-semantic-primary-hover">

<!-- Warning badge -->
<span class="bg-semantic-warning-muted text-semantic-warning-muted-foreground">

<!-- Surface card -->
<div class="bg-semantic-surface-2 text-semantic-text-primary">

<!-- Error message -->
<p class="text-semantic-critical">
```

## Dark Mode

Surface and text tokens use CSS custom properties (`var(--surface-*)`, `var(--text-*)`) that automatically switch values when `.dark` class is applied. Color intent tokens (primary, warning, etc.) remain constant across themes for brand consistency.
