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
- **Authentication Layer**: PIN-based login with JWT tokens and refresh token lifecycle
- **Rate Limiting Layer**: Request throttling to prevent brute-force attacks
- **Network Layer**: CORS whitelisting, TLS enforcement, request size limits
- **Database Layer**: Parameterized queries, TLS connections, role-based access control
- **Error Handling Layer**: Generic error messages without internal details
- **Secrets Layer**: Automated scanning to prevent credential leaks

**Key Principle**: Each layer works independently. If one layer is bypassed, others remain intact.

---

## Defense-in-Depth Strategy

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (React)                                             │
│ - Input validation before submission                          │
│ - Secure token storage (httpOnly cookies for refresh tokens) │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTPS/TLS
┌────────────────▼────────────────────────────────────────────┐
│ Edge Layer (Cloudflare Workers)                              │
│ - JWT validation at edge                                      │
│ - Early request rejection                                     │
│ - Global rate limiting                                        │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTPS/TLS
┌────────────────▼────────────────────────────────────────────┐
│ API Gateway Layer (Express Backend)                          │
│ - CORS validation                                             │
│ - Request size limits                                         │
│ - Rate limiting (per-endpoint)                               │
│ - Input validation middleware                                │
└────────────────┬────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────┐
│ Application Layer (Services, Controllers)                    │
│ - Business logic validation                                   │
│ - Authorization checks                                        │
│ - Parameterized database queries                             │
│ - Secure error handling                                       │
└────────────────┬────────────────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────────────────┐
│ Data Layer (Prisma ORM + PostgreSQL/SQLite)                  │
│ - TLS for remote connections                                  │
│ - SQL injection prevention (parameterized queries)           │
│ - Role-based access control (RBAC)                           │
│ - Data encryption at rest (provider-managed)                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Input Validation & CSV Injection Prevention

### Problem: CSV Injection

CSV injection (formula injection) occurs when user-supplied data is interpreted as formulas by spreadsheet applications. For example:

```
Cell A1 = "=cmd|' /C calc'!A1"  ← Opens calculator when spreadsheet opens
```

### Solution: Escape Leading Special Characters

All user input that will be exported to CSV format is sanitized by escaping leading special characters:

```typescript
// Characters that trigger formulas in spreadsheet applications
const FORMULA_CHARS = ['=', '+', '-', '@', '\t', '\r'];

// Before exporting to CSV, escape these characters
const sanitized = FORMULA_CHARS.includes(value[0]) ? `'${value}` : value;
```

**What This Does**:

- If a cell value starts with `=`, `+`, `-`, `@`, tab, or carriage return, we prepend a single quote (`'`)
- Spreadsheet applications treat quoted cells as text, not formulas
- The data is preserved exactly as entered by the user

### Implementation Details

**Scope**: All CSV exports via `GET /reports/*` endpoints

- Monthly expiry reports
- Markdown reports
- Usage reports
- Daily usage data

**Testing**:

- Unit tests verify escaping of all leading special characters
- Edge cases: empty cells, already-quoted cells, multiple special characters
- Example test cases:
  ```typescript
  expect(sanitize('=SUM(A1:A10)')).toBe("'=SUM(A1:A10)");
  expect(sanitize('+1+1')).toBe("'+1+1");
  expect(sanitize('Normal text')).toBe('Normal text');
  expect(sanitize('')).toBe('');
  ```

### For Developers

When exporting user data to CSV:

```typescript
import { sanitizeCsvValue } from '../utils/csv-sanitizer';

const rows = products.map((p) => ({
  name: sanitizeCsvValue(p.name), // ← Always sanitize
  barcode: sanitizeCsvValue(p.barcode),
  expiry: p.expiry_date.toISOString(), // ← Date is safe
}));
```

---

## Authentication & Token Management

### PIN-Based Login

Users authenticate with a 4-digit PIN:

```typescript
const user = await authService.login({ pin: '5624' });
// Returns: { accessToken, refreshToken, user }
```

**PIN Storage**:

