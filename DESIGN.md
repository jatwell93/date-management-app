# Design

## Source of Truth

This file gives design tooling a standard `DESIGN.md` entry point. The complete PharmIQ visual identity remains in `brand-identity/brand-guidelines.md`, supported by:

- `brand-identity/design-tokens.json`
- `brand-identity/design-tokens.css`
- `frontend/src/theme/design-tokens.json`
- `frontend/src/theme/design-tokens.css`
- `frontend/src/theme/semantic-tokens.ts`
- `frontend/tailwind.config.js`

When this file and `brand-identity/brand-guidelines.md` differ, treat `brand-identity/brand-guidelines.md` as the deeper source and update this file to match.

## Visual Theme

PharmIQ product surfaces use a restrained, task-focused product register. Design should serve expiry tracking, stock management, reporting, and handheld scanning workflows. Familiar product patterns are preferred: side navigation, top bars, tables, filters, forms, status banners, tabs, and clear inline feedback.

Marketing and brand assets may use the dark canvas system more dramatically, but authenticated app surfaces should remain operational, dense enough for repeated work, and visually calm.

## Brand Personality

The interface should feel like expert pharmacy infrastructure: calm, authoritative, precise, reliable, and commercially aware. It should not feel playful, sterile, generic, over-decorated, or like an undifferentiated blue healthcare dashboard.

## Colour System

Use semantic tokens in product code rather than raw brand values.

Core brand colours:

- PharmIQ Teal: `#0F766E`, for primary actions, focus, active navigation, selection, and the first chart series.
- Sky Blue: `#0EA5E9`, for informational highlights, links, and secondary data roles.
- Amber: `#D97706`, for expiry warnings, dead-stock flags, pending states, and genuine urgency only.
- Green: `#10B981`, for success and confirmation.
- Red: `#DC2626`, for errors, destructive actions, expired states, and failed scans.
- Navy: `#0F172A`, for core text and elevated dark surfaces.
- Dark Canvas: `#070E1A`, for marketing heroes and high-emphasis brand sections.

Product colour strategy is restrained by default: neutral surfaces, one primary action colour, and state colours only where they communicate status. Amber is scarce. If more than one amber element appears at rest in a viewport, reassess the hierarchy.

## Surfaces

Light surface ladder:

- `surface-1`: `#FFFFFF`
- `surface-2`: `#F8FAFC`
- `surface-3`: `#F1F5F9`
- `surface-4`: `#E2E8F0`

Dark surface ladder:

- `canvas-dark`: `#070E1A`
- `dark-surface-1`: `#0F172A`
- `dark-surface-2`: `#1E293B`
- `dark-surface-3`: `#334155`
- `dark-surface-4`: `#475569`

Build depth with adjacent surfaces and hairline borders before using heavy shadows. Do not nest cards.

## Typography

Use the existing PharmIQ type stack:

- Display: Fraunces, reserved for large brand or marketing moments.
- Heading and UI: Outfit.
- Body and dense product UI: Inter.
- Code or technical values: Source Code Pro or the configured monospace fallback.

In product UI, use Inter or Outfit for labels, buttons, tables, forms, and data. Do not use display type for controls or dense operational text. Use tabular numerals for metrics, expiry counts, inventory quantities, and report values.

## Components

Shared UI primitives in `frontend/src/components/ui` should remain the default extension points for buttons, badges, forms, labels, selects, dialogs, dropdowns, cards, tables, and toasts. Prefer extending these components over creating parallel primitives.

Every interactive component needs clear default, hover, focus, active, disabled, loading, and error states. Loading inside content should use skeletons where practical. Empty states should explain the next action, not just state that nothing exists.

## Layout

Use predictable product layouts:

- Desktop: sidebar or app-shell navigation, top context bar, responsive content grids, tables, and reporting panels.
- Tablet: collapsed or compact navigation, two-column where useful.
- Mobile and handheld: single-column task flow, drawer or bottom navigation where appropriate, large touch targets, scan-first hierarchy.

Handheld scanner flows must preserve at least 48px tap targets, clear sync state, visible scan result state, and layouts that work on small pharmacy PDT screens.

## Motion

Motion should communicate state, not decorate the app. Use short transitions around 150 to 250ms for hover, reveal, loading, scan feedback, sync state, and inline status changes. Respect reduced-motion preferences. Avoid choreographed page-load sequences.

## Accessibility

Target WCAG AA or better. Do not use `#94A3B8` or similarly muted colours for important body text on light surfaces. Do not use white text on amber. Pair colour states with text, icon, or structural cues. Maintain visible focus states and keyboard accessibility.

## Bans

Do not use gradient text, decorative glassmorphism, side-stripe accent borders, nested cards, identical repeated card grids, decorative amber, true black, true white in new token work, or marketing hero patterns inside authenticated product workflows.
