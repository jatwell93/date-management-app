## 1. Baseline and RED Tests

- [x] 1.1 Run focused markdown calculator tests to confirm the current baseline.
- [x] 1.2 RED: Add tests for direct `/markdown-calculator` route fallback behavior where local config permits static-route coverage.
- [x] 1.3 RED: Add tests for missing Clerk publishable-key startup guidance.
- [x] 1.4 RED: Add tests for the pre-calculation result state and announced result updates.
- [x] 1.5 RED: Add tests for clarified validation errors covering missing date and invalid cost values.
- [x] 1.6 RED: Add tests for product lookup errors and long scanned/product text resilience.
- [x] 1.7 RED: Add tests proving handheld scanner intent and primary control sizing are applied.
- [x] 1.8 RED: Add route/performance boundary tests proving calculator and camera scanner lazy-loading boundaries remain intact.

## 2. Clarify Pass

- [x] 2.1 GREEN: Replace misleading initial `Normal` output with explicit not-yet-calculated copy.
- [x] 2.2 GREEN: Replace generic invalid-input and scan-error copy with specific field/action guidance.
- [x] 2.3 GREEN: Align labels, headings, and result terminology with pharmacy markdown workflow language.

## 3. Layout Pass

- [x] 3.1 GREEN: Rework the narrow centered stack into a resilient product-tool layout using existing card, form, and scanner primitives.
- [x] 3.2 GREEN: Group scanner, product summary, manual inputs, and result output according to the operator workflow.
- [x] 3.3 GREEN: Harden long scanned values and product details with wrapping, `min-w-0`, and structured labels.

## 4. Harden Pass

- [x] 4.1 GREEN: Add semantic alert/status/result regions for errors, scan feedback, product feedback, and calculation output.
- [x] 4.2 GREEN: Harden validation for empty, zero, negative, non-finite cost, and missing expiry date.
- [x] 4.3 GREEN: Format currency values with `Intl.NumberFormat`.
- [x] 4.4 GREEN: Apply handheld scanner intent and touch-friendly primary action sizing.
- [x] 4.5 GREEN: Fix direct local access to `/markdown-calculator` so it renders the React route instead of `Cannot GET /markdown-calculator`.
- [x] 4.6 GREEN: Replace missing-Clerk-key blank-screen startup failure with recoverable configuration guidance.

## 5. Optimize Pass

- [x] 5.1 GREEN: Preserve `React.lazy` route loading for `MarkdownCalculator`.
- [x] 5.2 GREEN: Preserve lazy camera scanner loading behind the scanner camera boundary.
- [x] 5.3 GREEN: Avoid new runtime dependencies and keep expensive formatting or derived values memoized or locally bounded where useful.

## 6. Polish Pass

- [x] 6.1 GREEN: Align the final UI with shared primitives, semantic tokens, focus visibility, and product spacing rhythm.
- [x] 6.2 GREEN: Check for impeccable banned patterns: no nested cards, side-stripe borders, gradient text, decorative glassmorphism, or hero-metric layout.
- [x] 6.3 GREEN: Remove dead comments/debug code and keep copy capitalization consistent.

## 7. Verification

- [x] 7.1 Run focused markdown calculator Jest tests and confirm RED-to-GREEN results.
- [x] 7.2 Run focused route/startup/performance boundary tests added by this change.
- [x] 7.3 Run targeted ESLint for touched component, app startup, route config, and tests.
- [x] 7.4 Run token compliance for touched frontend UI files.
- [x] 7.5 Run OpenSpec validation for `harden-markdown-calculator`.
- [x] 7.6 Document that browser tests were skipped by request.
