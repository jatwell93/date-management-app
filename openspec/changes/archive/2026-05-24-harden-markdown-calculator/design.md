## Context

The markdown calculator is a product-register pharmacy tool at `/markdown-calculator`. The surface combines scanner input, product lookup, manual price/date entry, and markdown result feedback in one compact component. Existing shared primitives already cover card, button, input, label, and scanner behavior, so the UI work should extend the existing component rather than introduce a new page or parallel calculator.

The audit also found two route/startup defects outside the component: local direct access to `/markdown-calculator` returned `Cannot GET /markdown-calculator`, and a missing Clerk publishable key throws before the app can render recoverable guidance. Those belong in the same change because they block QA and real use of the page.

## Goals / Non-Goals

**Goals:**

- Cover the full audit remediation suite: clarify, layout, harden, optimize, and polish.
- Make result, validation, scan, and lookup feedback understandable to assistive technology.
- Prevent misleading initial output before a calculation has happened.
- Keep the calculator robust with missing input, invalid numeric values, failed product lookup, and long scanned product fields.
- Improve handheld ergonomics without broad design-system churn.
- Make local direct route access to `/markdown-calculator` work in development.
- Replace missing-Clerk-key blank-screen failure with recoverable local startup guidance.
- Preserve route and scanner lazy-loading boundaries.
- Preserve existing scanner and API-service boundaries.

**Non-Goals:**

- No camera/scanner internals rewrite.
- No new i18n framework or dependency.
- No browser QA in this pass.

## Decisions

- Reuse `MarkdownCalculator` instead of creating a new component because the existing file owns the workflow and has direct focused tests.
- Extend `frontend/src/tests/MarkdownCalculator.test.tsx` for RED coverage before changing production code, matching the local Jest pattern already used by the component.
- Use semantic roles directly in the component for alert/status/result regions, matching patterns already present in `ScannerStateIndicator`, reporting pages, and dashboard pages.
- Use `Intl.NumberFormat` inside the component for currency display because this is a small formatting hardening change and does not require a broader localization dependency.
- Pass handheld intent into the existing `Scanner` and increase primary control sizing locally rather than changing global button/input defaults.
- Use semantic tokens and wrapping utilities rather than new colors or decorative styling.
- Fix direct-route development fallback in the local app configuration rather than adding a second router or server.
- Convert missing Clerk configuration from a module-level throw into an app-visible configuration state or development-safe fallback so users and QA see clear guidance.
- Keep optimization scoped to preserving existing lazy-load boundaries and avoiding new runtime dependencies; this pass does not introduce a bundle-analysis tool.
- Perform polish as the final implementation task after functional behavior is covered by tests.

## Risks / Trade-offs

- **Risk:** Existing tests expect the initial `Normal` result. **Mitigation:** Update the expectation to the new explicit pre-calculation state before production code changes.
- **Risk:** Product lookup errors can expose raw API wording. **Mitigation:** Keep error copy specific for not-found and generic for unknown lookup failures.
- **Risk:** Large product values can still be awkward in a narrow card. **Mitigation:** widen the component responsively and add `min-w-0`, `break-words`, and definition-list structure.
- **Risk:** Auth startup changes can affect production authentication. **Mitigation:** preserve ClerkProvider behavior when a publishable key exists and add focused tests around missing-key behavior.
- **Risk:** Route fallback fixes can mask genuine API 404s if applied to the wrong server layer. **Mitigation:** scope fallback to the frontend development server/static app route behavior only.
- **Risk:** Optimization work can expand beyond the audit. **Mitigation:** limit to preserving lazy-loading, avoiding new dependencies, and focused regression tests.
- **Risk:** Skipping browser tests leaves visual regressions unobserved. **Mitigation:** run focused Jest, targeted ESLint, token compliance, and document the browser-test omission.
