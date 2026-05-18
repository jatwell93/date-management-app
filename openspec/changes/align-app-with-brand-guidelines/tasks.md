# Implementation Tasks

## 0. Prerequisites & Token Foundation

- [x] 0.0 Verify token source artifacts: obtain official PharmIQ design token artifacts (JSON/CSS). Document source location and checksum. If artifacts don't exist yet, create placeholder `design-tokens.json` with values from spec.md and note as "pending source verification".
- [x] 0.1 Create `frontend/src/theme/` directory and add `design-tokens.json` containing all raw PharmIQ brand token values: colors (teal `#0F766E`, sky blue `#0EA5E9`, amber `#D97706`, green `#10B981`, red `#DC2626`, navy `#0F172A`, sky-light `#F0F9FF`), dark canvas (`canvas-dark` #070E1A), atmospheric glows (teal-glow, amber-glow), hairline borders, 4-step surface ladder (light/dark), typography scale (Fraunces, Outfit, Inter), spacing (8px base grid), radius (8px for buttons), elevation, and motion values. Also generate `design-tokens.css` exporting the same values as CSS custom properties for direct CSS consumption. Verify both files' checksums match against source token artifacts.
- [x] 0.2 Create `frontend/src/theme/tokens.ts` that imports from `design-tokens.json` and exports typed token constants for use in JS/TS code (colors, spacing, typography, radius, elevation, motion as named exports).
- [x] 0.3 Create `frontend/src/theme/semantic-tokens.ts` defining and exporting all 6 semantic token categories (primary, warning, critical, surface, text, data-viz) with intent-based mappings that trace back to raw brand tokens. Each semantic token must have a clear purpose (e.g., `semantic-primary` → teal `#0F766E` for CTAs/selection states, `semantic-warning` → amber `#D97706` for alerts, `semantic-critical` → red `#DC2626` for errors/destructive actions).
- [x] 0.4 Refactor `frontend/tailwind.config.js`: replace the `inventory.*` color scale system with semantic token theme extensions sourced from `semantic-tokens.ts`. Add `semantic` color namespace (e.g., `bg-semantic-primary`, `text-semantic-text-primary`). Add atmospheric glow utilities (bg-teal-glow, bg-amber-glow), hairline border utilities (border-hairline), surface ladder utilities (surface-1 through surface-4 for both light and dark). Extend with font-family tokens: font-display (Fraunces), font-heading (Outfit), font-body (Inter), font-eyebrow (Outfit with tracking). Verify build passes with zero CSS warnings.
- [x] 0.5 Deduplicate and refactor `frontend/src/globals.css` and `frontend/src/index.css`: regenerate CSS custom properties from the token pipeline rather than hardcoded HSL values. Update `:root` and `.dark` blocks to derive from `design-tokens.json`. Update `body` font-family from system stack to brand default (Inter). Remove duplicate custom property blocks.
- [x] 0.6 Create `frontend/src/theme/SEMANTIC_COLORS_REFERENCE.md` documenting each semantic token's name, raw brand token source, intended usage context, and dark-mode variant.
- [x] 0.7 Integrate `design-tokens.css` (from 0.1) and semantic token CSS custom properties (`--semantic-primary`, `--semantic-warning`, etc.) into `globals.css` or as a separate import in `index.css`. Ensure both light and dark mode variants are generated. Import order: `design-tokens.css` → `semantic` layer → component styles.
- [x] 0.9 Define migration strategy: decide whether to remove `inventory-*` Tailwind colors entirely (breaking change) or deprecate with warning. Document decision in `frontend/TOKEN_MIGRATION_STRATEGY.md`. If removing, add codemod task to auto-replace `inventory-*` with `semantic-*` across codebase.

## 1. Wave 1 — Navigation Shell & Token Compliance Infrastructure

- [x] 1.1 Migrate navigation shell (header, sidebar, footer) in `frontend/src/App.tsx` to use semantic tokens. Replace all `inventory-*` Tailwind classes and hardcoded color references with `semantic-*` equivalents. Apply primary teal for navigation/CTAs/selection states.
- [x] 1.2 Update `frontend/src/components/LoginPage.tsx` and `frontend/src/components/ClerkAuthPage.tsx` to use semantic tokens for all styling.
- [x] 1.3 Implement ESLint rule or custom lint script (`frontend/scripts/check-token-compliance.js`) that scans component files for non-token styling patterns: hardcoded hex colors in `style` attributes, `className` strings containing raw hex, and direct `inventory-*` class usage where semantic tokens exist. Rule must report file, line, and suggested token replacement.
- [x] 1.4 Add the compliance check to CI pipeline (GitHub Actions workflow or pre-commit hook via `lint-staged`). All PRs must pass check before merge. Zero new non-token styles mergeable.
- [x] 1.5 Create `frontend/TOKENS_COMPLIANCE_GUIDE.md` explaining the compliance rule, approved token references, and exceptions process for cases where raw values are necessary (e.g., third-party library overrides).
- [x] 1.6 Run compliance check against existing codebase. Document current non-compliance count as baseline. Do not fix all at once — waves will address incrementally.
- [x] 1.7 Add component-level tests: create `frontend/src/components/__tests__/semantic-tokens.test.ts` verifying token exports match design-tokens.json values, semantic token mappings resolve to correct brand tokens, and dark mode variants apply correctly.
- [ ] 1.8 Visual regression verification for Wave 1: capture before/after screenshots of navigation shell (header, sidebar, footer) and login/auth pages. Target <5% pixel difference. Design owner sign-off required before proceeding to Wave 2.

## 2. Wave 2 — Forms, Buttons, Alerts, Badges

- [x] 2.1 Migrate form input components (`input.tsx`, `select.tsx`, `form.tsx`, `label.tsx`) in `frontend/src/components/ui/` to use semantic tokens. This covers all spec-enumerated form input types (text, select, checkbox, radio, textarea) — verify each input type renders correctly via `form.tsx` and `input.tsx` variants. Ensure focus rings use semantic-primary (teal). Verify visual parity with pre-migration appearance.
- [x] 2.2 Migrate button component (`button.tsx`) to use semantic tokens for all variants: primary (teal bg), secondary (sky blue), destructive (red), ghost/muted. Ensure hover/active/disabled states use semantic tokens.
- [x] 2.3 Migrate alert/notification components (`alert-dialog.tsx`, `toast.tsx`, `toast-provider.tsx`) to use semantic tokens. Map alert variants: info → sky blue, success → green, warning → amber, error → red.
- [x] 2.4 Add badge component (if not existing) or update badge-like patterns to use semantic tokens with variants: active (green), inactive (muted), pending (amber), success (green), error (red).
- [x] 2.5 Migrate `dialog.tsx` and `dropdown-menu.tsx` to use semantic tokens for backgrounds, borders, and interactive states.
- [x] 2.6 Migrate remaining UI components (`card.tsx`, `table.tsx`, `data-table.tsx`, `data-table-column-header.tsx`) to use semantic tokens.
- [ ] 2.7 Visual regression verification: compare screenshots of all Wave 2 components pre/post migration. Target <5% pixel difference. Design owner sign-off required.

## 3. Wave 3 — Dashboard Cards, Tables, Charts & Data Visualization

- [x] 3.1 Migrate dashboard card layout in `frontend/src/pages/DashboardPage.tsx` to use semantic tokens. Apply surface tokens for card backgrounds, text tokens for hierarchy, and primary token for key metrics highlights.
- [x] 3.2 Migrate table surfaces in `frontend/src/pages/` — `ExpiredItemsPage.tsx`, `DetailedExpiryReportPage.tsx`, `UsageReportPage.tsx`, `StoreAreaManagementPage.tsx`, `UserManagementPage.tsx` — to use semantic tokens for headers, rows, and state indicators (active/inactive/pending/error).
- [x] 3.3 Migrate chart and data visualization surfaces: `ExpiredLossReport.tsx`, `MarkdownCalculator.tsx`, `SubscriptionDashboard.tsx` — apply secondary (sky blue) for data viz, primary (teal) for emphasis, and ensure data-viz semantic tokens are used for chart series colors. Verify colorblind-accessible palette.
- [x] 3.4 Migrate `CSVUploadPage.tsx` to use semantic tokens for upload states (drag-over, uploading, success, error).
- [x] 3.5 Migrate remaining page components: `ReportsPage.tsx`, `SettingsPage.tsx`, `SubscriptionSettingsPage.tsx`, `OnboardingPage.tsx` to use semantic tokens.
- [ ] 3.6 Visual regression verification for Wave 3: screenshot comparison <5% pixel difference. Design owner sign-off required.
- [x] 3.7 Spacing audit: verify all Wave 1-3 surfaces use the 8px base grid spacing system from `design-tokens.json`. Grep/lint for non-standard spacing values (odd pixel values, non-multiples of 4/8) in migrated components. Document any approved exceptions.
  - Approved exceptions retained in `DetailedExpiryReportPage.tsx` and `UsageReportPage.tsx` for data-table minimum widths (`50px`, `60px`, `70px`, `100px`, `120px`, `140px`, `160px`, `180px`, `200px`) because they constrain dense tabular columns rather than spacing gaps and preserve existing responsive table behavior.
- [x] 3.8 Review hardening: promote reusable neutral/disabled button semantics into the shared `Button` primitive, update Wave 3 button call sites to consume them, align `UsageReportPage` data-viz border/fill tokens, strengthen legacy `inventory-*` utility detection, and keep frontend startup/docs behavior cross-platform and accurate after PR review.

## 4. Wave 4 — Zebra Scanner Brand Adaptations & Scan State Feedback

- [x] 4.1 Create `frontend/src/theme/scanner-adaptation.css` defining the Zebra scanner adaptation profile:
  - Touch targets: minimum 48×48 dp for scan-adjacent buttons
  - Focus indicators: 3px solid ring with brand teal `#0F766E`
  - Motion reduction: honor `prefers-reduced-motion` media query; disable decorative animations on scanner surfaces
  - Scan-state contrast: all scan lifecycle feedback states must have 4.5:1 minimum contrast ratio (WCAG AA)
  - No decorative clutter: reduce non-essential UI elements on scanner screens
  - Apply via `.scanner-context` CSS class selector on screen container
- [x] 4.2 Create `ScannerStateIndicator.tsx` component in `frontend/src/components/` rendering 5 scan lifecycle states:
  - **Ready**: Neutral blue `#0EA5E9`, circle outline icon, "Ready to scan"
  - **Scanning**: Animated teal `#0F766E` pulse, spinning circle icon, "Scanning..."
  - **Scanned/Success**: Green `#10B981`, checkmark icon, "Item scanned"
  - **Warning**: Amber `#D97706`, alert triangle icon, "Warning: duplicate scan"
  - **Error**: Red `#DC2626`, X icon, "Scan failed. Try again."
  - All states: accessible live region (`aria-live="polite"`), no layout shift on transition, <100ms state-change latency
- [x] 4.3 Integrate `ScannerStateIndicator` into `Scanner.tsx`, `CameraScanner.tsx`, and `HandheldScanner.tsx`. Apply `.scanner-context` class to scanner screen containers. Verify scan-state transitions work end-to-end.
- [x] 4.4 Update `HandheldScanToolbar.tsx` to use semantic tokens and `.scanner-context` adaptation profile. Ensure 48dp touch targets and 3px teal focus rings are active.
- [x] 4.5 Migrate `frontend/src/styles/handheld.css` rules into `scanner-adaptation.css` where they overlap. Deprecate `handheld.css` (add deprecation comment pointing to `scanner-adaptation.css`). Verify no regression on handheld viewport emulation.
- [x] 4.6 Create `scanner-brand-exceptions.md` with templated entries for all scanner-specific deviations from standard brand rules (e.g., "48dp touch targets" with justification "Handheld glove compatibility, industry standard for PDT devices"). All exceptions must have approval status and approver columns. Update PR template (`.github/PULL_REQUEST_TEMPLATE.md` or equivalent) to include a scanner brand exception checklist item requiring approval verification before merge.
- [x] 4.7 Manual testing on simulated handheld viewport: confirmed `.scanner-context` is active, scanner touch targets are 48dp+ (`Settings` 48×48, `Use Text Input` 144.6×52, `Reset Scanner` 378×52), focus ring computes to 3px teal, and scanner-state token contrast ratios are all WCAG AA or better (`ready` 5.57, `scanning` 4.86, `scanned` 4.84, `warning` 6.37, `error` 6.80).
- [x] 4.8 Performance test: browser-side measurement in handheld text mode confirmed 13ms from submit trigger to visible `Item scanned` state update.
- [x] 4.9 Add `ScannerStateIndicator` to component exports and create `frontend/src/components/__tests__/ScannerStateIndicator.test.tsx` verifying: all 5 states render with correct colors/icons/text, aria-live region present, no layout shift on state change, reduced-motion respected.
- [ ] 4.10 Visual regression verification for Wave 4: capture before/after screenshots of all scanner surfaces (ScanPage, CameraScanner, HandheldScanner, HandheldScanToolbar) in both desktop and simulated handheld viewports. Target <5% pixel difference. Design owner sign-off required.

## 5. Audience-Specific Typography & Voice

- [x] 5.1 Add brand font packages to `frontend/package.json`: `@fontsource/fraunces`, `@fontsource/outfit`, `@fontsource/inter` (or equivalent self-hosted font imports). Configure font loading with `font-display: swap` to avoid FOIT. Fraunces for display (48px+), Outfit for headings/UI, Inter for body text.
- [x] 5.2 Refactor `frontend/tailwind.config.js` font-family definitions: add `font-display` (Fraunces), `font-heading` (Outfit), `font-body` (Inter) for all contexts (brand v2.0 unified). Add `font-eyebrow` (Outfit 600, uppercase, tracking-wide) for eyebrow text. Update `globals.css` body font-family to use Inter as default.
- [x] 5.3 Apply unified brand typography: update all pages to use Fraunces for display text (48px+ hero only), Outfit for headings/UI components, Inter for body text. Add eyebrow text (Outfit 600 uppercase) where section headers are needed. Verify font stacks in browser DevTools.
- [x] 5.4 Verify typography in browser DevTools: load dashboard → confirm Fraunces (display), Outfit (headings), Inter (body); load scanner screen → confirm same stack (Outfit + Inter). Check that eyebrow text uses uppercase with slight tracking.
- [x] 5.5 Create `docs/voice-audit.md` documenting the messaging audit findings: list of all user-facing strings reviewed, classification as owner/worker context, whether language matches spec (margins/outcomes for owner, direct utility for worker), and any mismatches fixed.

## 6. Amber Restraint Enforcement

- [ ] 6.1 Create grep script or extend compliance check to detect all amber (`#D97706` / `amber-*` / `inventory-warning-*`) color usages. Verify each usage falls within approved contexts: warning alert states, emphasis badges (pending), form validation warnings, scan-state "pending" feedback.
- [ ] 6.2 Fix any amber usages outside approved contexts: replace decorative amber backgrounds/borders with appropriate semantic tokens (primary, secondary, or surface). Ensure amber does NOT appear in: decorative backgrounds/borders, secondary buttons, charts (unless explicit warning indicator), navigation/headers.
- [ ] 6.3 Create `frontend/AMBER_USAGE_GUIDE.md` documenting approved amber usage contexts and exceptions process for future cases.
- [ ] 6.4 Add amber restraint check to CI pipeline alongside token compliance check. Zero amber decorative usage allowed in merged code.

## 7. Validation, Documentation & Rollout Readiness

- [ ] 7.1 Run full token compliance check against entire frontend codebase. Target: 100% of in-scope components reference semantic tokens, 0 hardcoded hex colors in style attributes or className.
- [ ] 7.2 Run visual regression suite for all 4 waves. All comparisons <5% pixel difference. Design owner sign-off recorded per wave.
- [ ] 7.3 Run accessibility audit: Lighthouse/axe-core confirms 0 contrast violations across all surfaces including scanner context. Verify all focus indicators visible and 4.5:1+ contrast.
- [ ] 7.4 Verify ESLint/compliance rule catches intentional break: introduce a hardcoded hex color in a component, run check, confirm it reports file/line/token and blocks merge. Remove test break.
- [ ] 7.5 Verify `ScannerStateIndicator` all 5 states render correctly with brand-aligned colors, distinct icons, clear text labels, and aria-live announcements. Performance test confirms <100ms latency.
- [ ] 7.6 Verify `scanner-brand-exceptions.md` has all entries with documented approval before code merge. PR review process confirms approval column populated.
- [ ] 7.7 Run frontend build (`npm run build`) with zero errors and zero CSS warnings related to missing or invalid token references.
- [ ] 7.8 Run existing test suites: `npm test` passes with no regressions. Update any tests that reference old `inventory-*` class names to use new semantic token classes.
- [ ] 7.9 Create `frontend/TOKEN_MIGRATION_STRATEGY.md` if not created in 0.9: document migration phases, codemod commands for bulk replacement, rollback procedure if issues arise, and timeline for removing deprecated `inventory-*` tokens.
- [ ] 7.10 Final documentation sync: ensure all created docs (`SEMANTIC_COLORS_REFERENCE.md`, `TOKENS_COMPLIANCE_GUIDE.md`, `AMBER_USAGE_GUIDE.md`, `scanner-brand-exceptions.md`, `docs/voice-audit.md`, `TOKEN_MIGRATION_STRATEGY.md`) are consistent with each other and with the implemented code. Update any discrepancies.
- [ ] 7.11 Verify design owner sign-off is recorded for all 4 waves (Wave 1: Task 1.8, Wave 2: Task 2.7, Wave 3: Task 3.6, Wave 4: Task 4.10) and for amber restraint review (Task 6.2). Compile sign-off log.
- [ ] 7.12 Use `/expect` to have the AI agent run UI validation with Expect + Playwright and confirm brand updates are accurate and error-free.
- [ ] 7.13 Run `npx -y --verbose react-doctor@latest .` and action all findings before rollout sign-off.
