# Brand Alignment Implementation Tasks

## Automation & Verification Strategy

This plan uses **expect** (Playwright-based UI verification) to eliminate manual screenshot comparisons and automate accessibility checks per wave. Pre-commit validation scripts verify token compliance before code reaches CI.

**Verification flow per wave:**
1. Code changes made (Token Foundation → Surface Alignment)
2. Pre-commit scripts run: verify-tokens.js, verify-build.sh, verify-amber.js (block merge if fail)
3. `expect open http://localhost:5173` verifies UI rendering and state transitions
4. `expect playwright` runs axe-core scan inline; results auto-saved to `docs/wave-{N}-a11y.json`
5. Existing test suite confirms no functional regression
6. Results recorded in wave approval doc; gate pass/fail blocks next wave

**Result:** Reduced manual verification burden; automated checks happen before and after each wave.

---

## 1. Discovery And Baseline

- [ ] 1.1 Inventory current theme architecture: read `frontend/src/styles/theme.css`, `frontend/tailwind.config.js`, and component style usage in `frontend/src/components/` (grep for hardcoded color/font values). Document findings in `openspec/changes/align-app-with-brand-guidelines/baseline-audit.md` (new file).
- [ ] 1.2 Capture baseline screenshots of key screens (dashboard, forms, alerts, tables, heat-map chart, scanner workflows if available) and run axe-core accessibility scan. Save screenshots in `docs/baseline-screenshots/` with accessibility report in `docs/baseline-a11y-report.json`.
- [ ] 1.3 Coordinate with integrate-pharmacy-pdt-devices change owner to confirm exact Zebra scanner screens in scope for Wave 4; document list and scan-state flows in `openspec/changes/align-app-with-brand-guidelines/scanner-screens-scope.md` (new file).

## 2. Token Foundation And Semantic Mapping

- [ ] 2.1 Copy `brand-identity-pharma-apps/brand-identity/design-tokens.json` and `design-tokens.css` into `frontend/src/theme/` as canonical source; verify checksums match brand source.
- [ ] 2.2 Create `frontend/src/theme/semantic-tokens.ts` exporting semantic mappings (TypeScript object) for primary, warning, critical, surface, text, data-viz intents. Map each to official brand tokens from JSON. Add to `frontend/tsconfig.json` path alias `@tokens`.
- [ ] 2.3 Update `frontend/tailwind.config.js` to extend theme with semantic token values from 2.2; verify build succeeds and no new CSS warnings. Ensure `frontend/src/styles/theme.css` is still imported for fallback.

## 3. Core Surface Brand Alignment (Wave 1 & 2)

### 3.1 Wave 1 — App Shell & Navigation
- [ ] 3.1.1 Audit `frontend/src/layouts/Layout.tsx`, header, sidebar, footer components; identify all hardcoded colors/fonts.
- [ ] 3.1.2 Replace with semantic token usage (`bg-brand-teal`, `text-primary`, etc). Run `npm run build` to verify Tailwind extends without warnings.
- [ ] 3.1.3 Use `expect open http://localhost:5173` to verify shell renders: teal navigation, proper spacing, no visual jank. Test mobile breakpoint (375px viewport). Verify no console errors.
- [ ] 3.1.4 Run axe-core scan in `expect playwright` action. Require 0 critical, <5 serious violations. Save report to `docs/wave-1-a11y.json`. Record results in `docs/wave-1-approval/shell.md`. Do NOT proceed to 3.2 until gate passes.

### 3.2 Wave 2 — Form Controls, Buttons, Alerts, Badges  (includes typography: Space Grotesk headings + Inter body)
- [ ] 3.2.1 Update all form controls in `frontend/src/components/FormInputs/`, buttons in `frontend/src/components/Button/` to use semantic tokens.
- [ ] 3.2.2 Run `frontend/scripts/verify-tokens.js` (node script) to grep all changed `.tsx` for hardcoded colors. Fail if any found. Grep for amber: should only appear in `.error`, `.warning`, `.alert`, `.pending` classes.
- [ ] 3.2.3 Use `expect open http://localhost:5173/dashboard` to verify form controls render: buttons teal/red, alerts amber/green/red, badges colored correctly. Test focus states (Tab key). Snapshot each state.
- [ ] 3.2.4 Run axe-core scan in `expect playwright` action. Verify form labels have 4.5:1 contrast minimum. Run `npm test` to confirm form submission tests pass. Record results in `docs/wave-2-approval/forms-buttons.md`. Do NOT proceed to 3.3 until gate passes.

### 3.3 Wave 3 — Data Presentation (Tables, Charts, Dashboards)
- [ ] 3.3.1 Audit `frontend/src/components/Tables/`, `frontend/src/components/Charts/` (especially heat-map) for color usage; replace with semantic tokens.
- [ ] 3.3.2 Update chart palette per brand data-viz roles. Add icons/patterns to chart series (no color-alone differentiation). Verify legend/tooltips have accessible labels.
- [ ] 3.3.3 Use `expect open http://localhost:5173/dashboard` to verify dashboard layout: cards use 8px grid spacing, charts render with brand palette, heat-map uses semantic colors + icons. Test on mobile (375px) and tablet (768px) viewports. Snapshot each.
- [ ] 3.3.4 Run axe-core scan in `expect playwright` action. Confirm table sorting, pagination, filtering work (no console errors, no layout shift). Run `npm test` for existing table/chart tests. Record results in `docs/wave-3-approval/data-viz.md`. Do NOT proceed to 4.x until gate passes.

## 4. Zebra Scanner Adaptation Profile (Wave 4)

