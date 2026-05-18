# Amber Usage Guide

Amber is a restraint color, not a decorative accent. In the frontend, it exists to signal **warning or pending states** and should always be consumed through the semantic warning tokens.

## Approved Uses

| Context | Examples |
| --- | --- |
| Warning alerts | usage-limit warnings, cancellation notes, QA diagnostics |
| Pending / emphasis badges | pending badge variants |
| Form validation warnings | non-blocking validation states |
| Scan-state feedback | warning / duplicate-scan states |

## Disallowed Uses

- Decorative backgrounds or borders
- Navigation, headers, or generic chrome
- Secondary buttons
- Charts unless the series explicitly represents a warning condition
- Raw Tailwind amber utilities such as `bg-amber-50`, `text-amber-800`, or `border-amber-200`
- Deprecated `inventory-warning-*` utilities

## Required Token Path

Use semantic tokens instead of raw amber utilities:

| Need | Use |
| --- | --- |
| Strong warning emphasis | `bg-semantic-warning`, `text-semantic-warning-foreground` |
| Muted warning surface | `bg-semantic-warning-muted`, `border-semantic-warning-muted` |
| Warning text | `text-semantic-warning` |
| Text on muted warning surface | `text-semantic-warning-muted-foreground` |

## Enforcement

`npm run token-compliance` now blocks raw amber utility usage and deprecated `inventory-warning-*` classes in frontend source files. The existing frontend CI workflow runs that command on every PR, so amber restraint is enforced alongside the broader semantic-token policy.

## Exceptions

If amber is required for a new case:

1. Confirm the state is genuinely warning- or pending-related.
2. Prefer existing semantic warning tokens.
3. If a new use is unavoidable, document the rationale in the PR and update this guide before merge.
