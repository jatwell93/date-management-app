## PRE-EXECUTION QA SUMMARY (GAPS RESOLVED)

This section documents all gaps identified during pre-execution planning audit and confirms closure:

**Critical Blockers — All Resolved:**
1. ✅ **Technology ambiguity** → Token implementation (TypeScript path, Tailwind config, semantic mapping file, CSS fallback)
2. ✅ **Wave dependencies unclear** → Gates, rollback procedures, and dependencies now explicit per wave
3. ✅ **Tasks too abstract** → All tasks updated with file paths, dependencies, testing strategy, and acceptance criteria
4. ✅ **Specs incomplete** → 9 enumerated surfaces, exact colors, scanner adaptation rules, 5 scan states, concrete metrics
5. ✅ **Font adoption timing** → Decided: Wave 2 (not deferred) for worker-facing alternate fonts
6. ✅ **Scanner scope unconfirmed** → Task 1.3 coordinates with integrate-pharmacy-pdt-devices change; scope in scanner-screens-scope.md
7. ✅ **Tailwind integration unclear** → Strategy documented (extends, semantic tokens via path alias, fallback import)
8. ✅ **Testing/validation missing** → ESLint checks, axe-core scans, visual regression, performance budgets defined (Tasks 6.1-6.3)
9. ✅ **Exception tracking undefined** → scanner-brand-exceptions.md process with approval workflow (Task 4.3.1)
10. ✅ **Wave gates/rollback vague** → Explicit acceptance criteria per wave; rollback procedures documented (revert Tailwind, restore CSS)

**Pre-Execution Readiness: APPROVED**
- All 4 artifacts complete and cross-referenced
- 0 execution blockers remain
- Ready for implementation

## Context

The change introduces cross-app brand alignment using the PharmIQ brand guide and token sources in `brand-identity-pharma-apps/brand-identity`.

Current state:
- UI styling is not consistently token-driven across surfaces.
- Messaging and typography vary by module and screen context.
- Scanner-oriented workflows (including Zebra handheld usage) need explicit ergonomic and visual guidance that stays on-brand.

Constraints:
- Preserve current functional behavior and workflow speed while applying visual and copy alignment.
- Avoid large one-shot rewrites that increase regression risk.
- Keep accessibility and readability at or above current baselines.

Stakeholders:
- Product and design owners responsible for PharmIQ brand consistency.
- Engineers implementing frontend and scanner-experience changes.
- Pharmacy owners and worker users consuming owner-facing and worker-facing surfaces.

## Goals / Non-Goals

**Goals:**
- Adopt official design tokens as the primary styling source for colors, typography, spacing, radius, elevation, and motion.
- Standardize component and page-level branding behavior across core app surfaces.
- Define approved Zebra scanner adaptations that preserve brand intent while improving scan workflow usability.
- Establish implementation and verification guardrails to prevent style drift.
- Capture any required brand refinements discovered during scanner adaptation work.

**Non-Goals:**
- Rebuild all components from scratch.
- Redesign product information architecture or feature flows unrelated to brand consistency.
- Introduce a separate, disconnected brand system for scanner devices.
- Change business logic, data models, or API contracts as part of this design change.

## Decisions

### Decision 1: Use brand token artifacts as the single source of truth
Adopt token definitions from `brand-identity-pharma-apps/brand-identity/design-tokens.json` and `design-tokens.css` as authoritative sources for UI styling.

Rationale:
- Reduces drift between documentation and implementation.
- Enables repeatable updates when brand tokens evolve.

Alternatives considered:
- Manual component-by-component color/font updates only.
  Rejected because it is error-prone and hard to govern.
- Stand up a new external design system package first.
  Deferred because it adds setup complexity before immediate alignment goals are met.

### Decision 2: Implement semantic token mapping before component rollout
Map raw brand tokens into semantic usage categories (primary action, warning, critical, surface, text, data-viz roles) and apply semantic tokens in components.

Rationale:
- Keeps component code stable when underlying token values evolve.
- Makes role-based styling intent explicit and reviewable.

