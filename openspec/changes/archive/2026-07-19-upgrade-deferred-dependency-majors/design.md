# Design: risk analysis & sequencing for the deferred dependency majors

## Why waves, and why this order

The deferred PRs differ by an order of magnitude in blast radius. Sequencing smallest-first (a) shrinks
the open-PR count quickly, (b) builds a repeatable "bump → verify → log → PR" rhythm on low-stakes
changes before the dangerous ones, and (c) puts the coordinated toolchain work (Wave 2) ahead of Wave 3
so the two typecheck-blocked `@types/node` PRs get unblocked as a side effect rather than lingering.

Cross-boundary upgrades never contend (different `package-lock.json` files); the only serialization
constraint is *within* a boundary. That is why each numbered task is its own branch.

## Wave 1 details

### web-vitals 2→5 (#287) — small, mechanical
v5 renamed the metric getters and dropped FID. The migration is a find-and-replace in the reporting
path plus swapping FID→INP:

| v2 | v5 |
|----|----|
| `getCLS/getFCP/getLCP/getTTFB` | `onCLS/onFCP/onLCP/onTTFB` |
| `getFID` | **removed** → use `onINP` |

Risk is confined to the web-vitals reporting hook; if the metric is only logged (not gated on), a
missed rename fails loudly at build/test time. Low risk.

### rate-limiter-flexible 8→11 (#286) — likely a DEAD dependency
`rate-limiter-flexible` is declared in `backend/package.json` (`^8.3.0`) but **imported nowhere** in
`backend/**/*.ts`. The live rate limiting uses `express-rate-limit` (`backend/src/middleware/rateLimiter.ts`,
`import rateLimit, { ipKeyGenerator } from 'express-rate-limit'`).

**Recommended action:** during execution, confirm the absence of any static/dynamic import or script
reference across the whole repo (`rate-limiter-flexible`, `RateLimiterMemory`, `RateLimiterRes`, etc.).
If truly unused, **remove the dependency** instead of upgrading it — this closes #286, shrinks the
supply-chain surface, and is lower risk than a 3-major bump of live middleware. Only if a hidden
consumer exists do we perform the 8→11 upgrade, in which case the invariant is that the strict/upload/
standard tiers behave identically (assert limits, `429` body, `Retry-After`). Either way the security
control (`express-rate-limit`) is untouched, so this is not a security-control behaviour change.

## Wave 2 details — coordinated toolchain

### TypeScript → 6
`typescript` is `^5.6.3` (root), `^5.9.3` (backend), `^5.3.3` (workers), and `^4.9.5` (frontend). Bump
root/backend/workers together (one minor-ish major each) and treat **frontend separately** — 4.9→6 is
two majors and will surface the most diagnostics (React/JSX types). TS 6 tightens some defaults; fix
source rather than loosening `tsconfig`. The workers boundary is the hard gate: `bundle-size` runs
`typecheck && build` under the 256 KiB gzip cap.

### ESLint 8→10 (flat-config migration)
Mixed config state today: root uses flat config (`eslint.config.js`), backend uses legacy
`.eslintrc.json`, frontend forces `ESLINT_USE_FLAT_CONFIG=false`. ESLint 9/10 defaults to flat config,
so bumping `eslint` without migrating backend/frontend breaks their lint runs. This must be **one
change**: migrate backend to flat config, decide frontend's path (migrate, or keep legacy explicitly),
and bump `eslint`/`@eslint/js`/`eslint-plugin-react-hooks` together. Acceptance = the lint CI gate
green on every boundary.

### Unblocking @types/node #285 / #276
These failed the triage typecheck: frontend #285 because TS 4.9 can't parse Node-26 `.d.ts`
(`ffi.d.ts`, TS1139/TS1005), workers #276 on the `bundle-size` gate. Both are expected to pass once the
corresponding TypeScript upgrade lands (2.3 for frontend, 2.1 for workers), so they are re-verified and
merged at the end of Wave 2 rather than upgraded independently.

## Wave 3 details — highest blast radius

### Stripe 13→22 (#283)
Nine majors. The concrete, already-located migration point is the **hard-pinned API version**:
`apiVersion: '2023-08-16'` appears in **five** initializers —
`utils/stripe.ts`, `services/subscription.service.ts`, `services/webhook.service.ts`,
`services/stripe-webhook-signature.service.ts`, and `jobs/stripe-sync.job.ts`. The v22 SDK types the
`apiVersion` field as a specific literal union, so the old string will fail typecheck; each must move to
the account's current pinned version in lockstep (a single shared constant is preferable to five
literals). Secondary work: reconcile renamed event/subscription/webhook types.

**Invariants:** webhook **signature verification** (`constructEvent` in
`stripe-webhook-signature.service.ts`) and **idempotency** must be unchanged; billing transitions stay
atomic. Acceptance = billing/webhook `vitest` suites, `tsc`, and `npm run validate:stripe-config` /
`test:stripe-config` green, and the `workers-deploy.yml` Stripe config validation still passing.

**Rollback:** Stripe is backend-only and gated behind tests + the deploy config validator; if a
regression surfaces, revert the single branch — no data migration is involved.

### Prisma 5→7 pair (#183 + #153)
Highest data-integrity risk, so it goes **last**. `@prisma/client` and `prisma` must move together in
**both** root and backend (four declarations). Mitigating factors found during analysis: there are
**no `$queryRaw`/`$executeRaw` call sites** in `backend/src`, so the raw-query typing changes in
Prisma 6/7 don't apply here — the surface is the generated client API and the engine/runtime.

The real risk is the **triplicated schema** (golden rule 6): Prisma base schema + Neon SQL migrations +
runtime SQLite migrations + the pglite test harness must all stay in agreement. A Prisma major can
change generated types, default client engine, and migration semantics.

**Procedure:** bump both packages → `prisma generate` → review v6/v7 breaking changes → fix client call
sites → apply migrations against **both** SQLite (dev) and Neon (test) → run the full backend
`vitest run`, `npm run test:db` (pglite worker harness), and the dual-backend conformance suite.

**Rollback:** revert the branch; because we do lockfile-only + generate (no destructive DB migration is
authored as part of the *upgrade*), reverting restores the prior client. Any schema migration authored
alongside must ship with its down-migration (Neon SQL rollback + SQLite reverse), per existing
convention.

## Verification harness (all waves)

No new tooling. Each PR reuses: the boundary's `test`/`type-check`/`build` scripts, the three hard CI
gates (CodeQL, secrets-scan, `Check npm supply chain`), and the local
`npm run security:npm-supply-chain` + `npm audit --audit-level=low --prefix <boundary>` pair. Success
means only the documented `xlsx`/`quagga` accepted risks remain.
