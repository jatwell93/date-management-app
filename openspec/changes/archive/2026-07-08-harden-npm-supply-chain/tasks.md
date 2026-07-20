## 1. Discovery and Baseline

- [x] 1.1 Run `git standup -d 7`, `openspec list`, `openspec list --specs`, and `node scripts/mem-recall.js "dependabot npm security supply chain package vulnerabilities"`.
- [x] 1.2 Query GitHub Dependabot alerts via `gh api` and reconcile open alert count with local `npm audit`.
- [x] 1.3 Map open alerts to the root, backend, frontend, and workers dependency trees with `npm ls`.
- [x] 1.4 Review npm security best practices and identify controls relevant to this repo.

## 2. Root Dependency Remediation

- [x] 2.1 Confirm `@google/gemini-cli`, `expect-cli`, OpenTelemetry, and `protobufjs@8.0.0` are not declared runtime or development dependencies in `package.json`.
- [x] 2.2 Remove extraneous root `node_modules` state and regenerate the root `package-lock.json` from `package.json` using deterministic npm commands.
- [x] 2.3 Run `npm audit --audit-level=low` at the root and confirm the Gemini CLI/protobufjs alert cluster is gone or document any remaining direct source.

## 3. Runtime Package Updates

- [x] 3.1 Update `@clerk/backend` in `backend/package.json` and `workers/package.json` to a patched compatible version.
- [x] 3.2 Update `@clerk/clerk-react` in `frontend/package.json` to a patched compatible version.
- [ ] 3.3 Run focused backend, frontend, and workers auth/bootstrap tests.
- [x] 3.4 Re-query Dependabot alerts for `js-cookie` in backend, frontend, and workers.

## 4. Backend Dependency Remediation

- [x] 4.1 Search for imports/usages of `fix`, `xlsx`, tar extraction, and direct XML builder surfaces.
- [x] 4.2 Remove `fix` if unused, or replace it with maintained functionality if used.
- [x] 4.3 Update safe patch/minor backend dependencies for `express`, `qs`, AWS XML builder, native install tooling, and related transitive alerts.
- [x] 4.4 Decide and document the `xlsx` mitigation path for backend import parsing.
- [ ] 4.5 Run `npm run test:backend`, `npm run lint --prefix backend`, and `npm audit --audit-level=low` in `backend/`.

## 5. Workers Dependency Remediation

- [x] 5.1 Update `wrangler`, `@cloudflare/vitest-pool-workers`, and related workers tooling to patched compatible versions.
- [ ] 5.2 Run `npm run test --prefix workers`, `npm run build --prefix workers`, and `npm audit --audit-level=low` in `workers/`.

## 6. Frontend Dependency Remediation

- [ ] 6.1 Search current scanner/import workflows for `quagga` and `xlsx` usage and document user-facing impact.
- [x] 6.2 Apply safe frontend lockfile updates for direct patched packages such as `postcss` where possible.
- [ ] 6.3 Triage CRA/react-scripts transitive alerts and choose between safe overrides, documented residual risk, or a separate migration proposal.
- [x] 6.4 Decide and document the `quagga` and `xlsx` mitigation path for frontend scanning/import workflows.
- [ ] 6.5 Run `npm run test:frontend:diff`, `npm run build:frontend`, and `npm audit --audit-level=low` in `frontend/`.

## 7. NPM Supply-Chain Hardening

- [x] 7.1 Add a committed root `.npmrc` with npm security defaults that are compatible with this repo.
- [ ] 7.2 Replace avoidable `npx` script usage with local `npm exec --` or package scripts where feasible.
- [x] 7.3 Add a CI check for git/tarball/local dependency sources and lockfile registry integrity.
- [x] 7.4 Add or update `.github/dependabot.yml` for root, backend, frontend, workers, and GitHub Actions.
- [x] 7.5 Document the exception process for packages requiring install scripts or release-age bypasses.

## 8. Documentation and Verification

- [x] 8.1 Update `docs/security.md` or `SECURITY.md` with npm supply-chain posture, accepted risks, and remediation decisions.
- [x] 8.2 Run `openspec validate harden-npm-supply-chain --strict`.
- [ ] 8.3 Run `openspec validate --all`.
- [x] 8.4 Run final package audits and GitHub Dependabot alert query.
- [x] 8.5 Store a project memory summarizing the security hardening pattern and residual risks.
