## Why

GitHub Dependabot currently reports 16 open npm alerts for this repository, and `npm audit` reports additional package-specific vulnerabilities across the root, backend, frontend, and workers workspaces. The most urgent risks are a root lockfile/tooling exposure for `@google/gemini-cli` and `protobufjs`, Clerk's transitive `js-cookie` vulnerability across all runtime surfaces, legacy CRA/react-scripts dependency debt, and no-fix or stale packages such as `xlsx` and `quagga`.

Recent npm ecosystem incidents make dependency installation itself part of the threat model. The repo already uses `npm ci` in CI, but it does not yet commit npm hardening controls such as lifecycle script blocking, git dependency blocking, release-age cooldown, lockfile-linting, or a documented exception process.

## What Changes

- Review and remediate the current open Dependabot alerts where a safe package update or dependency removal is available.
- Add npm supply-chain hardening controls that align with Liran Tal's npm security best practices: disable unreviewed install scripts, block git-sourced dependencies, add package release cooldowns, prefer deterministic installs, harden `npx` usage, and document package review expectations.
- Document accepted residual risks for dependencies that cannot be fixed with a direct safe upgrade, especially `xlsx`, `quagga`, and CRA/react-scripts transitive dependencies.
- Add CI checks that keep the lockfile and dependency source policy visible on future changes.

## Current Analysis

**Root**: `package.json` declares `wrangler`, Prisma, TypeScript, and lint/test tooling, but the current root dependency tree includes extraneous `@google/gemini-cli@0.35.3` and `protobufjs@8.0.0` via tool-installed packages. These are the source of the critical Gemini CLI and clustered protobufjs alerts in `package-lock.json`.

**Backend**: `backend/package.json` directly depends on `@clerk/backend`, `express`, `fix`, `xlsx`, AWS SDK packages, and SQLite/native tooling. Current audit output includes `js-cookie` through Clerk, `brace-expansion` through native install tooling, `xlsx` no-fix advisories, stale `fix` transitive advisories, and `express`/`qs` moderate advisories.

**Frontend**: `frontend/package.json` uses CRA through `react-scripts` and CRACO, plus `@clerk/clerk-react`, `quagga`, and `xlsx`. Dependabot alerts map to Clerk/js-cookie, webpack-dev-server, serialize-javascript, @tootallnate/once, and PostCSS. Audit output also shows broader CRA/react-scripts and quagga/request dependency debt.

**Workers**: `workers/package.json` uses `@clerk/backend`, Cloudflare Workers tooling, Vitest workers pool, and Wrangler. Current alerts map primarily to Clerk/js-cookie and Cloudflare/miniflare/ws tooling updates.

**CI and npm policy**: GitHub workflows use `npm ci` in the backend, frontend, workers, Pages, and bundle-size jobs. No committed `.npmrc` currently defines `ignore-scripts`, `allow-git`, `min-release-age`, or related install hardening controls. No `.github/dependabot.yml` was found.

## Reuse Strategy

- Extend existing workspace package files and lockfiles rather than creating parallel package-management systems.
- Keep existing npm workspaces-by-directory model: root, `backend/`, `frontend/`, and `workers/`.
- Reuse existing GitHub workflow jobs and add supply-chain checks to the closest existing workflow instead of introducing a separate security pipeline unless the checks become large.
- Reuse existing documentation surfaces: `docs/security.md`, `SECURITY.md`, and package READMEs for residual-risk notes.
- Continue using OpenSpec for task tracking; do not create root-level TODO documents.

## Implementation Steps

1. Clean and regenerate the root dependency state to remove extraneous vulnerable tool packages from `package-lock.json`.
2. Update Clerk packages across backend, frontend, and workers in a coordinated slice, then run auth-related smoke tests.
3. Remediate backend dependency alerts with safe minor/patch updates or remove unused packages such as `fix` if confirmed unused.
4. Remediate workers tooling alerts by updating Wrangler, Miniflare-related packages, and Vitest workers pool as compatible.
5. Triage frontend CRA/react-scripts dependency debt; apply safe lockfile overrides where defensible and document larger migration work where not.
6. Evaluate direct replacements or mitigations for `xlsx` and `quagga`; remove them only after confirming current import paths and user-facing workflows.
7. Add npm supply-chain guardrails: committed `.npmrc`, dependency-source linting, audit commands, and Dependabot configuration.
8. Update security documentation and memory with the decisions, accepted risks, and operating workflow.
