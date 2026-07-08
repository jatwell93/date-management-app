# Report Print Targets Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make report print actions target the intended report content so printed output includes the useful data tables and excludes interactive controls.

**Architecture:** Extend the existing frontend report pages with a small print-target pattern rather than adding new routes or data flows. The print button on the detailed expiry report will render a print-only full table from the already loaded report rows, while the expired-items page will print the existing desktop table content without action controls. `frontend/src/theme/print-reports.css` will own the shared print hiding/revealing rules so the page components stay focused on data and layout.

**Tech Stack:** React, TypeScript, Vitest, React Testing Library, existing frontend CSS utilities and `frontend/src/theme/print-reports.css`

---

## Analysis

**Current**

- `frontend/src/pages/DetailedExpiryReportPage.tsx` still binds the print button to `window.print()` and the visible `DataTable`, which paginates and includes an `Actions` column.
- `frontend/src/pages/ExpiredItemsPage.tsx` still binds the print button to `window.print()` and the desktop table includes interactive action buttons in its last column.
- `frontend/src/pages/ReportsPage.tsx` and `frontend/src/pages/UsageReportPage.tsx` both still expose print buttons in the header even though the new requirement is to remove that affordance there.
- `frontend/src/theme/print-reports.css` already exists and is imported globally from `frontend/src/App.tsx`, so it is the right place for reusable print selectors and page-level hide/show rules.
- Existing frontend report tests live under `frontend/src/tests/`, including `DetailedExpiryReportPage.test.tsx`, `ExpiredItemsPage.test.tsx`, `ReportsPage.test.tsx`, and `UsageReportPage.test.tsx`.

**Affected**

- `frontend/src/pages/DetailedExpiryReportPage.tsx`
- `frontend/src/pages/ExpiredItemsPage.tsx`
- `frontend/src/pages/ReportsPage.tsx`
- `frontend/src/pages/UsageReportPage.tsx`
- `frontend/src/theme/print-reports.css`
- `frontend/src/tests/DetailedExpiryReportPage.test.tsx`
- `frontend/src/tests/ExpiredItemsPage.test.tsx`
- `frontend/src/tests/ReportsPage.test.tsx`
- `frontend/src/tests/UsageReportPage.test.tsx`

**Pattern**

- Extend existing page components in place rather than introducing new print service code.
- Use reusable print CSS classes such as `print-report-root`, `print-report-target`, and `print-only`.
- Keep printed rows data-only by omitting action columns/buttons from the print surface.

## Reuse Strategy

- Reuse the already loaded report datasets in each page component.
- Reuse the existing `print-reports.css` import path already wired through `frontend/src/App.tsx`.
- Reuse the current report page tests and extend them with print-target assertions instead of adding a separate test harness.

## Implementation Steps

1. Add shared print-target CSS rules in `frontend/src/theme/print-reports.css` that hide non-target content during print and reveal only the selected report surface.
2. Update `frontend/src/pages/DetailedExpiryReportPage.tsx` so the print button targets the full expiry table section and a print-only full table renders all loaded rows without pagination.
3. Update `frontend/src/pages/ExpiredItemsPage.tsx` so the print button targets the desktop table area and the printed surface excludes the interactive Actions column/buttons.
4. Remove the header print buttons from `frontend/src/pages/ReportsPage.tsx` and `frontend/src/pages/UsageReportPage.tsx`.
5. Add focused Vitest/React Testing Library coverage for the detailed expiry and expired-items print surfaces, and update the reports and usage page tests to assert the print buttons are absent.
6. Run the targeted frontend tests, lint, build, and OpenSpec validation for this change.
