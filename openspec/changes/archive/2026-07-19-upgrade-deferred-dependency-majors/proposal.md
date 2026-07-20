# Proposal: Work through the deferred Dependabot major-version upgrades in risk-ordered waves

## Why

The 2026-07-19 Dependabot triage (recorded in `docs/security.md`) cleared the safe dev/type/tooling
bumps and closed two superseded PRs, but intentionally **deferred 13 major-version PRs** that either
require code changes or a coordinated toolchain migration. They remain open with per-PR remediation
comments, but there is no single durable plan tying them together, no ordering that front-loads the
low-risk wins, and no upfront risk analysis for the two highest-blast-radius upgrades (Stripe and
Prisma). This change captures that plan so the majors can be worked through deliberately, one branch
at a time, without regressing the npm supply-chain policy or the documented accepted-risk baseline.

These are **not** outstanding security advisories — `npm audit` currently reports only the accepted
`xlsx` and `quagga` risks. This is version-currency hygiene: staying on supported majors reduces
future upgrade debt and keeps security patches reachable.

## What changes

Execute the deferred majors in three waves ordered by **effort × unblocking value**, smallest first,
each on its own branch with the full boundary test suite green before merge:

- **Wave 1 — small, isolated runtime bumps:** `web-vitals` 2→5 (#287, frontend reporting API rename)
  and `rate-limiter-flexible` 8→11 (#286, a security control — behaviour must be preserved exactly).
- **Wave 2 — coordinated toolchain migration (unblocks stragglers):** TypeScript → 6 across
  root/backend/workers (#159/#198/#166) then frontend (#152, a two-major 4.9→6 jump); ESLint 8→10
  flat-config migration (#279/#170/#288/#178). Landing the TypeScript upgrades **unblocks** the two
  `@types/node` → 26 PRs that currently fail typecheck — frontend #285 (blocked by TS 4.9) and workers
  #276 (fails the `bundle-size` gate).
- **Wave 3 — highest blast radius, most upfront detail:** `stripe` 13→22 (#283, billing/webhook) and
  the `@prisma/client` + `prisma` 5→7 pair (#183/#153, ORM engine + dual-backend schema). These get a
  dedicated `design.md` risk analysis because a regression here touches revenue and data integrity.

Each upgrade uses lockfile-only installs (`npm install <pkg>@<ver> --package-lock-only
--ignore-scripts`), keeps changes within one package boundary, runs
`npm run security:npm-supply-chain` + `npm audit` afterward, and appends a row to the
`docs/security.md` Dependabot Remediation Log.

## Scope

- **In scope:** the 13 deferred PRs above, plus re-enabling and merging the two typecheck-blocked
  `@types/node` PRs (#285, #276) once Wave 2 lands.
- **Out of scope:** the already-merged safe batch; the two closed superseded PRs; replacing the
  `xlsx` and `quagga` accepted-risk packages (tracked separately in the security docs); any feature
  or behaviour change beyond what a dependency major strictly requires.

## Invariants (must hold after every wave)

- `npm run security:npm-supply-chain` passes; every dependency stays npmjs-registry-sourced (no git,
  tarball, `file:`, `link:`, `*`, or `latest`).
- `npm audit` surfaces **only** the documented `xlsx` (backend/frontend) and `quagga` (frontend)
  accepted risks — no new advisories, root/workers stay clean.
- Every affected boundary's CI gate stays green: backend/frontend tests, workers `bundle-size`
  (typecheck + build + 256 KiB), lint, CodeQL, secrets-scan.
- No behavioural change to security controls: the rate-limiter strict/upload/standard tiers behave
  identically, and Stripe webhook idempotency/signature verification is unchanged.

## Reuse Strategy

- Reuse the existing per-boundary scripts (`type-check`/`build`/`test`, `security:npm-supply-chain`)
  and CI gates as the acceptance harness — no new verification tooling.
- Reuse the existing backend `overrides` mechanism only if a transitive pin is unavoidable; prefer a
  direct bump.
- For Prisma, reuse the established **triplicated-schema** discipline (golden rule 6): Prisma base +
  Neon SQL + runtime SQLite migration + pglite harness must stay in agreement; lean on the existing
  dual-backend conformance and `npm run test:db` harness.

## Deferred Follow-up

- Removing the now-redundant `@types/uuid` (runtime `uuid` is v14, which ships its own types) — noted
  during triage, not part of these waves.
- Frontend `@types/node` #285 depends on the frontend TypeScript 6 upgrade (#152); if #152 proves
  large it may split into its own change, with #285/#276 following.

## Implementation Steps

1. Wave 1: `web-vitals` reporting migration (`getCLS/getFID/…` → `onCLS/onINP/…`, FID→INP); then
   `rate-limiter-flexible` API-delta review with tier-behaviour regression tests.
2. Wave 2: TypeScript → 6 (root/backend/workers together, then frontend); ESLint 8→10 flat-config
   migration reconciling backend's legacy `.eslintrc.json` and frontend's `ESLINT_USE_FLAT_CONFIG=false`;
   then re-enable and merge `@types/node` #285/#276.
3. Wave 3: Stripe 13→22 (pin `apiVersion`, update webhook handler + types, billing tests); then the
   Prisma 5→7 pair (regenerate client, migrate SQLite + Neon, `test:db`, dual-backend conformance).
4. Per upgrade: supply-chain + audit verification, remediation-log row, PR, and OpenSpec task tick.
5. Completion: `npx openspec validate upgrade-deferred-dependency-majors --strict`.