- Pins are hashed using bcrypt (10 salt rounds)
- Database stores only the hash: `$2b$10$...`
- Raw PIN never stored or logged
- PIN cannot be recovered from hash

### Access Token (Short-Lived)

JWT token valid for **1 hour**:

```
{
  "sub": "user-id-123",
  "role": "Manager",
  "iat": 1707497400,
  "exp": 1707501000    ← Expires in 1 hour
}
```

**When to Use**:

- Include in `Authorization: Bearer <token>` header for API requests
- Automatically sent by frontend in httpOnly cookie (when configured)
- Short expiry minimizes risk if token is compromised

### Refresh Token (Long-Lived)

JWT token valid for **7 days**:

```
{
  "sub": "user-id-123",
  "type": "refresh",
  "iat": 1707497400,
  "exp": 1708102200   ← Expires in 7 days
}
```

**When to Use**:

- Only sent during login (`POST /auth/login`)
- Store securely (httpOnly, Secure, SameSite cookies recommended)
- Only used to request new access tokens

**Token Refresh Flow**:

```
1. User logs in → Get access + refresh tokens
2. Access token expires (1 hour)
3. Frontend uses refresh token → POST /auth/refresh
4. Backend verifies refresh token is not revoked/expired
5. Backend issues new access token
6. User continues without re-entering PIN
7. (Optional) Frontend rotates refresh token on rotation
```

### Token Revocation (Logout)

Refresh tokens are tracked in database:

```
RefreshToken table:
├── id
├── userId
├── token (unique)
├── expiresAt
├── revokedAt  ← Set to NOW() on logout
├── createdAt
└── updatedAt
```

**Logout Process**:

```typescript
await authService.revokeRefreshToken(refreshToken);
// Sets revokedAt = NOW()
// Token cannot be used even if not expired
```

**Token Cleanup**:

```typescript
// Scheduled daily (or on-demand)
await authService.cleanupExpiredTokens();
// Deletes rows where expiresAt < NOW()
```

### Security Properties

✅ **Prevents Token Exhaustion**: Expiry dates ensure tokens eventually become invalid  
✅ **Supports Logout**: Revocation tracking allows immediate token invalidation  
✅ **Minimizes Damage**: Expired access tokens limit window of exposure  
✅ **Enables Token Rotation**: Refresh tokens can be rotated without user friction

---

## Rate Limiting

### Purpose

Rate limiting prevents:

- **Brute-force attacks**: Login attempts with multiple PINs
- **Denial of Service (DoS)**: Flooding endpoints with requests
- **API abuse**: Scraping, data harvesting, resource exhaustion

### Implementation

**Three Tiers of Rate Limiting**:

| Tier         | Endpoints                | Limit        | Window     | Purpose                      |
| ------------ | ------------------------ | ------------ | ---------- | ---------------------------- |
| **Strict**   | `POST /auth/login`       | 5 requests   | 15 minutes | Prevent PIN brute-force      |
| **Strict**   | `POST /users` (register) | 5 requests   | 15 minutes | Prevent account spam         |
| **Upload**   | `POST /upload`           | 10 requests  | 1 hour     | Prevent CSV processing abuse |
| **Standard** | All other endpoints      | 100 requests | 15 minutes | General DoS prevention       |

### Configuration

Set in `.env.example`:

```bash
# Rate Limiting
RATE_LIMIT_WINDOW=60000              # Time window in milliseconds (1 minute)
RATE_LIMIT_MAX_REQUESTS=10           # Default for unauthenticated
RATE_LIMIT_MAX_AUTHENTICATED=100     # For authenticated users
```

### When Rate Limit is Hit

**Response**:

```
HTTP 429 Too Many Requests

{
  "error": "Too many requests, please try again later.",
  "retryAfter": "12m"
}
```

**Headers**:

```
Retry-After: 720     ← Seconds until user can retry
RateLimit-Limit: 5
RateLimit-Remaining: 0
RateLimit-Reset: <unix-timestamp>
```

**Behavior**:

- Requests are rejected immediately at middleware level
- No database queries executed
- Minimal server resources consumed
- IP-based tracking (can integrate with geolocation)

### For Developers

