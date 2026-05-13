## Why

The application currently uses an ad-hoc styling foundation: hardcoded hex color scales in `tailwind.config.js`, duplicated HSL custom properties across `globals.css` and `index.css`, system font stacks instead of brand typography, and no semantic token layer. This creates brand drift—components reference raw color values inconsistently, there is no enforcement mechanism to prevent off-brand styling, and the Zebra scanner workflows lack a formalized adaptation profile. Before adding more surfaces or features, the app needs a token-driven brand system that is the single source of truth for color, typography, spacing, and motion, with automated compliance validation.

## What Changes

- Establish a PharmIQ design token pipeline: `design-tokens.json` (raw brand tokens) → `semantic-tokens.ts` (intent-based mappings) → `tailwind.config.js` (semantic theme extensions) → CSS custom properties in `globals.css`.
- Replace the current `inventory.*` color scale system with semantic token references (`bg-semantic-primary`, `text-semantic-text-primary`, etc.) so components never reference raw brand tokens directly.
- Apply brand typography: Space Grotesk (headings) + Inter (body) for owner-facing surfaces; Plus Jakarta Sans (headings) + DM Sans (body) for worker-facing surfaces.
- Migrate all 9 enumerated core surfaces (navigation, forms, buttons, alerts, badges, dashboards, tables, charts, scanner workflows) to use the semantic token system across 4 implementation waves.
- Constrain amber (#D97706) usage to alert/emphasis contexts only, with a CI-enforced grep check to prevent decorative overuse.
- Define and apply a Zebra scanner adaptation profile (`scanner-adaptation.css`) with 48dp touch targets, 3px teal focus rings, `prefers-reduced-motion` support, and 4.5:1 contrast scan-state feedback.
- Implement a `ScannerStateIndicator` component with 5 brand-aligned scan states (ready, scanning, scanned, warning, error) and <100ms state-change latency.
- Add ESLint rule or pre-commit hook to detect non-token styling (hardcoded hex in style attributes or className) and block merge.
- Track scanner-specific brand exceptions in `scanner-brand-exceptions.md` with approval workflow.

## Capabilities

### New Capabilities

- `brand-design-token-pipeline`: Structured token flow from raw PharmIQ brand tokens through semantic intent mappings to Tailwind theme and CSS custom properties, ensuring all styling derives from a single auditable source.
- `semantic-token-compliance-enforcement`: Automated validation (ESLint rule + CI check) that detects hardcoded color/font values in component code and blocks merge until replaced with semantic tokens.
- `zebra-scanner-adaptation-profile`: Formalized CSS adaptation layer for handheld scan workflows with enlarged touch targets, high-visibility focus indicators, motion reduction, and contrast-guaranteed scan-state feedback.
- `scanner-state-indicator`: Brand-aligned component rendering 5 scan lifecycle states (ready, scanning, scanned, warning, error) with accessible live regions and <100ms visual feedback latency.
- `scanner-brand-exception-tracking`: Documented exception log with approval workflow for any scanner-specific brand deviations.

### Modified Capabilities

- `frontend-ui-component-library`: All 14 shadcn UI components (`button.tsx`, `card.tsx`, `input.tsx`, `select.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `form.tsx`, `table.tsx`, `data-table.tsx`, `dropdown-menu.tsx`, `toast.tsx`, `toast-provider.tsx`, `label.tsx`, `data-table-column-header.tsx`) will consume semantic tokens instead of raw color references.
- `frontend-page-surfaces`: All 12 page components (`DashboardPage`, `ScanPage`, `CSVUploadPage`, `OnboardingPage`, `ReportsPage`, `DetailedExpiryReportPage`, `ExpiredItemsPage`, `UsageReportPage`, `SettingsPage`, `StoreAreaManagementPage`, `SubscriptionSettingsPage`, `UserManagementPage`) will migrate to semantic token references.
- `frontend-handheld-styling`: `handheld.css` will be superseded by `scanner-adaptation.css` with the formalized adaptation profile, preserving existing touch target and layout rules while adding brand-aligned focus rings and scan-state contrast.
- `frontend-tailwind-configuration`: `tailwind.config.js` will replace the `inventory.*` color scale with semantic token theme extensions sourced from `semantic-tokens.ts`.
- `frontend-global-styles`: `globals.css` and `index.css` will be deduplicated and refactored to derive all custom properties from the token pipeline rather than hardcoded HSL values.

## Impact

- **Frontend theme infrastructure**: New `frontend/src/theme/` directory with `design-tokens.json`, `design-tokens.css`, `semantic-tokens.ts`, `tokens.ts`, `scanner-adaptation.css`, and `SEMANTIC_COLORS_REFERENCE.md`. This is the foundational change all other work depends on.
- **Frontend Tailwind configuration**: `tailwind.config.js` color system rewritten from `inventory.*` scales to semantic token references. All existing `inventory-*` Tailwind class usage across components must be migrated.
- **Frontend global CSS**: `globals.css` and `index.css` deduplicated; CSS custom properties regenerated from token pipeline. Body font-family updated from system stack to brand fonts.
- **Frontend UI components**: All 14 shadcn UI components in `frontend/src/components/ui/` updated to reference semantic tokens. No visual regression expected (same colors, different reference path).
- **Frontend page components**: All 12 page components in `frontend/src/pages/` updated across 4 waves. Each wave includes visual regression verification.
- **Frontend scanner components**: `Scanner.tsx`, `CameraScanner.tsx`, `HandheldScanner.tsx`, `HandheldScanToolbar.tsx` updated with `.scanner-context` class and `ScannerStateIndicator` integration.
- **Frontend handheld CSS**: `handheld.css` rules preserved and migrated into `scanner-adaptation.css` where they overlap; `handheld.css` may be deprecated after migration.
- **CI/CD pipeline**: New ESLint rule or pre-commit hook added to detect non-token styling. CI job runs compliance check on all PRs.
- **Documentation**: New `frontend/TOKENS_COMPLIANCE_GUIDE.md`, `frontend/AMBER_USAGE_GUIDE.md`, `frontend/TOKEN_MIGRATION_STRATEGY.md`, `frontend/src/theme/SEMANTIC_COLORS_REFERENCE.md`, `scanner-brand-exceptions.md`, and `docs/voice-audit.md`.
