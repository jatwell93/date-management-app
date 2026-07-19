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

- [x] 2.1 **TS 6 for root + backend + workers together** (#159/#198/#166). Bumped `typescript` to
      `^6.0.3` in all three (`--legacy-peer-deps` one-shot for the workers lockfile only, to tolerate the
      pre-existing sentry/wrangler `@cloudflare/workers-types` v4-vs-v5 `peerOptional` conflict that a
      full `npm install` re-resolves — CI uses `npm ci` which doesn't). Backend `type-check` clean; root
      `compile` fails only on a pre-existing, TS-version-independent `TS2584` in the `src/index.ts`
      starter file (same 5 errors on `main`, script not in CI). Workers needed two TS 6 tsconfig
      diagnostics fixed: `ignoreDeprecations: "6.0"` (baseUrl deprecation, sanctioned bridge to TS 7) and
      an explicit `rootDir: "../"` (TS 6 now enforces rootDir containment for the compiled `../shared/**`).
- [x] 2.2 workers guard: `npm run typecheck` + `build:types` + esbuild `build` all pass; bundle is
      617.2 kB raw, **byte-identical to `main`** (no runtime code touched), so the 256 KiB gzip
      `bundle-size` gate is unaffected. Supply-chain policy passes; root/workers audit 0 vulns, backend
      audit unchanged (only the accepted `xlsx` highs). typescript-eslint estree 8.62.0 supports TS
      `<6.1.0`, so 6.0.3 is compatible with the existing eslint 8 toolchain (no Wave 2a→2b conflict).
- [x] 2.3 **TS 6 for frontend** (#152, `^4.9.5 → ^6.0.3` — a two-major jump). Bumped clean: the only
      source change was `ignoreDeprecations "5.0" → "6.0"` (covers the TS 6 `baseUrl` + `moduleResolution:
      node10` deprecations). `tsc --noEmit` clean — the anticipated React/JSX diagnostic set did not
      materialise (codebase already strict + React 19 types); no `rootDir` TS6059 either (frontend config
      has no `outDir`, so containment isn't enforced over the `../shared` include). `vite build` green;
      `vitest run` 546/546 (one 501-item bulk-select test timed out only under full-suite parallelism —
      passes in 8.5s in isolation). Supply-chain passes; frontend audit unchanged (8 pre-existing accepted
      quagga-chain + xlsx advisories, identical to main). Prerequisite for 2.6 now satisfied.

### 2b. ESLint flat-config migration + ESLint 9 (land as ONE change)

> **ESLint 10 deferred (upstream-blocked).** `eslint-plugin-react@7.37.x` (latest) calls
> `context.getFilename()`, an API **removed in ESLint 10**, so any `react/*` rule crashes on 10
> (`TypeError … getFilename is not a function`). `eslint-plugin-react`/`-jsx-a11y`/`-import` all cap
> their `eslint` peer at `^9`. **ESLint 9 is the max viable version** and is still flat-config-native, so
> it delivers the migration. Root #279 / backend #288 / `@eslint/js` #170 (all target 10) stay **deferred
> with this recorded reason**; re-attempt when `eslint-plugin-react` ships ESLint 10 support. Note there
> is **no ESLint CI gate** here — the only workflow `npm run lint` is workers' misnamed `tsc` alias, and
> frontend `lint-staged` runs only prettier — so ESLint is a local dev tool; verification is the boundary
> `lint` scripts running clean.

- [x] 2.4 **Migrated all boundaries onto the root flat config.** The root `eslint.config.js` already
      lints the whole monorepo (dedicated `backend/**`, `frontend/src/**`, `shared/**` blocks). Deleted
      the redundant `backend/.eslintrc.json` + `.eslintignore` (backend `eslint .` now discovers the root
      flat config by walking up). Removed the frontend `eslintConfig` block + `ESLINT_USE_FLAT_CONFIG=false`
      + `--ext` flags, dropped `eslint-config-react-app` (CRA-era, eslintrc-only), and added an explicit
      `eslint@^9` devDep to frontend so its local binary matches the root's eslint-9-era plugins. Cleaned
      dead `eslint-disable` directives (ESLint 9 reports them by default) and stray `/* eslint-env */`
      comments (error in ESLint 10).
- [x] 2.5 **Bumped to ESLint 9** (not 10 — see note): `eslint ^9.39` (root #279-partial, backend #288),
      `@eslint/js ^9.39` (#170-partial), `eslint-plugin-react-hooks ^4.6.2 → ^7.1.1` (**#178 fully done**).
      react-hooks v7's stricter recommended set flagged 24 findings; resolved per the agreed hybrid — two
      clean lazy-`useState` refactors (`HandheldContext`, `useHandheldDetection`) + justified per-line
      `eslint-disable` for the intentional fetch-guard / external-sync / timer patterns, plus the
      `preserve-manual-memoization` + `incompatible-library` advisories. All boundaries lint **clean**
      (root/backend/frontend, 0 problems); supply-chain passes; audits unchanged (accepted `xlsx`/`quagga`).

### 2c. Unblock the typecheck-gated @types/node PRs

- [x] 2.6 **frontend `@types/node` → 26.1.1** (#285). `tsc --noEmit` clean under TS 6 (the TS 4.9 parse
      failure on Node-26 `.d.ts` is gone). `vite build` + `vitest` unaffected. Landed together with 2.7.
- [x] 2.7 **workers `@types/node` → 26.1.1** (#276). `bundle-size` path (typecheck + `build:types` +
      esbuild `build`) green; `test:db` 70/71 (1 skipped). Node-26 tightened `URLSearchParams` iterator
      types (added `[Symbol.dispose]`), which clashed with `@cloudflare/workers-types`' `URL` in the
      node-typed test config — fixed by importing `URL` from `node:url` in the three
      `*.conformance.node.test.ts` files (runtime-identical to the global). Supply-chain passes; workers
      audit 0, frontend audit unchanged. `undici-types` transitive moved 6.21→8.3 (it is `@types/node`'s
      own dep).

## 3. Wave 3 — highest blast radius (see design.md)

### 3a. Stripe 13→22 (backend, #283)

- [x] 3.1 **Bumped `stripe ^13.10.0 → ^22.3.2`** (#283; backend only — the Worker doesn't call the
      Stripe SDK). SDK v22 pins its types to `LatestApiVersion = "2026-06-24.dahlia"` and the config
      field is strictly typed `apiVersion?: LatestApiVersion`, so the five `new Stripe(...)` sites
      (`utils/stripe.ts`, `jobs/stripe-sync.job.ts`, `services/{stripe-webhook-signature,subscription,
      webhook}.service.ts`) had to move off `'2023-08-16'`. Per the user decision, **adopted the SDK's
      native `'2026-06-24.dahlia'`** rather than casting the old version — pinned explicitly, not relying
      on the SDK default. No other lockfile packages changed (v22 dropped the `qs` dep and made
      `@types/node` an optional peer).
- [x] 3.2 **Reconciled the "basil" breaking change.** Stripe's 2025 API moved
      `current_period_start/end` off the `Subscription` onto each **subscription item**. Added two
      accessors to `subscription-billing.helpers.ts` (`getSubscriptionCurrentPeriodEnd` →
      `items.data[0].current_period_end`, plus a `…Date` wrapper) and routed all 9 read sites through
      them (`subscription-access.helpers.ts` + 4 in `webhook.service.ts`). Signature verification
      (`constructEvent`) and idempotency are untouched; webhook payload shape is governed by the
      Dashboard endpoint version, not the SDK. Updated 4 test fixtures to the item-based shape and fixed
      a **latent broken `@sendgrid/mail` mock** in `webhook.service.test.ts` (missing `default` export →
      the file's 24 tests never ran; now green standalone).
- [x] 3.3 **Verified.** Backend `tsc --noEmit` clean. Stripe-touched suites green: `webhook.service`
      24/24, `subscription.service` (incl. access-window), `subscription-access.helpers`,
      `subscription-lifecycle-services`. `validate:stripe-config` valid under Doppler + `test:stripe-config`
      3/3 (pure config JS, SDK-version-independent). `security:npm-supply-chain` passes; backend `npm audit`
      unchanged (only accepted `xlsx` highs). Pre-existing, non-Stripe failures left as-is and proven
      unrelated: `storage-factory` R2-env artifact, `auth.service` JWT `tierLevel` payload drift, and the
      live-Stripe `subscription.integration.test.ts` (`No such price` — a stale hardcoded test-account
      price ID, only runs locally because Doppler injects an `sk_test_` key; skipped in CI).
      **CI regression caught + fixed:** v22 throws `Neither apiKey nor config.authenticator provided`
      at *construction* when the key is empty (v13 deferred it to first request). The eagerly-wired
      `SubscriptionService.createStripeClient` used `new Stripe(key || '', …)`, crashing 41 tests across
      21 files in CI — masked locally because `doppler run` injects `STRIPE_SECRET_KEY`. Fixed by falling
      back to an obviously-invalid placeholder key so construction succeeds and real calls still 401.
      Re-verified against a **no-Doppler** run (CI-parity, no key): full unit suite 1515/1516, the lone
      failure being the local-only `storage-factory` `.env.production` R2 bleed.

### 3b. Prisma 5→6 (root + backend); Prisma 7 re-deferred (PR #373, was #183 + #153)

  SCOPE DECISION (user-confirmed): land Prisma **6**, not 7. Prisma 7 is an ORM re-architecture, not a
  bump — it mandates **driver adapters** (`new PrismaClient()` no longer self-connects), is **ESM-only**
  (`"type": "module"`), and needs the new `prisma-client` generator + `prisma.config.ts` + explicit
  `.env` loading. This backend is CommonJS + tsyringe/reflect-metadata + SWC decorator metadata, so 7 is
  a multi-day architecture change out of scope for a dependency wave. Prisma 6 keeps the classic Rust
  engine, CJS, and auto-`.env`, making 5→6 a genuine low-risk forward step. **Dependabot #183/#153
  (target ^7) re-deferred** with this reason (recorded here + in 4.1).

- [x] 3.4 Bumped `@prisma/client` and `prisma` `^5.22.0 → ^6.19.3` in **both** root and backend (all four
      declarations); `prisma generate` clean (classic Rust query engine retained). Also removed a dead
      `@prisma/adapter-planetscale@^7.8.0` (zero imports, PlanetScale not in stack, leftover from early
      R2 work) whose hard peer on `@prisma/client@7` would ERESOLVE against the v6 pin.
- [x] 3.5 Reviewed 5→6 breaking changes — **none apply**: no `Bytes` fields (Buffer→Uint8Array n/a), no
      implicit m-n relations (PK change n/a), `NotFoundError` here is a **custom app error** not Prisma's
      removed one, full-text search unused. TS `^6.0.3` + `@types/node ^26` already clear v6 floors. No
      `backend/src/**` call-site changes needed. Triplicated schema untouched (no model changes).
- [x] 3.6 Verified. `tsc --noEmit` clean; full backend Vitest **1882 passing** (9 remaining failures are
      pre-existing Doppler/local-env artifacts — storage-factory `.env.production` R2 bleed, live-Stripe
      integration price IDs, auth JWT payload drift — all pass/skip in CI's secret-free env); workers
      `npm run test:db` (pglite harness) **70/70**; supply-chain policy pass; `npm audit` only accepted
      `xlsx`. One test-only fix: `database-factory` `instanceof PrismaClient` smoke checks — v6 returns a
      proxy-wrapped client whose prototype is an internal class, so `instanceof` is false even for a
      valid client → replaced with a behavioral method-surface assertion. PR #373.

## 4. Completion

- [ ] 4.1 All 13 deferred PRs + #285/#276 merged or explicitly re-deferred with a recorded reason.
- [ ] 4.2 Final sweep: `npm run security:npm-supply-chain` + `npm audit` across all four boundaries;
      confirm only `xlsx`/`quagga` remain.
- [ ] 4.3 `docs/security.md` remediation log updated per wave.
- [ ] 4.4 `npx openspec validate upgrade-deferred-dependency-majors --strict`.