**Applying Rate Limiting**:

```typescript
import { createRateLimiter } from '../middleware/rateLimiter';

const strictLimiter = createRateLimiter('strict'); // 5/15min

router.post('/auth/login', strictLimiter, authController.login);
```

---

## CORS & Cross-Origin Security

### Problem: Cross-Site Request Forgery (CSRF)

Without CORS protection, malicious websites could make requests on behalf of logged-in users:

```html
<!-- Attacker's website -->
<img src="https://app.example.com/api/users/123?action=delete" />
<!-- User's browser automatically includes auth cookies -->
```

### Solution: CORS Whitelist

The backend explicitly allows only trusted frontend origins:

```typescript
const cors = require('cors');

app.use(
  cors({
    origin: ['https://app.example.com', 'https://staging.example.com'],
    credentials: true, // Include cookies
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
```

### Configuration

**Development** (`.env.example`):

```bash
CORS_ORIGINS=http://localhost:3000,http://localhost:3001
```

**Production** (`.env`):

```bash
CORS_ORIGINS=https://app.example.com,https://staging.example.com
```

**Never use**:

```bash
CORS_ORIGINS=*  # ← SECURITY RISK! Allows all origins
```

### How CORS Works

**Step 1: Preflight Check** (browser sends automatically):

```
OPTIONS /api/users HTTP/1.1
Origin: https://app.example.com
Access-Control-Request-Method: DELETE
```

**Step 2: Server Validates**:

```
If origin NOT in whitelist → Return 403
If origin IS in whitelist → Return 200 with headers
```

**Step 3: Actual Request**:

```
DELETE /api/users/123 HTTP/1.1
Origin: https://app.example.com
Authorization: Bearer <token>
```

### Results

✅ Requests from whitelisted origins: **Allowed**  
❌ Requests from other origins: **Blocked by browser**  
✅ Even if attacker tries: **Browser enforces CORS**

---

## Database & Transport Security

### TLS/SSL Encryption

**Development** (SQLite):

```bash
DATABASE_URL=file:./database.sqlite
# Local file, no network encryption needed
```

**Production** (Neon PostgreSQL):

```bash
DATABASE_URL=postgresql://user:password@host/db?sslmode=require
#                                                  ↑ TLS required
```

**What `sslmode=require` Does**:

- 🔒 Encrypts all database traffic with TLS
- 🔒 Prevents password transmission in plain text
- 🔒 Prevents data interception over network
- 🔒 Verifies server certificate authenticity

**For Developers**:

```typescript
// backend/src/database.ts
const connectionUrl = process.env.DATABASE_URL;

if (process.env.NODE_ENV === 'production' && !connectionUrl.includes('sslmode=require')) {
  throw new Error('Production DATABASE_URL must include sslmode=require');
}
```

### Parameterized Queries (SQL Injection Prevention)

**Vulnerable** ❌:

```typescript
const user = await db.$queryRaw(`SELECT * FROM users WHERE pin = '${userInput}'`);
// If userInput = "' OR '1'='1" → Injection!
```

**Safe** ✅:

```typescript
const user = await prisma.user.findUnique({
  where: { pin: bcryptHash(userInput) },
});
// Parameter is escaped automatically
// User input cannot break SQL structure
```

### Role-Based Access Control

Users have roles that restrict operations:

```typescript
const ROLES = {
  MANAGER: 'Manager', // Create/edit/delete users
  TEAM_MEMBER: 'Team Member', // View and update inventory
};

// Controller checks role before operation
if (req.user.role !== 'Manager') {
  return res.status(403).json({ error: 'Manager role required' });
}
```

---

## Request & Payload Security

### Request Size Limits

**Configuration**:

```typescript
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb' }));
```

**File Upload Limits**:

```bash
MAX_FILE_SIZE=10485760        # 10 MB
MAX_UPLOAD_SIZE_BYTES=10485760
DIRECT_UPLOAD_THRESHOLD_BYTES=2097152  # 2 MB for direct uploads
```

**Why Limits Matter**:

- Prevents memory exhaustion attacks
- Prevents disk space DoS
- Limits processing time for large files
- Protects against zip bombs