Alternatives considered:
- Use raw token variables directly in every component.
  Rejected because direct usage increases coupling and migration churn.

### Decision 3: Use progressive migration by surface, not big-bang replacement
Migrate in waves: shell/navigation, primitives, form controls, data presentation (tables/charts), then edge screens.

Rationale:
- Lowers release risk and simplifies rollback.
- Allows visual QA and accessibility checks per wave.

Alternatives considered:
- Single comprehensive rewrite branch.
  Rejected due high regression and merge risk.

### Decision 4: Add a scanner adaptation profile with approved exceptions
Define a Zebra scanner adaptation profile that permits specific exceptions (larger hit areas, stronger focus cues, reduced decorative motion, enhanced scan state contrast) while preserving brand color and tone rules.

Rationale:
- Scanner workflows have ergonomics and speed constraints not present on desktop.
- Controlled exceptions keep UX practical without fragmenting brand identity.

Alternatives considered:
- No scanner-specific exceptions.
  Rejected because it risks poor usability in handheld scan flows.
- Separate scanner-only visual brand.
  Rejected because it creates long-term inconsistency and maintenance overhead.

### Decision 5: Enforce brand compliance through checks, not review memory
Add automated checks for token usage and visual/a11y regressions where feasible, with a documented exception process.

Rationale:
- Human review alone does not scale for ongoing consistency.
- Automation catches drift early during normal development.

Alternatives considered:
- Rely on manual PR review only.
  Rejected because drift is likely to recur and standards are harder to enforce.

### Decision 6: Separate owner-facing and worker-facing voice application
Apply brand voice hierarchy by audience: owner-facing margin/outcome language for platform surfaces, worker-focused direct utility language for scanner-centric flows.

Rationale:
- Aligns with brand guidance and prevents message mismatch.
- Preserves trust and clarity for different user contexts.

Alternatives considered:
- Reuse one universal copy style and tagline everywhere.
  Rejected because it conflicts with audience-specific brand rules.

## Risks / Trade-offs

- [Risk: Partial migration yields mixed visual states] -> Mitigation: ship in clearly bounded waves with component completion criteria.
- [Risk: Token mapping errors break contrast/accessibility] -> Mitigation: include contrast checks and a11y validation in each migration wave.
- [Risk: Scanner adaptations become ad hoc over time] -> Mitigation: maintain a documented approved-exceptions list and require rationale for new exceptions.
- [Risk: Font availability/performance on handheld devices] -> Mitigation: define fallback stacks and performance budgets for scanner surfaces.
- [Risk: Amber overuse reduces urgency signal] -> Mitigation: encode amber usage restraint into component guidance and visual QA checks.
- [Risk: Team velocity slows during migration] -> Mitigation: prioritize high-impact surfaces first and defer low-impact polish to later waves.

## Migration Plan

1. Baseline audit
- Inventory current color, typography, and component-style usage across primary app surfaces.
- Identify scanner-specific screens and interaction-heavy states.

2. Token foundation
- Wire official brand tokens into the app styling entry points.
- Introduce semantic token aliases and document intended usage.

3. Progressive component/surface rollout
- Wave 1: app shell, navigation, and common layout primitives.
- Wave 2: core form controls, alerts, badges, and buttons.
- Wave 3: table/chart and dashboard presentation.
- Wave 4: scanner-specific surfaces with approved adaptation profile.

4. Compliance and quality gates
- Add or update lint/test checks for token use and basic visual consistency.
- Run targeted visual and accessibility checks per wave.

5. Brand refinement feedback loop
- Track any scanner-driven brand adjustments and route them for brand owner review.

Rollback strategy:
- Keep migration changes grouped by wave so each wave can be reverted independently.
- Maintain a fallback path to prior theme variables until all waves pass validation.

## Open Questions (RESOLVED FOR EXECUTION)

