## Why

The markdown calculator audit scored 12/20: acceptable, but not production-ready. A narrow hardening pass would fix only the component-level symptoms, so this change expands to the full impeccable remediation suite needed for the findings: `clarify`, `layout`, `harden`, `optimize`, and `polish`.

Audit evidence:

- **P1 direct route QA failure:** `/markdown-calculator` is registered in React Router at `frontend/src/App.tsx:356`, but local direct access returned `Cannot GET /markdown-calculator`.
- **P1 missing Clerk key blank screen:** `frontend/src/index.tsx:12` checks `REACT_APP_CLERK_PUBLISHABLE_KEY` and `frontend/src/index.tsx:15` throws, blanking the app before users see recoverable guidance.
- **P1 status changes not announced:** `frontend/src/components/MarkdownCalculator.tsx:138` renders errors as plain text, and `frontend/src/components/MarkdownCalculator.tsx:179` renders results as plain content instead of semantic status/result feedback.
- **P1 handheld touch targets too small:** `frontend/src/components/MarkdownCalculator.tsx:131` uses `Scanner` without handheld intent and `frontend/src/components/MarkdownCalculator.tsx:178` leaves the primary action on the default compact size.
- **P2 initial result state misleading:** `frontend/src/components/MarkdownCalculator.tsx:25` initializes the result as `Normal` before a user calculates anything.
- **Layout resilience gap:** `frontend/src/components/MarkdownCalculator.tsx:124` constrains the tool to a narrow centered card even though scanned product names, SKUs, and barcodes can be long.
- **Performance verification gap:** `frontend/src/App.tsx:53` lazy-loads the calculator route and `frontend/src/components/Scanner.tsx:17` lazy-loads camera scanning, but this pass should preserve those boundaries while adding tests around the route/component.
- **Reuse baseline:** `frontend/src/tests/MarkdownCalculator.test.tsx:6` already provides focused component coverage that can be extended for RED/GREEN hardening.

## What Changes

- **Clarify:** Replace vague or misleading copy (`Normal`, generic invalid input, raw scan failures) with specific pharmacy workflow copy and recoverable next steps.
- **Layout:** Rework the calculator from a narrow centered stack into a resilient product-tool layout with clear grouping, stronger hierarchy, and long-text wrapping.
- **Harden:** Add accessible status/error/result semantics, robust validation, long product-field handling, direct-route fallback behavior, and recoverable local auth-startup messaging.
- **Optimize:** Preserve route-level and camera-level lazy loading, avoid adding heavy dependencies, and add focused route/performance boundary coverage where practical.
- **Polish:** Align the finished surface to shared UI primitives, semantic tokens, touch target expectations, copy consistency, and verification checks.
- Add focused Jest tests before production code changes.
- Skip browser tests for this pass, per user direction.

## Capabilities

### New Capabilities

- `markdown-calculator-audit-remediation`: Markdown calculator route and UI remain understandable, accessible, resilient, responsive, performant, and polished across audit finding scenarios.

### Modified Capabilities

- `frontend-metrics`: Frontend route surfaces must preserve accessible status/error behavior, focused test coverage, token compliance, route-level lazy-loading behavior, and recoverable startup behavior while hardening operational UI.

## Impact

- **Frontend component:** `frontend/src/components/MarkdownCalculator.tsx`
- **Existing scanner integration:** `frontend/src/components/Scanner.tsx`
- **Route/app startup:** `frontend/src/App.tsx`, `frontend/src/index.tsx`, and local dev-server fallback configuration if needed
- **Tests:** `frontend/src/tests/MarkdownCalculator.test.tsx`
- **Verification:** focused Jest tests, route/performance boundary tests where practical, targeted ESLint, token compliance, OpenSpec validation. Browser tests are intentionally skipped for this task.