### Content-Type Validation

File uploads are validated against expected types:

```typescript
// Multer configuration
multer({
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['text/csv', 'application/vnd.ms-excel', '...'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ValidationError('Invalid file type'));
    }
  },
});
```

---

## Error Handling

### Principle: Generic Error Messages

**Development**:

```json
{
  "error": "Unexpected error during database operation",
  "details": "UNIQUE constraint failed: users.email",  ← Shows constraint
  "statusCode": 400
}
```

**Production**:

```json
{
  "error": "An error occurred. Please try again or contact support.",
  "statusCode": 500
}
```

### Why Generic Messages?

- ✅ Prevents information leakage
- ✅ Doesn't reveal database schema
- ✅ Doesn't expose third-party service details
- ✅ Doesn't help attackers understand infrastructure

### Error Categories

| Type                     | Handled As | Message              | Example                                           |
| ------------------------ | ---------- | -------------------- | ------------------------------------------------- |
| **Validation Error**     | 400        | Field-specific error | "field: 'email', message: 'Invalid email format'" |
| **Authentication Error** | 401        | Generic message      | "Invalid PIN"                                     |
| **Authorization Error**  | 403        | Generic message      | "Access denied"                                   |
| **Not Found**            | 404        | Generic message      | "Resource not found"                              |
| **Conflict**             | 409        | Specific message     | "User already exists"                             |
| **Server Error**         | 500        | Generic message      | "An error occurred"                               |

### Stack Traces

**Development**:

```
✅ Full stack trace in error response
✅ Helps developers debug quickly
✅ Node process logs show full details
```

**Production**:

```
❌ Stack traces removed from response
✅ Stack traces logged to Sentry (internal only)
✅ User sees generic "An error occurred" message
```

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

### JWT Validation at Edge

Cloudflare Workers validate tokens before requests reach backend:

```typescript
// workers/src/middleware/auth.ts
export async function validateJWT(request) {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 });
  }

  const token = authHeader.slice(7);

  try {
    const verified = await jose.jwtVerify(token, new TextEncoder().encode(JWT_SECRET));
    return { success: true, userId: verified.payload.sub };
  } catch (error) {
    return new Response('Invalid token', { status: 401 });
  }
}
```

### Benefits

