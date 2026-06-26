## Context

This is product UI for PharmIQ, used by Australian pharmacy operators reviewing expiry exposure, markdown work, and user activity in a busy pharmacy. The consolidated pass should make the existing reporting pages more resilient, more mobile-usable, clearer, and less generic without changing report APIs or creating replacement reporting modules.

Physical scene: a pharmacy manager reviews expiry risk between counter work and stock tasks, often on a desktop but sometimes on a handheld, with bright retail lighting and limited patience for decorative analytics.

## Reuse Strategy

- Extend existing pages rather than introducing a new reporting shell.
- Reuse shared `Card`, `Button`, `Table`, `DataTable`, `Select`, and semantic token classes already used in the reporting surfaces.
- Follow the dashboard hardening pattern from project memory: announced loading and error states, semantic headings, localized counts/dates, wrapped descriptions, and actionable empty copy.
- Follow the dashboard clarification pattern from project memory: replace vague stock/report labels with action-oriented pharmacy language.
- Follow the dashboard responsive pattern from project memory: compact mobile spacing, visible actions, and structure that works at handheld widths.
- Keep Chart.js in place for visual usage charts, but add adjacent semantic summaries so the information is not canvas-only.

## Implementation Approach

- Add small local format helpers inside reporting pages where the formatting is page-specific; avoid new utility files unless duplication becomes meaningful.
- Convert status text to `role="status"` with `aria-live="polite"` and errors to `role="alert"`.
- Give report sections semantic headings or labelled regions without broad shared-component churn unless tests prove the shared primitive is the right change.
- Format numbers and dates with `Intl` using `en-AU` defaults for this Australian pharmacy context.
- Add chart summaries as ordinary HTML lists/tables under the canvas charts, including long user-name wrapping and empty-state copy.
- Replace the mobile desktop-warning note on detailed expiry with a compact operational summary and keep the full table horizontally scrollable with clear labelling.
- Make report section titles real headings, either by allowing `CardTitle` to render semantic heading tags or by rendering page-specific heading elements inside the existing cards.
- Reframe the overall expiry summary away from four identical metric tiles. Use an operational hierarchy that prioritizes expired risk and markdown action first, then active expiry stock and latest review date.
- Use product-layout rules: predictable grids, consistent density, left-aligned scanning, tighter related groups, and more generous separation between distinct report blocks.
- Preserve card use only where it frames a distinct report area. Avoid nested cards and avoid repeating identical dashboard furniture.
- Stabilize chart tests by mocking chart components or canvas behavior at the test boundary instead of letting Chart.js produce noisy jsdom errors.

## Edge Cases

- Missing token and API failure states are recoverable and announced.
- Empty report datasets show useful, non-generic copy.
- Long product names, SKU values, locations, user names, and roles wrap or truncate with titles where the full value remains discoverable.
- Chart data remains readable without a usable canvas.
- Narrow screens receive a useful report summary instead of being told to use another device.
- Long German-length labels, long product names, CJK text, emoji, and RTL-like strings do not force layout overlap.
- Repeated report sections still have distinct hierarchy under the squint test: primary expiry risk, secondary actions, supporting history.

## Non-Goals

- No backend report endpoint changes.
- No new report data model.
- No replacement charting library.
- No production mock data.
- No separate OpenSpec changes for the audit follow-up commands unless the implementation uncovers unrelated work.
