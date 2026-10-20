# PharmIQ Semantic Colors Reference

> Single source of truth for semantic token mappings. All components MUST reference semantic tokens, never raw brand tokens.

## Text contrast rules (read first)

The DEFAULT sky, green and amber values are **fill, icon and border colours**. They fail WCAG AA as text on white and behind white text:

| DEFAULT | On white | Use instead for text / white-label fills |
|---------|----------|------------------------------------------|
| `semantic-secondary` `#0EA5E9` | 2.8:1 | `semantic-secondary-strong` `#0369A1` (5.9:1) |
| `semantic-success` `#10B981` | 2.5:1 | `semantic-success-strong` `#047857` (5.5:1) |
| `semantic-warning` `#D97706` | 3.2:1 | `semantic-warning-strong` `#B45309` (5.0:1) |

- Text on white: `text-semantic-{intent}-strong`.
- Text on a `-muted` background: `text-semantic-{intent}-muted-foreground`.
- A fill behind white (`-foreground`) text: `bg-semantic-{intent}-strong`, hover `-strong-hover`.
- Teal primary (`#0F766E`, 5.5:1) and critical red (`#DC2626`, 4.8:1) are AA-safe at DEFAULT.
- Links are teal (`text-semantic-primary`), never sky blue.
- `semantic-text-muted` (`#94A3B8`, 2.6:1) is decorative only (placeholders, disabled), never information.

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

### 2. `semantic-secondary` — Data Viz, Informational

| Token | Value | Source | Usage |
|-------|-------|--------|-------|
| `semantic-secondary` | `#0EA5E9` | brand sky-blue | Data visualization, informational dots/borders/icons. Not text, not links |
| `semantic-secondary-strong` | `#0369A1` | sky-700 | Informational text on white; fill behind white text |
| `semantic-secondary-strong-hover` | `#075985` | sky-800 | Hover/active for `-strong` fills |
| `semantic-secondary-foreground` | `#FFFFFF` | — | Text on secondary backgrounds |
| `semantic-secondary-hover` | `#0284C7` | sky-600 | Hover state |
| `semantic-secondary-active` | `#0369A1` | sky-700 | Active/pressed state |
| `semantic-secondary-muted` | `#F0F9FF` | brand sky-light | Subtle info backgrounds |
| `semantic-secondary-muted-foreground` | `#0369A1` | sky-700 | Text on muted secondary backgrounds |

### 3. `semantic-warning` — Alerts, Pending, Validation Warnings

> ⚠️ **Amber Restraint**: This token is restricted to alert/emphasis contexts ONLY. See `AMBER_USAGE_GUIDE.md`.

| Token | Value | Source | Usage |
|-------|-------|--------|-------|
| `semantic-warning` | `#D97706` | brand amber | Warning dots, borders, icons. Not text (3.2:1) |
| `semantic-warning-strong` | `#B45309` | amber-700 | Warning text on white; fill behind white text |
| `semantic-warning-strong-hover` | `#92400E` | amber-800 | Hover/active for `-strong` fills |
| `semantic-warning-foreground` | `#FFFFFF` | — | Text on warning backgrounds |
| `semantic-warning-hover` | `#B45309` | amber-700 | Hover state |
| `semantic-warning-active` | `#92400E` | amber-800 | Active/pressed state |
| `semantic-warning-muted` | `#FEF3C7` | amber-100 | Subtle warning backgrounds |
| `semantic-warning-muted-foreground` | `#92400E` | amber-800 | Text on muted warning backgrounds |

### 4. `semantic-success` — Confirmations, Active States

| Token | Value | Source | Usage |
|-------|-------|--------|-------|
| `semantic-success` | `#10B981` | brand green | Success dots, borders, icons. Not text (2.5:1) |
| `semantic-success-strong` | `#047857` | green-700 | Success text on white; fill behind white text (Button `success`, success toast) |
| `semantic-success-strong-hover` | `#065F46` | green-800 | Hover/active for `-strong` fills |
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
| `semantic-canvas-foreground` | `#FFFFFF` | `#FFFFFF` | Text rendered directly on the dark scanner canvas |

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

Series 2 (2.8:1) and series 4 (2.5:1) are below the 3:1 non-text contrast floor on white (WCAG 1.4.11); series 3 (3.2:1) passes but is marginal for thin lines. When a series is drawn alone, or as a 1-2px line, use the strong variant (`semantic-data-viz-strong-*`, `semanticDataVizStrong` in `semantic-tokens.ts`):

| Token | Value | On white |
|-------|-------|----------|
| `semantic-data-viz-strong-2` | `#0369A1` | 5.9:1 |
| `semantic-data-viz-strong-3` | `#B45309` | 5.0:1 |
| `semantic-data-viz-strong-4` | `#047857` | 5.5:1 |

Multi-series charts may keep the brand palette when every series also has a label, legend entry or pattern.

Chart.js defaults (14px Inter, `semantic-text-secondary` ink for ticks/legend/titles, hairline grid, animation off under `prefers-reduced-motion`) are set once in `components/charts/chartDefaults.ts` when the chart chunk loads. Per-chart options still override them.

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

## shadcn/ui tokens vs semantic tokens

`globals.css` also defines the shadcn/ui HSL tokens (`bg-primary`, `text-muted-foreground`, `text-destructive`, ...). Two differ from the semantic layer:

- **`--primary` is navy** (`#0F172A`-ish), while `semantic-primary` is **teal**. `LoadingSpinner`, `ErrorBoundary`'s refresh button, the shell's loading/error states and any page using `bg-primary` render navy. This is a known split, **not** recoloured here because it changes several pages at once. Follow-up: point `--primary` at teal (or migrate those call sites to `semantic-primary`) behind a visual check.
- `--destructive` is `#DC2626` (matches `semantic-critical`); `--muted-foreground` is 40% L (5.6:1 on `--muted`, 6.1:1 on white).

New code should use `semantic-*` classes.

## Dark Mode

Surface and text tokens use CSS custom properties (`var(--surface-*)`, `var(--text-*)`) that automatically switch values when `.dark` class is applied. Color intent tokens (primary, warning, etc.) remain constant across themes for brand consistency.

Dark mode is not enabled in the app today. The `-muted` / `-muted-foreground` intent pairs are light-only hex values (no `.dark` override). They are deliberately not converted to CSS variables yet: a mechanical swap would need a dark value for every pair, and those values need a visual pass on the dark surface ladder first. Convert them when dark mode is scheduled.
