## Why

The frontend has never had a full technical quality pass across every view. Each view needs an
`/impeccable:audit` (accessibility, performance, theming, responsive design, anti-patterns) and the
findings fixed, so the UI is ready for the in-store trial.

## What Changes

- Add `.impeccable.md` with the design context the impeccable skills require, derived from
  `brand-identity/brand-guidelines.md`.
- Audit each view and fix all findings (P0-P3). One pull request per view, with commits grouped by
  finding category.
- View PRs change only files that belong to their view. Findings in shared code (`components/ui`,
  `theme/`, `layouts/`, `AppNav`, `App.tsx`, `globals.css`, `components/charts`) are collected and
  fixed in the shell PR, which runs last.

## Scope

In scope: every routed page in `frontend/src/App.tsx` and the app shell.
Out of scope: `SentryTest` (diagnostic route), Clerk-hosted auth screens, adopting the full brand
type system (Fraunces/Outfit font loading) where the app does not already use it, and
visual/screenshot verification (the user checks visually after merge).

## Impact

Frontend only (`frontend/src/**`). No API, database or `shared/` changes.