- **Early Rejection**: Invalid tokens rejected before hitting backend
- **Reduced Backend Load**: Fewer invalid requests processed
- **Global Protection**: Validation happens at edge (Cloudflare's global network)
- **Low Latency**: Edge locations geographically close to users

### Public Endpoints (No Auth Required)

```typescript
const PUBLIC_ENDPOINTS = ['/auth/login', '/auth/register', '/health'];

if (PUBLIC_ENDPOINTS.includes(url.pathname)) {
  return next(); // Skip JWT validation
}
```

---

## NPM Supply-Chain Security

### Current Controls

The repository uses deterministic npm lockfiles for each package boundary:

- Root: `package-lock.json`
- Backend: `backend/package-lock.json`
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

Do not set global `ignore-scripts=true` for this repo without a separate migration plan. The backend currently depends on native packages such as SQLite and bcrypt that require install-time build hooks in normal development installs.

### Dependabot

Dependabot is configured for the root, backend, frontend, workers, and GitHub Actions package ecosystems. Review dependency PRs by package boundary and avoid mixing unrelated runtime and tooling updates unless the advisory requires coordinated remediation.

### Dependabot Remediation Log

**2026-06-27** — Cleared the runtime, edge, and build-tool advisories that had a clean (non-major) patched path, working per package boundary with lockfile-only updates (`--package-lock-only --ignore-scripts`) so no install scripts ran:

| Boundary | Change | Advisories cleared |
| -------- | ------ | ------------------ |
| Backend | `multer ^2.0.2 → ^2.2.0` (direct, runtime); `form-data → 4.0.6`, `@opentelemetry/*`, `@sentry/*`, `@babel/core` via audit fix; bumped existing overrides `tar 7.5.15 → 7.5.17` and `ws 8.20.1 → 8.21.0` | multer (high), form-data (high), tar, ws, OpenTelemetry/Sentry (moderate) |
| Root | `wrangler 4.94.0 → 4.105.0` (clears bundled `undici`/`ws`/`esbuild`/`miniflare`); `js-yaml → 4.3.0` via audit fix | undici (high), ws (high), esbuild (low), js-yaml (moderate) → **0 remaining** |
| Workers | `esbuild ^0.27.7 → ^0.28.1` (direct); `wrangler`/`vite`/`undici`/`ws`/`miniflare`/`vitest-pool-workers` via audit fix | undici (high), vite (high), ws (high), esbuild (low) → **0 remaining** |

After each change, `npm audit` confirmed the targeted advisories cleared and `npm run security:npm-supply-chain` confirmed the dependency-source policy still passes.

**2026-06-27** — Migrated the frontend off Create React App (`react-scripts`/CRACO) to Vite (follow-up #290). This removed the entire CRA build-tool advisory tree wholesale rather than force-patching transitive dependencies:

| Boundary | Change | Advisories cleared |
| -------- | ------ | ------------------ |
| Frontend | Replaced `react-scripts` + `@craco/craco` with `vite` + `@vitejs/plugin-react`; PWA service worker preserved via `vite-plugin-pwa` (`injectManifest`, reusing the existing `service-worker.ts`); Tailwind now processed through PostCSS at build time | `shell-quote` (**critical**), `webpack-dev-server`, `postcss`, `nth-check`, `css-select`, `svgo` and the rest of the CRA/webpack build-tool tree → **removed** |

The test runner migration is staged: this change introduces a temporary standalone Jest (decoupled from CRA) so the existing suites stay green; the `jest → vitest` port is tracked in #291. As a result the frontend now reports the same dev/test-only Jest toolchain advisories as the backend (see Accepted Dependency Risks below), which #291 resolves.

**2026-06-27** — Ported the frontend test suite from Jest to Vitest (the frontend portion of #291). This removes the standalone Jest scaffolding added during the Vite migration and its dev/test-only advisories:

| Boundary | Change | Advisories cleared |
| -------- | ------ | ------------------ |
| Frontend | Replaced `jest` / `babel-jest` / `jest-environment-jsdom` / `jest-fetch-mock` with `vitest` + `jsdom` + `vitest-fetch-mock`; 54 suites / 470 tests ported (`jest.*` → `vi.*`), aligning the frontend with the workers boundary | `@jest/*`, `babel-jest`, `babel-plugin-istanbul`, `@istanbuljs/load-nyc-config`, dev/test `js-yaml` → **removed** from the frontend |

After the port, `npm audit` in `/frontend` reports only the pre-existing `quagga` and `xlsx` accepted risks below; the Jest toolchain advisories are gone. The backend Jest 30 upgrade (the remaining part of #291) is unaffected by this change.

**2026-06-28** — Upgraded the backend test toolchain to Jest 30 (the remaining part of #291): `jest` `^29.7.0` → `^30.4.2`, `@types/jest` `^29` → `^30`, kept `ts-jest` on `^29.4.11` (the Jest-30-compatible line — ts-jest ships no v30 and its `29.4.x` declares `jest: ^29 || ^30` as a peer), and removed the unused `jest-environment-jsdom` dev dependency (both backend Jest configs run `testEnvironment: 'node'`). The full suite (152 suites / 1,667 tests) passes on Jest 30.

Contrary to the original framing of #291, the Jest 30 upgrade does **not** clear the backend's dev/test toolchain advisories. `npm audit` moves from 20 → 19 (one moderate cleared), but the remainder persist because they are now dominated by a newly-published advisory with **no upstream fix**:

| Boundary | Change | Advisory outcome |
| -------- | ------ | ---------------- |
| Backend | `jest` `29 → 30`, drop unused `jest-environment-jsdom` | Net **−1 moderate**. The residual moderate advisories trace to `js-yaml <= 4.1.1` (GHSA-h67p-54hq-rp68, quadratic-complexity DoS, no fixed release) pulled in via `@istanbuljs/load-nyc-config` → `babel-plugin-istanbul` → `@jest/transform`. Jest depends on `babel-plugin-istanbul` unconditionally (independent of our `coverageProvider: 'v8'` setting), so this chain is present at **every** Jest version. The only way to shed it is to leave Jest — the path the frontend already took with Vitest (v8 coverage, no `babel-plugin-istanbul`). |

### Accepted Dependency Risks

| Package area | Current status | Mitigation |
| ------------ | -------------- | ---------- |
| `xlsx` in backend/frontend | npm audit reports known high severity advisories and no fixed npm release. | Keep file upload limits, input validation, and CSV injection controls active. Treat XLSX replacement as follow-up work before broadening spreadsheet import features. |
| `jest` toolchain in backend | Now on **Jest 30** (latest). Residual moderate advisories trace to `js-yaml <= 4.1.1` (GHSA-h67p-54hq-rp68 DoS, no fixed release) via `@istanbuljs/load-nyc-config` → `babel-plugin-istanbul` → `@jest/transform`, which Jest depends on at every version. npm's only offered "fix" is a breaking `ts-jest@27` downgrade, which would not actually remove the chain. (The frontend is on Vitest and unaffected.) | Dev/test-only; never shipped to runtime. Do **not** accept the forced downgrade. Full elimination requires migrating the backend off Jest to Vitest (v8 coverage, no `babel-plugin-istanbul`), as the frontend did — tracked as follow-up work. |
| `quagga` in frontend | Pulls old request/form-data/qs paths through image loading dependencies (`form-data`, `request`, `tough-cookie` advisories). | Keep scanner use local/browser-only and evaluate replacement during scanner dependency remediation. |

### Developer Workflow

Before committing dependency changes:

```bash
npm run security:npm-supply-chain
npm audit --audit-level=low
npm audit --audit-level=low --prefix backend
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

```typescript
import { createValidator } from '../middleware/validateRequest';

const loginSchema = z.object({
  pin: z.string().length(4, 'PIN must be 4 digits'),
});

router.post('/login', validateRequest(loginSchema), controller.login);
```

### 3. Use Dependency Injection for Services

```typescript
// ✅ Good - Dependencies injected
export class UserService {
  constructor(
    private prisma = prismaClient,
    private emailService = emailService,
  ) {}
}

// ❌ Avoid - Hard-coded dependencies
export class UserService {
  private prisma = require('./prisma'); // ← Hard to test
}
```

### 4. Sanitize CSV Exports

```typescript
import { sanitizeCsvValue } from '../utils/csv-sanitizer';

const rows = data.map((item) => ({
  name: sanitizeCsvValue(item.name), // ← Always sanitize
}));
```

### 5. Use Custom Error Classes

```typescript
// ✅ Good - Specific error
throw new AuthenticationError('Invalid PIN');

// ❌ Avoid - Generic Error
throw new Error('Invalid PIN');
```

### 6. Apply Rate Limiting to Sensitive Endpoints

```typescript
const loginLimiter = createRateLimiter('strict'); // 5/15min

router.post('/auth/login', loginLimiter, controller.login);
```

### 7. Check Authorization

```typescript
// ✅ Good - Check role
if (req.user.role !== 'Manager') {
  return res.status(403).json({ error: 'Manager role required' });
}

// ❌ Bad - No check
const updatedUser = await userService.update(req.body);
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

- `npm audit --audit-level=low` in the root, backend, frontend, and workers packages
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
- [Express.js Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)
- [Node.js Security Checklist](https://blog.risingstack.com/node-js-security-checklist/)
- [NPM Security Best Practices](https://github.com/lirantal/npm-security-best-practices)
- [git-secrets Documentation](https://github.com/awslabs/git-secrets)
- [CORS by MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8949)

---

## Questions or Issues?

- 📚 See [backend/README.md](../backend/README.md) for developer setup
- 🔒 See [backend/SECURITY.md](../backend/SECURITY.md) for internal security notes
- 🐛 Report bugs via [security reporting](#security-reporting)
- 💬 Ask in team Slack or project discussions
