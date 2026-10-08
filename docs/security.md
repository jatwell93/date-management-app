# Security Guide

This document describes the security measures implemented in the Date Management Application to protect user data, prevent attacks, and ensure safe operation in production environments.

**Last Updated**: May 23, 2026  
**Status**: Active - security controls implemented with documented dependency exceptions

---

## Table of Contents

1. [Overview](#overview)
2. [Defense-in-Depth Strategy](#defense-in-depth-strategy)
3. [Input Validation & CSV Injection Prevention](#input-validation--csv-injection-prevention)
4. [Authentication & Token Management](#authentication--token-management)
5. [Rate Limiting](#rate-limiting)
6. [CORS & Cross-Origin Security](#cors--cross-origin-security)
7. [Database & Transport Security](#database--transport-security)
8. [Request & Payload Security](#request--payload-security)
9. [Error Handling](#error-handling)
10. [Secrets & Credentials Management](#secrets--credentials-management)
11. [Edge Compute Security (Workers)](#edge-compute-security-workers)
12. [NPM Supply-Chain Security](#npm-supply-chain-security)
13. [Best Practices for Developers](#best-practices-for-developers)
14. [Security Reporting](#security-reporting)

---

## Overview

The Date Management Application implements **defense-in-depth** security architecture with multiple layers of protection:

- **Input Layer**: Validation, sanitization, and injection prevention
- **Authentication Layer**: Clerk-issued session tokens, verified in the Worker on every request
- **Rate Limiting Layer**: Per-IP request throttling in the Worker
- **Network Layer**: CORS whitelisting, TLS enforcement, request size limits
- **Database Layer**: Parameterized queries, TLS connections, role-based access control
- **Error Handling Layer**: Generic error messages without internal details
- **Secrets Layer**: Automated scanning to prevent credential leaks

**Key Principle**: Each layer works independently. If one layer is bypassed, others remain intact.

---

## Defense-in-Depth Strategy

```
Frontend (React, Cloudflare Pages)
  - Input validation before submission
  - Page CSP and headers from frontend/public/_headers
        |  HTTPS/TLS
        v
Worker API (Cloudflare Workers, workers/src/index-minimal.ts)
  - Security headers on every response
  - Rate limiting (per IP, authenticated vs unauthenticated)
  - Clerk token verification, then organization resolved from the users row
  - Organization entitlement gate
  - JSON body size cap, upload size limits
  - Input validation in handlers
        |  Hyperdrive / TLS
        v
Data layer (Neon Postgres)
  - Parameterized queries (tagged-template SQL in workers/src/database.ts)
  - organization_id filter on every tenant query
  - TLS for connections
  - Encryption at rest (provider-managed)
```

---

## Input Validation & CSV Injection Prevention

### Problem: CSV Injection

CSV injection (formula injection) occurs when user-supplied data is interpreted as formulas by spreadsheet applications. For example:

```
Cell A1 = "=cmd|' /C calc'!A1"  ← Opens calculator when spreadsheet opens
```

### Solution: Escape Leading Special Characters

A value whose first character can start a spreadsheet formula is prefixed with a single quote, which spreadsheets render as text. The rule lives in `shared/domain/csv-injection.ts` so every path applies the same one:

```typescript
// Characters that trigger formulas in spreadsheet applications
export const CSV_INJECTION_PREFIXES = ['=', '+', '-', '@', '\t', '\r'] as const;
```

**What This Does**:

- If a cell value starts with `=`, `+`, `-`, `@`, tab, or carriage return, a single quote (`'`) is prepended
- Spreadsheet applications treat the cell as text, not a formula
- The data is otherwise preserved as entered

### Implementation Details

**Scope**: The control is applied at **ingestion**, because a stored payload can be weaponized by any later export, not only the one that wrote it:

- Catalogue and expiry CSV uploads (`workers/src/upload/catalogue-parser.ts`, `expiry-parser.ts`)
- CSV exports use `toCsvField` from the same module

**Testing**: unit tests in `shared/domain` and the upload parser tests cover the leading characters, empty cells and already-quoted cells.

### For Developers

When writing CSV output or accepting CSV input, import the shared helpers instead of writing a new escape:

```typescript
import { toCsvField } from '../../shared/domain/csv-injection';
```

---

## Authentication & Token Management

### Clerk Sessions

Users sign in through Clerk. The app has no PIN login, no password store and no refresh-token table of its own. The old routes (`/api/auth/login`, `/api/auth/register`, `PUT /api/users/:id/reset-pin`) were removed, and `workers/src/retired-routes.test.ts` pins that they stay gone.

On each request the Worker (`authenticateClerkRequest`, `workers/src/clerk/bootstrap-handler.ts`):

1. Reads the `Authorization: Bearer <token>` header; a missing or malformed header is a 401.
2. Verifies the token with Clerk's `verifyToken`, using `CLERK_SECRET_KEY` and the allowed authorized parties (`azp`) derived from the configured frontend origins.
3. Takes the Clerk user id (`sub`) from the verified token.

The Worker then reads `organization_id` and `role` from its own `users` row for that Clerk user. A token with no matching row is refused with 401. The organization is never taken from the request.

### Session Lifetime and Revocation

Token lifetime, refresh and revocation (sign-out, session revoke) are managed by Clerk. Revoke a user's access in the Clerk dashboard; the Worker verifies each token and does not cache a session.

### Webhooks

Clerk and Stripe call the Worker on `/api/webhooks/clerk` and `/api/webhooks/stripe`. Both verify the provider's signature (Svix for Clerk, Stripe's scheme for Stripe) with a signing secret, and claim each event id in a ledger table before processing, so a replayed delivery has no second effect.

### Security Properties

✅ **No credential store**: the app holds no passwords or PINs
✅ **Immediate revocation**: Clerk session revocation takes effect on the next request
✅ **Server-side tenant context**: the organization comes from the database row, not the token payload or request
✅ **Replay-safe webhooks**: signature verified, event claimed once

---

## Rate Limiting

### Purpose

Rate limiting prevents:

- **Brute-force attacks**: repeated guesses against any endpoint
- **Denial of Service (DoS)**: flooding endpoints with requests
- **API abuse**: scraping, data harvesting, resource exhaustion

### Implementation

`workers/src/utils/minimal-rate-limit.ts`, called from `index-minimal.ts`. Counters are keyed per client IP (`CF-Connecting-IP`), in separate authenticated and unauthenticated buckets, and stored in the `RATE_LIMITER` KV namespace, with an in-memory fallback if the binding is missing.

| Bucket        | Production limit | Window |
| ------------- | ---------------- | ------ |
| Authenticated | 30 requests      | 1 min  |
| Anonymous     | 5 requests       | 1 min  |

These are the values in `workers/wrangler.toml` at the time of writing; that file is the source of truth. Upload size and per-tier usage limits are separate controls (see Request & Payload Security).

### Configuration

Set in `workers/wrangler.toml` under `[env.production.vars]`:

```toml
RATE_LIMIT_WINDOW = "60000"              # window in milliseconds
RATE_LIMIT_MAX_REQUESTS = "5"            # unauthenticated
RATE_LIMIT_MAX_AUTHENTICATED = "30"      # authenticated
```

### When Rate Limit is Hit

**Response**: `HTTP 429 Too Many Requests`

**Headers**:

```
Retry-After: <seconds until the window resets>
X-RateLimit-Limit: <limit>
X-RateLimit-Remaining: 0
X-RateLimit-Reset: <ISO timestamp>
```

**Behavior**:

- Requests are rejected before any handler or database work runs
- Minimal resources consumed
- IP-based tracking

### For Developers

Do not add a second limiter inside a handler. Change the limits or the bucket logic in `utils/minimal-rate-limit.ts` and cover the change in `utils/minimal-rate-limit.test.ts`.

---

## CORS & Cross-Origin Security

### Problem: Cross-Site Request Forgery (CSRF)

Without CORS protection, malicious websites could make requests on behalf of logged-in users.

The API authenticates with a bearer token in the `Authorization` header, not an ambient cookie, so a forged cross-site request does not carry credentials. CORS is still restricted as a second control.

### Solution: CORS Allow-list

`getCorsHeaders` (`workers/src/utils/worker-response.ts`):

```typescript
const allowAll = env.NODE_ENV !== 'production' || !env.FRONTEND_URL;
const allowedOrigin = allowAll ? requestOrigin || '*' : env.FRONTEND_URL || 'http://localhost:3000';
```

- **Production with `FRONTEND_URL` set**: only that origin is allowed, with `Access-Control-Allow-Credentials: true`.
- **Non-production, or `FRONTEND_URL` unset**: any origin is reflected. **Set `FRONTEND_URL` before a production deploy.**
- Allowed methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`. Allowed headers: `Content-Type, Authorization`.

### Configuration

Set `FRONTEND_URL` as a Worker variable or secret for each environment. Never rely on the permissive non-production behavior in production.

### How CORS Works

**Step 1: Preflight** (browser sends automatically): `OPTIONS` with `Origin` and `Access-Control-Request-Method`. The Worker answers 204 with the CORS headers (`handleOptions`).

**Step 2: Actual request**: the browser sends the request with `Origin` and `Authorization`, and only exposes the response if `Access-Control-Allow-Origin` matches.

### Results

✅ Requests from the configured frontend origin: **Allowed**
❌ Browser requests from other origins in production: **Blocked by the browser**
⚠️ CORS does not stop non-browser clients; authentication does

---

## Database & Transport Security

### TLS/SSL Encryption

The Worker reaches Neon Postgres through Hyperdrive. Connection strings carry `sslmode=require`:

```bash
postgresql://user:password@host/db?sslmode=require
#                                  ↑ TLS required
```

**What `sslmode=require` Does**:

- 🔒 Encrypts all database traffic with TLS
- 🔒 Prevents password transmission in plain text
- 🔒 Prevents data interception over network

Local development runs `npm run dev:local` against your own Neon branch (see `workers/README.md`), so local traffic is encrypted too. There is no local SQLite database.

### Parameterized Queries (SQL Injection Prevention)

**Vulnerable** ❌:

```typescript
const rows = await db.sql.query(`SELECT * FROM products WHERE barcode = '${userInput}'`);
// If userInput = "' OR '1'='1" → Injection!
```

**Safe** ✅:

```typescript
const rows =
  await db.sql`SELECT * FROM products WHERE organization_id = ${organizationId} AND barcode = ${userInput}`;
// Values become bound parameters; user input cannot change the SQL structure
```

Use the tagged-template form for every value. Never build SQL by concatenating or interpolating strings.

### Role-Based Access Control

Roles are `admin`, `manager` and `team_member` (`shared/domain/roles.ts`). `users.role` is constrained to those values (migration 0018). Clerk membership roles are mapped onto them by the same normalizer at bootstrap and in the Clerk webhook.

```typescript
if (auth.role !== 'admin') {
  return errorResponse('Admin role required', 403, env, requestOrigin);
}
```

Role changes are recorded in `org_audit_log` (migration 0013).

---

## Request & Payload Security

### Request Size Limits

**JSON bodies**: capped at 1 MiB by default (`workers/src/utils/body-limit.ts`, override with `MAX_JSON_BODY_BYTES`). A Worker isolate shares 128 MB of memory with the other requests it serves, so the cap is a tenant-fairness control as well as an abuse control.

**File uploads**: set in `workers/wrangler.toml`:

```toml
MAX_FILE_SIZE = "26214400"             # 25 MB
ENTERPRISE_MAX_FILE_SIZE = "104857600" # 100 MB
```

Uploads are also subject to the per-tier storage quota.

**Why Limits Matter**:

- Prevents memory exhaustion
- Limits processing time for large files
- Keeps one tenant from starving others

### Content Validation

Uploaded CSV/XLSX content is parsed and validated row by row (`workers/src/upload/`). Every cell passes through the CSV-injection escape described above. XLSX parsing carries an accepted dependency risk; see "Accepted Dependency Risks".

---

## Error Handling

### Principle: Generic Error Messages

Handlers return `{ "error": "<message>" }` with an HTTP status through `errorResponse`. Messages for client faults (validation, conflict) are specific. Do not put database error text, SQL, stack traces or third-party service details in a response message.

Unexpected exceptions are captured in Sentry, and the response carries no internal detail.

### Why Generic Messages?

- ✅ Prevents information leakage
- ✅ Doesn't reveal database schema
- ✅ Doesn't expose third-party service details
- ✅ Doesn't help attackers understand infrastructure

### Error Categories

| Type                     | Status | Message                 | Example                                    |
| ------------------------ | ------ | ----------------------- | ------------------------------------------ |
| **Validation Error**     | 400    | Field-specific error    | "Invalid email format"                     |
| **Authentication Error** | 401    | Generic message         | "Missing or invalid Authorization header"  |
| **Authorization Error**  | 403    | Generic message         | "Admin role required"                      |
| **Not Found**            | 404    | Generic message         | "Product not found"                        |
| **Conflict**             | 409    | Specific message        | "Store area with this name already exists" |
| **Rate limited**         | 429    | Generic + `Retry-After` | "Too many requests"                        |
| **Server Error**         | 500    | Generic message         | "An error occurred"                        |

Unique violations (SQLSTATE 23505) are classified in `workers/src/db-errors.ts` and become 409s, not 500s.

### Stack Traces

Stack traces are logged to Sentry (internal only) and never sent to the client.

---

## Secrets & Credentials Management

### What Are Secrets?

Credentials that should **never** be committed to git:

- Database passwords
- API keys (AWS, OpenAI, etc.)
- JWT secrets
- Cloudflare R2 access keys
- Third-party tokens

### Prevention: git-secrets

**Installation** (one-time):

```bash
# macOS
brew install git-secrets

# Linux
git clone https://github.com/awslabs/git-secrets.git
cd git-secrets && sudo make install

# Windows (Git Bash)
# See: https://github.com/awslabs/git-secrets#windows
```

**Setup for This Project** (one-time):

```bash
bash scripts/setup-git-secrets.sh
# Creates pre-commit hook and configures patterns
```

**Patterns Scanned**:

- AWS access keys: `AKIA*`
- Private keys: `BEGIN PRIVATE KEY`, `BEGIN RSA PRIVATE KEY`
- Common secrets: `password`, `api_key`, `secret`
- Database URLs with credentials
- GitHub/GitLab personal access tokens
- JWT secrets
- Cloudflare R2 credentials

### Before Every Commit

```bash
# Option 1: Manual scan (recommended before git commit)
npm run secrets-scan

# Option 2: Automatic hook (runs on every commit)
# Pre-commit hook blocks commits if secrets detected
git commit -m "Fix: handle expired tokens"
# ❌ If hook detects secret: COMMIT BLOCKED
# ✅ If no secrets: Commit proceeds
```

### What Secrets Are Allowed?

**✅ Safe to Commit**:

- `.env.example` (template with placeholder values)
- Test fixtures: `fake_key_xxxx`, `test_secret`
- Documentation examples with sanitized values

**❌ Never Commit**:

- Real database passwords
- Real API keys
- Real JWT secrets
- Real access tokens

### Environment Variables

All sensitive config goes in `.env`:

```bash
# ✅ .env (git-ignored)
DATABASE_URL=postgresql://user:realpassword@host/db

# ✅ .env.example (committed)
DATABASE_URL=postgresql://user:password@host/db
```

---

## Edge Compute Security (Workers)

The Worker is the API itself, so its checks are the API's checks. There is no separate backend behind it.

### Token Validation

Clerk tokens are verified in `authenticateClerkRequest` (see Authentication above), before any handler or database work.

### Benefits

- **Early Rejection**: invalid tokens are refused before any database query
- **Global Protection**: validation runs on Cloudflare's network
- **Low Latency**: edge locations close to users

### Public Endpoints (No Bearer Token)

- `GET /health` and `GET /api/health`
- `POST /api/webhooks/clerk` and `POST /api/webhooks/stripe`: no bearer token, but each verifies the provider's signature (the Stripe receiver answers 503 until its signing secret is set)

Every other `/api/*` route runs `authenticateApiRequest`.

### Security Headers

`workers/src/utils/security-headers.ts` sets `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer` and others on every response. The page CSP for the frontend lives in `frontend/public/_headers`, because Cloudflare Pages serves the frontend.

---

## NPM Supply-Chain Security

### Current Controls

The repository uses deterministic npm lockfiles for each package boundary:

- Root: `package-lock.json`
- Frontend: `frontend/package-lock.json`
- Workers: `workers/package-lock.json`

GitHub Actions installs dependencies with `npm ci`, and the security workflow runs:

```bash
npm run security:npm-supply-chain
```

This check validates all package manifests and lockfiles for blocked dependency sources:

- Git dependencies such as `git+ssh:` and `github:`
- Remote tarball dependencies
- Local `file:` and `link:` dependencies
- Floating `*` and `latest` dependency declarations
- Lockfile entries resolved outside `https://registry.npmjs.org`

### NPM Defaults

The committed `.npmrc` keeps package changes deterministic and quiet:

```ini
package-lock=true
save-exact=true
fund=false
audit=false
engine-strict=true
legacy-peer-deps=false
```

`audit=false` only disables implicit audit noise during installs. Explicit audit commands remain required during security work.

Use install scripts sparingly. For lockfile-only dependency changes, prefer:

```bash
npm install <package>@<version> --package-lock-only --ignore-scripts
```

Do not set global `ignore-scripts=true` for this repo without a separate migration plan. Check which dependencies need install-time build hooks before proposing it.

### Dependabot

Dependabot is configured for the root, frontend, workers, and GitHub Actions package ecosystems. Review dependency PRs by package boundary and avoid mixing unrelated runtime and tooling updates unless the advisory requires coordinated remediation.

### Dependabot Remediation Log

> Entries below are dated records. Rows marked "Backend" refer to the Express backend (`backend/`), retired in October 2026 (tag `express-sqlite-last`); they are kept as history and are not current dependencies.

**2026-06-27** — Cleared the runtime, edge, and build-tool advisories that had a clean (non-major) patched path, working per package boundary with lockfile-only updates (`--package-lock-only --ignore-scripts`) so no install scripts ran:

| Boundary | Change                                                                                                                                                                                                  | Advisories cleared                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Backend  | `multer ^2.0.2 → ^2.2.0` (direct, runtime); `form-data → 4.0.6`, `@opentelemetry/*`, `@sentry/*`, `@babel/core` via audit fix; bumped existing overrides `tar 7.5.15 → 7.5.17` and `ws 8.20.1 → 8.21.0` | multer (high), form-data (high), tar, ws, OpenTelemetry/Sentry (moderate)     |
| Root     | `wrangler 4.94.0 → 4.105.0` (clears bundled `undici`/`ws`/`esbuild`/`miniflare`); `js-yaml → 4.3.0` via audit fix                                                                                       | undici (high), ws (high), esbuild (low), js-yaml (moderate) → **0 remaining** |
| Workers  | `esbuild ^0.27.7 → ^0.28.1` (direct); `wrangler`/`vite`/`undici`/`ws`/`miniflare`/`vitest-pool-workers` via audit fix                                                                                   | undici (high), vite (high), ws (high), esbuild (low) → **0 remaining**        |

After each change, `npm audit` confirmed the targeted advisories cleared and `npm run security:npm-supply-chain` confirmed the dependency-source policy still passes.

**2026-06-27** — Migrated the frontend off Create React App (`react-scripts`/CRACO) to Vite (follow-up #290). This removed the entire CRA build-tool advisory tree wholesale rather than force-patching transitive dependencies:

| Boundary | Change                                                                                                                                                                                                                                                | Advisories cleared                                                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend | Replaced `react-scripts` + `@craco/craco` with `vite` + `@vitejs/plugin-react`; PWA service worker preserved via `vite-plugin-pwa` (`injectManifest`, reusing the existing `service-worker.ts`); Tailwind now processed through PostCSS at build time | `shell-quote` (**critical**), `webpack-dev-server`, `postcss`, `nth-check`, `css-select`, `svgo` and the rest of the CRA/webpack build-tool tree → **removed** |

The test runner migration is staged: this change introduces a temporary standalone Jest (decoupled from CRA) so the existing suites stay green; the `jest → vitest` port is tracked in #291. As a result the frontend now reports the same dev/test-only Jest toolchain advisories as the backend (see Accepted Dependency Risks below), which #291 resolves.

**2026-06-27** — Ported the frontend test suite from Jest to Vitest (the frontend portion of #291). This removes the standalone Jest scaffolding added during the Vite migration and its dev/test-only advisories:

| Boundary | Change                                                                                                                                                                                                                         | Advisories cleared                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Frontend | Replaced `jest` / `babel-jest` / `jest-environment-jsdom` / `jest-fetch-mock` with `vitest` + `jsdom` + `vitest-fetch-mock`; 54 suites / 470 tests ported (`jest.*` → `vi.*`), aligning the frontend with the workers boundary | `@jest/*`, `babel-jest`, `babel-plugin-istanbul`, `@istanbuljs/load-nyc-config`, dev/test `js-yaml` → **removed** from the frontend |

After the port, `npm audit` in `/frontend` reports only the pre-existing `quagga` and `xlsx` accepted risks below; the Jest toolchain advisories are gone. The backend Jest 30 upgrade (the remaining part of #291) is unaffected by this change.

**2026-06-28** — Upgraded the backend test toolchain to Jest 30 (the remaining part of #291): `jest` `^29.7.0` → `^30.4.2`, `@types/jest` `^29` → `^30`, kept `ts-jest` on `^29.4.11` (the Jest-30-compatible line — ts-jest ships no v30 and its `29.4.x` declares `jest: ^29 || ^30` as a peer), and removed the unused `jest-environment-jsdom` dev dependency (both backend Jest configs run `testEnvironment: 'node'`). The full suite (152 suites / 1,667 tests) passes on Jest 30.

Contrary to the original framing of #291, the Jest 30 upgrade does **not** clear the backend's dev/test toolchain advisories. `npm audit` moves from 20 → 19 (one moderate cleared), but the remainder persist because they are now dominated by a newly-published advisory with **no upstream fix**:

| Boundary | Change                                                 | Advisory outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend  | `jest` `29 → 30`, drop unused `jest-environment-jsdom` | Net **−1 moderate**. The residual moderate advisories trace to `js-yaml <= 4.1.1` (GHSA-h67p-54hq-rp68, quadratic-complexity DoS, no fixed release) pulled in via `@istanbuljs/load-nyc-config` → `babel-plugin-istanbul` → `@jest/transform`. Jest depends on `babel-plugin-istanbul` unconditionally (independent of our `coverageProvider: 'v8'` setting), so this chain is present at **every** Jest version. The only way to shed it is to leave Jest — the path the frontend already took with Vitest (v8 coverage, no `babel-plugin-istanbul`). |

**2026-06-28** — Migrated the backend test suite from Jest to **Vitest v4** (the change #291 actually required to clear the toolchain advisories, per the row above). Replaced `jest` / `ts-jest` / `@types/jest` with `vitest` + `@vitest/coverage-v8` (v8 coverage, no `babel-plugin-istanbul`) plus `unplugin-swc` / `@swc/core` (SWC emits the `design:paramtypes` decorator metadata `tsyringe` needs; the intuitive `esbuild: false` is inert under Vitest 4 — `oxc: false` is required). All 154 test files were ported (`jest.*` → `vi.*`); the two DB-targeted Jest configs became `vitest.config.ts` (SQLite) and `vitest.config.neon.ts` (PostgreSQL). The full suite passes (1,658 passed / 9 skipped) and the coverage thresholds (75/70/75/75) hold.

| Boundary | Change                                                                                                                | Advisory outcome                                                                                                                                                                                                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend  | Replaced Jest with Vitest (v8 coverage); dropped `jest` / `ts-jest` / `@types/jest` (247 transitive packages removed) | `@jest/*`, `babel-plugin-istanbul`, `@istanbuljs/load-nyc-config`, and the dev/test `js-yaml <= 4.1.1` they pulled in are **gone**. `npm audit` for `/backend` drops from 19 → 1; the only remaining advisory is the pre-existing `xlsx` runtime risk (below). This is the change that closes the backend Jest-toolchain accepted-risk row. |

**2026-07-19** — Triaged the backlog of 32 open Dependabot PRs by package boundary (no advisories were outstanding beyond the accepted risks below; this was routine version hygiene, not remediation). All bumps were validated as npm-registry-sourced, so the supply-chain source policy was never at risk — the only concern was breakage from major version jumps.

- **Closed as superseded (2):** root `wrangler` #212 (target 4.103.0 < shipped 4.105.0) and workers `esbuild` #163 (target 0.28.0 < shipped 0.28.1) — merging either would have been a downgrade.
- **Safe batch — approved for squash auto-merge (registry-sourced dev/type/tooling, no runtime code paths):** backend `@types/csv-parse` #200, `@types/supertest` #203, `@types/sqlite3` #196; frontend `@types/jwt-decode` #160, `@types/uuid` #157; workers `@types/bcryptjs` #156, `cross-env` #176, `wrangler` #211, `@cloudflare/vitest-pool-workers` #208; root `globals` #278; the `github-actions` group #362. The `@types/node` → 26 bumps for root #277 and backend #289 were each **locally `tsc`-verified clean** before auto-merge was enabled.
- **Deferred (left open with per-PR remediation notes):**
  - `@types/node` → 26 for **frontend #285** (fails local `tsc` — TypeScript 4.9.5 cannot parse Node-26 `.d.ts`; coupled to the frontend TS upgrade #152) and **workers #276** (fails the `bundle-size` gate's typecheck/build). Their green PR-level CI was misleading because those boundaries' merge gates do not run `tsc`; the failure only surfaced under a local typecheck.
  - Runtime majors requiring code changes + focused tests: `rate-limiter-flexible` 8→11 #286 (security control), `stripe` 13→22 #283, `@prisma/client` + `prisma` 5→7 #183/#153 (must move as a pair), `web-vitals` 2→5 #287 (`getCLS`→`onCLS`/`onINP`).
  - Tooling majors requiring coordinated migration: `eslint` 8→10 group #279/#170/#288/#178 (flat-config migration across boundaries) and `typescript` → 6 group #159/#198/#166/#152.

| Boundary                                      | Change                                                                                                                               | Outcome                                                                                                                                                                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| root / backend / frontend / workers / actions | Closed 2 stale PRs; approved ~11 dev/type/tooling bumps for auto-merge; deferred 15 major-version PRs with tracked remediation notes | `npm run security:npm-supply-chain` passes; `npm audit` unchanged — only the documented `xlsx` (backend/frontend) and `quagga` (frontend) accepted risks remain, root/workers clean. Open Dependabot count reduced 32 → 15 (the deferred majors), each with a documented next step. |

**2026-07-20** — Executed the deferred major-version upgrades from the 2026-07-19 triage as a risk-ordered set of per-PR branches (OpenSpec change `upgrade-deferred-dependency-majors`). This was capability/version hygiene, not advisory remediation — **no new advisories were introduced and none of the accepted risks changed**; `npm run security:npm-supply-chain` passes and `npm audit` reports only the documented `xlsx`/`quagga` risks (root/workers clean). Two upgrades also **shrank the supply-chain surface** by removing dead dependencies (`rate-limiter-flexible`, `@prisma/adapter-planetscale`).

| Boundary                            | Change                                                                                                                              | Outcome                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Frontend                            | `web-vitals 2→5` (#287): `getCLS/getFID/…` → `onCLS/onINP/…`, FID→INP in `reportWebVitals.ts`                                       | Landed; `vitest`/`tsc`/`vite build` green                                      |
| Backend                             | `rate-limiter-flexible` 8→11 (#286) — **removed** as a dead dep (declared, imported nowhere; live limiting is `express-rate-limit`) | Supply-chain surface reduced; tier behaviour unchanged                         |
| root + backend + workers + frontend | `typescript → 6.0.3` (#159/#198/#166/#152) as one coordinated set                                                                   | All boundaries typecheck/build green                                           |
| Backend + frontend                  | `eslint → 9` + flat-config migration; `eslint-plugin-react-hooks 4→7` (#178)                                                        | Migration delivered; all boundaries lint clean                                 |
| Frontend + workers                  | `@types/node → 26.1.1` (#285/#276), unblocked by the TS 6 upgrade                                                                   | typecheck/build/`test:db` green                                                |
| Backend                             | `stripe 13→22` (#283): adopted API `2026-06-24.dahlia`, migrated the "basil" `current_period_end` move to subscription items        | Suite green; caught+fixed a v22 empty-key construction throw masked by Doppler |
| root + backend                      | `@prisma/client` + `prisma` `5→6.19.3` (#373); removed dead `@prisma/adapter-planetscale@7.8.0`                                     | Suite green; `test:db` 70/70                                                   |

**Still deferred (left open with recorded reasons):**

- **ESLint 10** — root `eslint` #279, backend `eslint` #288, `@eslint/js` #170. Upstream-blocked: `eslint-plugin-react@7.37.x` calls `context.getFilename()`, removed in ESLint 10, and the react/a11y/import plugins cap their `eslint` peer at `^9`. ESLint **9** is the max viable version and is already flat-config-native, so the migration was delivered at 9. Re-attempt when `eslint-plugin-react` ships ESLint 10 support.
- **Prisma 7** — `@prisma/client` #183, `prisma` #153. Prisma 7 is an ORM re-architecture, not a bump: it mandates **driver adapters** (`new PrismaClient()` no longer self-connects), is **ESM-only** (`"type":"module"`), and needs the new `prisma-client` generator + `prisma.config.ts`. This backend is CommonJS + tsyringe/reflect-metadata + SWC decorator metadata, so 7 is a separate architecture change; landed **6** (classic engine, CJS, auto-`.env`) as the safe forward step.

### Accepted Dependency Risks

| Package area         | Current status                                                                                                               | Mitigation                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `xlsx` in frontend   | npm audit reports known high severity advisories and no fixed npm release.                                                   | Keep file upload limits, input validation, and CSV injection controls active. Treat XLSX replacement as follow-up work before broadening spreadsheet import features. |
| `quagga` in frontend | Pulls old request/form-data/qs paths through image loading dependencies (`form-data`, `request`, `tough-cookie` advisories). | Keep scanner use local/browser-only and evaluate replacement during scanner dependency remediation.                                                                   |

### Developer Workflow

Before committing dependency changes:

```bash
npm run security:npm-supply-chain
npm audit --audit-level=low
npm audit --audit-level=low --prefix frontend
npm audit --audit-level=low --prefix workers
```

If a vulnerability cannot be resolved safely, document the advisory, affected package boundary, mitigation, and follow-up path in OpenSpec and this security guide.

---

## Best Practices for Developers

### 1. Never Commit Secrets

```bash
# Before committing:
npm run secrets-scan
# If no errors → Safe to commit
```

### 2. Validate All User Input

Validate in the handler before any database call, and reject what you do not expect:

```typescript
const body: unknown = await request.json(); // enforceJsonBodyLimit caps the size
if (!isJsonObject(body) || typeof body.name !== 'string' || body.name.trim() === '') {
  return errorResponse('name is required', 400, env, requestOrigin);
}
```

### 3. Pass Collaborators Explicitly

Handlers and jobs take a `Database` (and `Env`) as arguments instead of reaching for module state. That is what lets tests substitute pglite or a fake:

```typescript
// ✅ Good - collaborators are parameters
export async function listProducts(request: Request, env: Env, db: Database) {}

// ❌ Avoid - hidden module-level client
const db = createWorkersDatabase(globalEnv);
```

### 4. Sanitize CSV Input and Output

```typescript
import { toCsvField } from '../../shared/domain/csv-injection';

const line = [toCsvField(item.name), toCsvField(item.barcode)].join(',');
```

### 5. Return Typed, Specific Errors

```typescript
// ✅ Good - specific status and message
return errorResponse('Store area with this name already exists', 409, env, requestOrigin);

// ❌ Avoid - leaking internals
return errorResponse(String(error), 500, env, requestOrigin);
```

### 6. Rate Limiting

Rate limiting is applied once, in `index-minimal.ts`. Do not add per-handler limiters; tune `utils/minimal-rate-limit.ts` instead.

### 7. Check Authorization

```typescript
// ✅ Good - check role, scope by organization
if (auth.role !== 'admin') return errorResponse('Admin role required', 403, env, requestOrigin);
await db.updateProduct(auth.organizationId, id, fields);

// ❌ Bad - no organization
await db.updateProduct(id, fields);
```

### 8. Run Security Scans Before Committing

```bash
# Test suite
npm test

# Linting
npm run lint

# UBS (Ultimate Bug Scanner)
ubs src/

# Secrets scanning
npm run secrets-scan

# NPM dependency source policy
npm run security:npm-supply-chain

# TypeScript compilation
npm run build
```

---

## Security Reporting

### Report Vulnerabilities Responsibly

If you discover a security vulnerability:

1. **Do NOT open a public GitHub issue**
2. **Do NOT commit proof-of-concept code**
3. **Email**: security@example.com (or contact project maintainers privately)

Include:

- Vulnerability description
- Affected component/endpoint
- Steps to reproduce (if safe to share)
- Potential impact
- Suggested remediation

### Security Response Timeline

- **Critical**: Response within 24 hours
- **High**: Response within 48 hours
- **Medium**: Response within 7 days
- **Low**: Response within 30 days

### What to Expect

- Acknowledgment of report
- Severity assessment
- Proposed remediation plan
- Estimated fix timeline
- Credit in release notes (if desired)

---

## Continuous Security

### Regular Audits

**Monthly**:

- `npm audit --audit-level=low` in the root, frontend, and workers packages
- `npm run security:npm-supply-chain` to check dependency sources
- Review error logs for suspicious patterns
- Verify rate limiter effectiveness

**Quarterly**:

- Security code review
- Penetration testing (if budget allows)
- Update security documentation

### Keeping Dependencies Updated

```bash
# Check for outdated packages
npm outdated

# Update to latest safe versions
npm audit fix

# Review breaking changes
npm outdated --long
```

### Monitoring & Alerting

Integration with Sentry for error tracking:

```bash
SENTRY_DSN=https://...@sentry.io/...
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
```

Sentry alerts on:

- 5xx server errors
- Authentication failures
- Validation errors (potential attacks)
- Rate limit hits

---

## References & Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Cloudflare Workers security model](https://developers.cloudflare.com/workers/reference/security-model/)
- [Node.js Security Checklist](https://blog.risingstack.com/node-js-security-checklist/)
- [NPM Security Best Practices](https://github.com/lirantal/npm-security-best-practices)
- [git-secrets Documentation](https://github.com/awslabs/git-secrets)
- [CORS by MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [Clerk documentation](https://clerk.com/docs)

---

## Questions or Issues?

- 📚 See [workers/README.md](../workers/README.md) for developer setup
- 🔒 See [cross-tenant-isolation-assurance.md](./cross-tenant-isolation-assurance.md) for tenant isolation
- 🐛 Report bugs via [security reporting](#security-reporting)
- 💬 Ask in team Slack or project discussions