**Must be answered before wave execution begins:**
- **Font adoption timing**: Worker-facing scanner screens will adopt alternate font pair (Plus Jakarta Sans + DM Sans from brand guide) starting in Wave 2, not deferred.
- **Exact scanner screens in scope**: Zebra-enabled screens identified during baseline (Task 1.3) will determine Wave 4 scope; scanner integration change (integrate-pharmacy-pdt-devices) owns baseline definition.
- **Visual regression threshold**: Maximum 5% visual difference (measured by pixel-by-pixel tools) acceptable per wave before rollback; QA owns validation.
- **High-contrast variants**: Required for low-light handheld use; define as part of scanner adaptation profile in Task 4.1 with explicit contrast ratio targets (WCAG AAA: 7:1 minimum for text).
- **Chart palette constraints**: Tighten to remove reliance on color alone; add icons/patterns per WCAG 2.1 Color Blindness guidance (Task 6.2).

## Token Implementation Details (Removed Ambiguity)

**Token adoption strategy:**
- Token source: `brand-identity-pharma-apps/brand-identity/design-tokens.json` and `design-tokens.css`
- Frontend integration point: Create `frontend/src/theme/tokens.ts` (TypeScript semantic tokens mapped from JSON) and import into Tailwind config
- Existing Tailwind CSS will be extended with token-derived values (not replaced); current utility-first classes remain valid
- Fallback CSS: Maintain existing theme variables at `frontend/src/styles/theme.css` for gradual migration
- Semantic mapping file: `frontend/src/theme/semantic-tokens.ts` — maps raw brand tokens to UI intents (e.g., `--color-action-primary` → `--color-brand-teal`, `--color-alert-critical` → `--color-critical`)

**Wave gates (all waves MUST pass):**
- Wave completion gate: 100% of in-scope components use semantic tokens (verified by grep/lint)
- Accessibility gate: WCAG 2.1 AA contrast minimum on all migrated surfaces (automated tool: axe-core or similar)
- Visual regression gate: <5% pixel difference from approved baseline (manual review + optional Percy/BackstopJS)
- Performance gate: No style bundle size increase >10KB gzipped; scanner surfaces <2s LCP
- Rollback gate: All changes can be reverted by disabling Tailwind extensions and restoring prior theme variables

## Wave-by-Wave Delivery Scope

**Wave 1: Shell & Navigation (Baseline audit + integration)**
- Deliverable: App chrome (header, sidebar, footer) uses token palette, spacing, shadows
- Rollback: Revert Tailwind config and restore prior theme imports
- Testing: Visual regression, accessibility scan

**Wave 2: Core Controls (Forms, buttons, alerts, badges)**
- Deliverable: All form inputs, CTA buttons, alert states, badges consume semantic tokens; supports both owner and worker typography
- Rollback: Component-level revert of token imports
- Testing: Visual regression, form submission tests unaffected, a11y focused on label contrast

**Wave 3: Data Presentation (Tables, charts, dashboards)**
- Deliverable: Dashboard cards, tables, charts use approved palette and spacing; chart palette adds icons per color-blindness guidance
- Rollback: Chart rendering fallback to prior color scheme
- Testing: Visual regression, chart export/print validation, mobile responsiveness

**Wave 4: Scanner Adaptations (Zebra workflows)**
- Deliverable: Identified Zebra screens (from integrate-pharmacy-pdt-devices change) implement adaptation profile (touch targets ≥48dp, focus ring ≥3px, reduced motion, scan-state contrast ≥4.5:1)
- Rollback: Disable scanner-specific CSS classes, fallback to Wave 3 styles
- Testing: Visual regression on handheld viewport, accessibility, manual handheld device testing (if available)

## Acceptance Criteria by Wave

- **Style coverage**: ≥95% of in-scope components reference semantic tokens (verified by code review + grep)
- **Accessibility**: 0 new critical/serious violations per axe-core; all text contrast ≥4.5:1 (WCAG AA)
- **Performance**: Style bundle unchanged >10KB; no layout thrash detected during render profiling
- **Regression**: <5% visual difference; screenshots approved by design owner; no functional test failures
- **Scanner-specific (Wave 4)**: Touch targets ≥48dp, focus indicators visible, scan state feedback ≤100ms latency