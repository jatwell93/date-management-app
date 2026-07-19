# Tasks: Deferred Dependabot major-version upgrades (risk-ordered waves)

Each numbered upgrade is its own branch + PR. "Verify" below always means, at minimum: affected
boundary tests green, `npm run security:npm-supply-chain` passes, `npm audit` shows only the
`xlsx`/`quagga` accepted risks, and a row appended to the `docs/security.md` remediation log.

## 1. Wave 1 — small, isolated runtime bumps

- [x] 1.1 **web-vitals 2→5** (frontend, #287). Bump `web-vitals ^2.1.4 → ^5.3.0` (lockfile-only).
      Migrate the reporting code: `getCLS/getFID/getFCP/getLCP/getTTFB` → `onCLS/onINP/onFCP/onLCP/onTTFB`;
      replace FID with **INP** (FID is removed in v5). Grep for `web-vitals` imports and `reportWebVitals`.
      Done: `frontend/src/reportWebVitals.ts` migrated (`ReportHandler` type → `(metric: Metric) => void`).
- [x] 1.2 web-vitals verify: frontend `vitest run` (clerk-setup incl. reportWebVitals mock), `tsc --noEmit`,
      `vite build` all green; `security:npm-supply-chain` passes; frontend `npm audit` unchanged (only
      `xlsx`/`quagga`). Remediation-log row deferred to PR-merge time.
- [x] 1.3 **rate-limiter-flexible — REMOVED, not upgraded** (backend, #286). Repo-wide search confirmed
      the package was declared in `backend/package.json` but imported nowhere; live rate limiting uses
      `express-rate-limit` (`backend/src/middleware/rateLimiter.ts`). Removed the dead dependency via
      `npm uninstall rate-limiter-flexible` rather than performing the 8→11 bump — closes #286 and
      shrinks the supply-chain surface.
- [x] 1.4 rate-limiter verify: `express-rate-limit` (the real control) untouched, so tier behaviour is
      unchanged by definition. Backend `tsc --noEmit` clean; `contract` suite green and unit/route tests
      1515/1516 (after a local native-module rebuild of `better-sqlite3`); `security:npm-supply-chain`
      passes; backend `npm audit` unchanged (only `xlsx`). The single unit failure
      (`storage-factory.test.ts` "throws when production R2 config is missing") is a pre-existing
      environment artifact — running locally without Doppler lets `.env.production`'s R2 vars bleed into
      `process.env` via `config/environment.ts`, so the "missing config" assertion doesn't hold; it is
      unrelated to this dependency removal and passes in CI/Doppler. Remediation-log row deferred to
      PR-merge time.

## 2. Wave 2 — coordinated toolchain migration

### 2a. TypeScript → 6

- [ ] 2.1 **TS 6 for root + backend + workers together** (#159/#198/#166). Bump `typescript` to `^6.0.3`
      in all three; run each boundary's `tsc`/`type-check`/`build`. Triage new diagnostics from TS 6's
      stricter defaults; fix source, do not loosen `tsconfig` without noting why.
- [ ] 2.2 workers guard: `npm run typecheck && npm run build` must pass and stay under the 256 KiB
      gzip `bundle-size` limit. Verify each boundary.
- [ ] 2.3 **TS 6 for frontend** (#152, `^4.9.5 → ^6.0.3` — a two-major jump). Expect the largest
      diagnostic set (React types, JSX). Run `tsc --noEmit` + `vite build` + frontend `vitest run`.
      This is the prerequisite for 2.6. Verify.

### 2b. ESLint 8→10 (flat-config migration — land as ONE change)

- [ ] 2.4 Migrate **backend** off legacy `.eslintrc.json` to flat `eslint.config.*` (root already uses
      flat config). Reconcile the **frontend** `ESLINT_USE_FLAT_CONFIG=false` override — either migrate
      frontend to flat config or keep the legacy path explicitly and document why.
- [ ] 2.5 Bump together: `eslint ^8.57.1 → ^10.6.0` (root #279, backend #288), `@eslint/js → ^10`
      (#170), `eslint-plugin-react-hooks ^4.6.2 → ^7.1.1` (frontend #178). Run `npm run lint` /
      `lint:check` on every boundary; the lint CI gate must stay green. Do **not** merge these
      individually. Verify.

### 2c. Unblock the typecheck-gated @types/node PRs

- [ ] 2.6 After 2.3 lands, re-enable **frontend `@types/node` #285** (→26.1.1): confirm `tsc --noEmit`
      is clean under TS 6 (previously failed on TS 4.9 parsing Node-26 `.d.ts`), then merge. Verify.
- [ ] 2.7 After 2.1 lands, re-check **workers `@types/node` #276** (→26.1.0): confirm the `bundle-size`
      gate passes (typecheck + build), then merge. Verify.

## 3. Wave 3 — highest blast radius (see design.md)

### 3a. Stripe 13→22 (backend, #283)

- [ ] 3.1 Bump `stripe ^13.10.0 → ^22.3.0` (lockfile-only). Pin the SDK `apiVersion` in the Stripe
      client init to the account's current version; do not rely on the SDK default.
- [ ] 3.2 Reconcile type/name changes across the 9 majors (event, subscription, and webhook types);
      update the webhook handler and any `Stripe.*` type references. Keep signature verification and
      idempotency unchanged.
- [ ] 3.3 Run billing + webhook tests (`vitest run`), `tsc`, and `npm run validate:stripe-config` /
      `test:stripe-config`. Confirm `workers-deploy.yml` Stripe config validation still passes. Verify.

### 3b. Prisma 5→7 pair (root + backend, #183 + #153)

- [ ] 3.4 Bump `@prisma/client` and `prisma` `^5.22.0 → ^7.8.0` in **both** root and backend (all four
      declarations) in one branch; run `prisma generate`.
- [ ] 3.5 Review Prisma 6→7 breaking changes: client engine/runtime, `$queryRaw`/`$executeRaw` typing,
      any renamed client APIs. Update `backend/src/**` call sites; keep the **triplicated schema**
      (Prisma base + Neon SQL + SQLite migration + pglite harness) in agreement (golden rule 6).
- [ ] 3.6 Migrate + test both backends: apply migrations on SQLite dev and Neon test DBs; run the full
      backend suite `vitest run` **and** `npm run test:db` (pglite worker harness) and the dual-backend
      conformance tests. Verify.

## 4. Completion

- [ ] 4.1 All 13 deferred PRs + #285/#276 merged or explicitly re-deferred with a recorded reason.
- [ ] 4.2 Final sweep: `npm run security:npm-supply-chain` + `npm audit` across all four boundaries;
      confirm only `xlsx`/`quagga` remain.
- [ ] 4.3 `docs/security.md` remediation log updated per wave.
- [ ] 4.4 `npx openspec validate upgrade-deferred-dependency-majors --strict`.