- [ ] 4.1.1 Create `frontend/src/theme/scanner-adaptation.css` defining: touch targets ≥48dp, focus ring 3px teal, honor `prefers-reduced-motion`, scan-state contrast ≥4.5:1. Apply via `.scanner-context` class selector.
- [ ] 4.1.2 Create `frontend/src/components/ScannerStateIndicator.tsx` displaying 5 scan states (Ready/blue → Scanning/teal pulse → Scanned/green → Warning/amber → Error/red) with icons, text labels, and aria-live announcements. Verify <100ms state-change latency.
- [ ] 4.1.3 Create `openspec/changes/align-app-with-brand-guidelines/scanner-brand-exceptions.md` documenting any brand exceptions discovered with columns: [Exception Name] | [Justification] | [Brand Rule Preserved] | [Approval Status]. Do NOT implement unapproved exceptions.
- [ ] 4.2.1 Apply `.scanner-context` class to Zebra screens confirmed in Task 1.3. Use `expect open http://localhost:5173` to test scanner workflow on mobile viewport (375px). Verify 48dp touch targets, 3px focus ring, scan state feedback renders.
- [ ] 4.2.2 Run `expect playwright` to measure scan state transition latency (performance observer); confirm <100ms. Verify no layout shift during state change. Run axe-core scan on scanner page; require 0 critical violations.
- [ ] 4.3.1 Any new exceptions discovered during 4.2.x work: add to scanner-brand-exceptions.md and route to brand owner for approval. Block merge until approved.

## 5. Voice, Typography, And Audience Context

**Note: Tasks 5.1-5.2 are completed as part of Waves 1-2. Tasks 5.3 (tagline) runs end-of-implementation.**

- [ ] 5.1.1 (Wave 1) Audit owner-facing copy in `frontend/src/pages/Dashboard/`, `frontend/src/components/ReportView/`. Ensure language emphasizes margins/outcomes (e.g., "Recover dead stock" not "Dead stock dashboard").
- [ ] 5.1.2 (Wave 1) Add Space Grotesk (headings) + Inter (body) font stack to `frontend/tailwind.config.js` with fallbacks. Update `frontend/src/index.css` to import fonts.
- [ ] 5.2.1 (Wave 2) Audit worker/scanner copy (Expiry Mate, Pay Checker concepts). Ensure worker language is utility-focused (e.g., "Know what you're owed").
- [ ] 5.2.2 (Wave 2) Add Plus Jakarta Sans (headings) + DM Sans (body) to Tailwind config with fallbacks. Import fonts in `frontend/src/index.css`.
- [ ] 5.3.1 (After all waves) Grep all code for tagline "Smart Ops. Better Margins." Confirm it appears only in owner-facing contexts, not worker/scanner surfaces.
- [ ] 5.3.2 (After all waves) Verify zero mismatched language (no margin/profit talk in worker UI). Write report to `docs/voice-audit.md`.

## 6. Compliance Gates And Verification

**Note: expect runs automatically in wave tasks (3.x/4.x). Verification scripts 6.1 setup before Wave 1.**

- [ ] 6.1.1 Create `frontend/scripts/verify-tokens.js`: read all `.tsx` files in `frontend/src/components/` and `frontend/src/pages/`, grep for `style={{ color` or hardcoded hex in className. Exit 1 if any found. Add to pre-commit: `npx husky add .husky/pre-commit 'node frontend/scripts/verify-tokens.js'`.
- [ ] 6.1.2 Create `frontend/scripts/verify-build.sh`: run `npm run build 2>&1`. Grep stderr for CSS warnings. Exit 1 if any found. Add to CI pipeline.
- [ ] 6.1.3 Create `frontend/scripts/verify-amber.js`: grep all `.tsx`/`.css` for amber color values. Confirm appearance only in `.error`, `.warning`, `.alert`, `.pending`, `.scan-warning` classes. Fail if amber appears elsewhere. Run in pre-commit.
- [ ] 6.2.x (Automated in each wave task via expect) axe-core scans run in `expect playwright` actions (3.1.4, 3.2.4, 3.3.4, 4.2.2). Results auto-saved to `docs/wave-{N}-a11y.json`. expect reports pass/fail directly to task completion.
- [ ] 6.3.1 (End of all waves) Create `frontend/src/theme/SEMANTIC_COLORS_REFERENCE.md`: document each semantic color (success→green, warning→amber, critical→red, info→blue) with hex values and usage counts per surface via grep audit.

## 7. Brand Refinement And Rollout Control

**Note: Task 7.1 runs during implementation (Waves 1-4). Tasks 7.2-7.3 run per-wave and end-of-implementation.**

- [ ] 7.1.1 (During Waves 1-4) For scanner work (Wave 4), if any brand exception is discovered, add to `openspec/changes/align-app-with-brand-guidelines/scanner-brand-exceptions.md` with: [Exception Name] | [Justification] | [Brand Rule Preserved] | [Approval Status]. Do NOT merge code until approved.
- [ ] 7.2.1 (After Wave 1, 2, 3, 4) Log wave completion in `docs/wave-execution-log.md`: Wave N, start date, tasks completed, gate results (a11y pass/fail, regression pass/fail, performance), blockers encountered, completion date.
- [ ] 7.2.2 (After Wave 1, 2, 3, 4) If any gate fails: halt wave, document issue, do NOT proceed to next wave. Fix issue and re-run gate.
- [ ] 7.3.1 (After Wave 1, 2, 3) Prepare rollback runbook to `docs/rollback-wave-{N}.md`: steps to revert wave changes (e.g., Wave 1: revert Tailwind config, restore prior theme CSS, confirm build passes).
- [ ] 7.3.2 (After all waves complete) Test rollback procedure end-to-end for Wave 1. Confirm fallback path: disable Tailwind extends, restore `frontend/src/styles/theme.css` prior state, verify build succeeds. Do NOT release until tested.