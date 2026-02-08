# Phase 13: Security Hardening - Technical Design

## Context

**Current State:**
- Backend built on Express/TypeScript with Prisma ORM
- Workers deployed on Cloudflare, handling edge requests
- Database: Neon PostgreSQL (serverless)
- Frontend: React with TailwindCSS (Create React App)
- CSV upload functionality exists but lacks injection protection
- Error handling scattered across controllers and services
- Services (Analytics, Report) using raw queries instead of Prisma
- Input validation minimal; no centralized validation middleware
- No rate limiting on sensitive endpoints
- No secrets scanning in CI/CD pipeline

**Constraints:**
- Must maintain backward compatibility (no breaking changes)
- Production deployment in progress; security must not delay rollout
- Existing test suite must remain passing
- Services use dependency injection pattern (already established)
- All database queries must go through Prisma or repository layer

**Stakeholders:**
- Backend team (services, database layer, middleware)
- Workers team (edge validation, JWT verification)
- DevOps (CI/CD integration for secrets scanning, audit)

## Goals / Non-Goals

**Goals:**
- Eliminate CSV injection vulnerabilities (sanitize formulas in cells)
- Centralize input validation with reusable middleware and schema validation
- Prevent unauthorized access via rate limiting on sensitive endpoints
- Enforce TLS-only database connections with verified SSL mode
- Detect and prevent committed secrets using automated scanning
- Restrict cross-origin requests to production domain via CORS
- Prevent resource exhaustion with request size limits
- Validate JWT tokens at Cloudflare Workers edge layer
- Comply with industry security standards (`npm audit` passing)
- Implement consistent, typed error handling with custom error classes
- Refactor AnalyticsService and ReportService to use Prisma with dependency injection
- Achieve >80% test coverage for AuthService
- Document all security measures in `docs/security.md`

**Non-Goals:**
- OAuth/social login implementation (future phase)
- End-to-end encryption for data at rest (data lives in managed database)
- Advanced intrusion detection systems or WAF rules (use Cloudflare's managed tools)
- Database audit logging beyond PostgreSQL's native capabilities
- Hardware security token integration
- Penetration testing or formal security audit (external consulting)

## Decisions

### 1. CSV Injection Prevention Strategy
**Decision:** Sanitize cell values during CSV parsing to strip/escape dangerous formula prefixes.

**Implementation:**
- Modify CSV parser in `src/services/uploadService.ts` to detect and escape leading `=`, `+`, `-`, `@` characters
- Replace with escaped version (e.g., `'=SUM(...)` becomes `\=SUM(...)`)
- Apply at parse time, not at storage (safer, consistent across all consumers)
- Add unit tests to verify sanitization

**Alternatives Considered:**
- Database trigger approach: Could be harder to maintain; parsing approach is simpler
- Library like `papaparse` with custom hooks: Would add dependency; current parser is lightweight
- Content-type checking: Not sufficient alone; sanitization is more robust

**Rationale:** Sanitization at parse time prevents injection from ever entering the database, protecting all downstream consumers.

---

### 2. Input Validation Middleware & Schema Validation
**Decision:** Use `zod` for schema validation; create reusable middleware layer.

**Implementation:**
- Install `zod` as peer dependency (lightweight, TypeScript-native)
- Create `src/middleware/validateRequest.ts` middleware that validates `req.body`, `req.params`, `req.query` against schemas
- Define schemas in `src/schemas/` directory (e.g., `uploadSchema.ts`, `userSchema.ts`)
- Attach middleware to routes: `router.post('/upload', validateRequest(uploadSchema), controller.upload)`
- Return 400 with error details on validation failure
- Standardize error response format: `{ errors: [{ field: "email", message: "Invalid format" }] }`

**Alternatives Considered:**
- `joi`: More feature-rich but heavier; `zod` matches TypeScript first-class
- Manual validation in controllers: Repetitive, error-prone
- Custom validation decorators: Over-engineered for current scope

**Rationale:** Centralized validation middleware ensures consistency, reduces boilerplate, and fails fast before business logic execution.

---

### 3. Rate Limiting Strategy
**Decision:** Use `express-rate-limit` package; apply to upload and authentication endpoints.

**Implementation:**
- Install `express-rate-limit`
- Create `src/middleware/rateLimiter.ts` with presets:
  - **Standard**: 100 requests per 15 minutes per IP (most endpoints)
  - **Strict**: 5 requests per 15 minutes per IP (login, password reset)
  - **Upload**: 10 requests per hour per IP (CSV uploads, file handling)
- Store rate-limit state in memory for development; ready for Redis store in production
- Return 429 with `Retry-After` header on limit breach
- Apply to: `POST /api/users/login`, `POST /api/upload`, `POST /api/register`

**Alternatives Considered:**
- Redis-based rate limiting: Added complexity; in-memory sufficient for MVP
- Per-user vs per-IP: Per-IP is simpler, prevents anonymous abuse
- Custom rate limiter: Reinventing the wheel; use battle-tested package

**Rationale:** Rate limiting prevents brute-force attacks and DoS. `express-rate-limit` is lightweight, standard, and flexible for future Redis migration.

---

### 4. TLS-Only Database Connections
**Decision:** Verify `sslmode=require` in Neon connection string; log verification on startup.

**Implementation:**
- Ensure `DATABASE_URL` includes `sslmode=require` parameter
- Add startup validation in `src/database.ts` (Prisma client init)
- Log warning if `sslmode` is missing or loose (development-only warning)
- Document in `docs/security.md` and `.env.example`
- No code changes needed to Prisma—just connection string configuration

**Alternatives Considered:**
- Custom SSL certificate pinning: Overkill for managed Neon service
- Prisma-level SSL enforcement: Prisma respects connection string; no additional code needed

**Rationale:** Neon is HTTPS-first but must explicitly require SSL. Connection string configuration is simplest, requires no code changes.

---

### 5. Secrets Scanning Strategy
**Decision:** Implement `git-secrets` pre-commit hook + GitHub Actions workflow.

**Implementation:**
- Install `git-secrets` locally (already in scripts or CI setup)
- Configure patterns to detect common secrets (AWS keys, API tokens, JWT patterns)
- Add GitHub Actions workflow: `.github/workflows/secrets-scan.yml` that runs on every push
- Fail pipeline if secrets detected
- Document in README: "Run `npm run secrets-scan` before commit"
- Use `.gitignore` and `.env.example` to prevent accidental commits

**Alternatives Considered:**
- TruffleHog: More sophisticated; `git-secrets` simpler and sufficient
- Pre-commit hook only: Not enough; need CI enforcement too
- Manual code review: Unreliable; automation is necessary

**Rationale:** Multi-layer approach (pre-commit + CI) catches secrets before they reach main branch and public repo.

---

### 6. CORS Configuration Strategy
**Decision:** Restrict CORS to production domain; use environment-based configuration.

**Implementation:**
- Modify `src/middleware/cors.ts` to use whitelist from environment variables
- Development: Allow `localhost:3000`, `localhost:3001`
- Staging/Production: Allow only the production frontend domain (e.g., `app.example.com`)
- Configuration in `.env.example` and `src/config/index.ts`
- Fail-safe: CORS disabled by default; must explicitly whitelist origins

**Alternatives Considered:**
- Allow all origins: Security risk; defeats purpose
- CORS wildcard for staging: Acceptable for non-prod; document clearly

**Rationale:** Prevents unauthorized scripts from making requests on behalf of users. Environment-based config allows safe staging/prod separation.

---

### 7. Request Size Limits
**Decision:** Configure Express middleware to limit payload to 10MB; apply globally with exceptions.

**Implementation:**
- Add to Express app init: `app.use(express.json({ limit: '10mb' }))`
- Add to file upload middleware: `multer({ limits: { fileSize: 10 * 1024 * 1024 } })`
- Document in API responses: "Maximum payload 10MB"
- Set appropriately for CSV uploads (current largest expected file ~5MB)

**Alternatives Considered:**
- Per-endpoint limits: More granular but complex; global + endpoint overrides is cleaner
- No limit (rely on reverse proxy): Risk if proxy fails; defense in depth

**Rationale:** Prevents memory exhaustion and disk space attacks. 10MB is large enough for typical CSVs, safe from resource exhaustion.

---

### 8. JWT Validation at Cloudflare Workers Edge
**Decision:** Validate JWT token signature in Workers before forwarding to backend.

**Implementation:**
- Add JWT validation middleware in `workers/src/middleware/auth.ts`
- Use `jose` library (lightweight, JWT-focused) for signature verification
- Extract JWT from `Authorization: Bearer <token>` header
- Verify signature using public key from Neon Auth or environment variable
- Return 401 if token invalid or missing
- Pass validated claims to backend in `x-user-id` header
- Skip validation for public endpoints (login, register, healthcheck)

**Alternatives Considered:**
- Backend-only validation: Adds latency; edge validation is faster
- No edge validation: Wastes bandwidth forwarding invalid requests

**Rationale:** Edge validation reduces latency and backend load. Early rejection of invalid tokens saves resources.

---

### 9. Error Handling Architecture
**Decision:** Implement global error handler with typed custom error classes.

**Implementation:**
- Create `src/errors/` directory with error classes:
  - `ValidationError` (400) - input validation failures
  - `AuthenticationError` (401) - missing/invalid JWT
  - `AuthorizationError` (403) - insufficient permissions
  - `NotFoundError` (404) - resource not found
  - `ConflictError` (409) - duplicate resource
  - `InternalError` (500) - unexpected server error
- Create `src/middleware/errorHandler.ts` middleware:
  - Catches all thrown errors
  - Logs error with context (user, endpoint, etc.)
  - Returns standardized JSON response: `{ code: "ERROR_CODE", message: "...", statusCode: 400 }`
  - Masks internal details in production
- Update all services to throw custom errors instead of generic `Error`
- Add try-catch in controller with error handler middleware

**Alternatives Considered:**
- Generic error responses: No loss of functionality but harder to debug
- Status code only: Lacks semantic information for clients

**Rationale:** Typed errors enable better client handling, easier debugging, consistency across services.

---

### 10. Service Refactoring (Analytics, Report, Auth)
**Decision:** Migrate AnalyticsService and ReportService to Prisma ORM with dependency injection.

**Implementation:**
- Refactor `src/services/analyticsService.ts` to use Prisma client (passed via DI)
- Create `src/repositories/analyticsRepository.ts` for data access layer
- Refactor `src/services/reportService.ts` similarly
- Create `src/repositories/reportRepository.ts`
- Update type annotations to match Prisma-generated types
- Update tests to mock repository instead of database
- Improve AuthService test coverage by adding tests for edge cases (token expiry, invalid tokens, permissions)

**Alternatives Considered:**
- Keep raw queries: Existing pattern; but Prisma is already standard in project
- Full service rewrite: Unnecessary; incremental refactor sufficient

**Rationale:** Consistency with project patterns (Prisma + DI), type safety, easier testing.

---

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| **Rate limiting blocks legitimate users** | Start with generous limits; monitor and adjust. Use `Retry-After` header for transparency. |
| **CSV sanitization breaks valid data** | Unit tests verify behavior; sanitization only strips dangerous prefixes, preserves data semantics. |
| **CORS whitelist misconfiguration blocks staging** | Document clearly; use environment variables; test in CI before production deployment. |
| **Secrets scanning has false positives** | Configure patterns carefully; document exclusions in `.gitignore` and comments. |
| **Service refactoring introduces bugs** | Comprehensive test coverage (>80%); run full suite before merge. |
| **JWT validation latency at edge** | Use caching strategy in Workers; Jose library is optimized. Profile in staging. |
| **Error handler masks useful debugging info** | Log full stack trace to backend logger (Sentry); expose only safe info to client. |

## Migration Plan

### Phase 1: Infrastructure (Day 1)
1. **Install dependencies**: `npm install zod express-rate-limit jose git-secrets`
2. **Configure error handling**: Create error classes and error handler middleware
3. **Add validation middleware**: Create `validateRequest` middleware and attach to routes
4. **Configure rate limiting**: Create rate limiter middleware and apply to sensitive endpoints
5. **Verify TLS**: Check DATABASE_URL includes `sslmode=require`; add startup check
6. **Configure CORS**: Update CORS middleware with environment-based whitelist

### Phase 2: Security Hardening (Day 2)
7. **CSV injection prevention**: Sanitize parser; add unit tests
8. **Request size limits**: Configure Express middleware
9. **Secrets scanning**: Set up `git-secrets` pre-commit hook and GitHub Actions workflow
10. **JWT validation in Workers**: Add edge-layer JWT verification

### Phase 3: Service Refactoring & Testing (Day 2-3)
11. **Refactor services**: Migrate Analytics, Report services to Prisma + DI
12. **Create repositories**: AnalyticsRepository, ReportRepository
13. **Improve test coverage**: Enhance AuthService tests to >80%
14. **Fix type issues**: Apply TypeScript strict types across refactored services

### Phase 4: Documentation & Validation (Day 3)
15. **Run security audit**: `npm audit --audit-level=moderate` and fix vulnerabilities
16. **Create security docs**: Write `docs/security.md` with all measures documented
17. **Integration testing**: Run full test suite; verify no regressions
18. **Deployment**: Deploy to staging; validate all security measures; then production

### Rollback Strategy
- All changes are additive; revert specific commits if issues arise
- Rate limiter can be adjusted via environment variables without redeployment
- Error handler is transparent to clients; can be tuned
- CSV sanitization is backward-compatible
- Services refactored incrementally; partial rollback possible if needed

## Open Questions

1. **Rate limit persistence**: Should we implement Redis store now or defer to Phase 14?
   - *Current plan: In-memory for MVP; document Redis migration path*
2. **JWT validation in Workers**: Should we cache validation results or verify every request?
   - *Pending: Benchmark latency; likely cache with TTL (5 minutes)*
3. **Secrets scanning patterns**: What custom patterns should we add beyond defaults?
   - *Pending: Audit codebase for internal API key patterns*
4. **Error response format**: Should we include validation error details (field names)?
   - *Current plan: Yes; helps clients fix input; mask internal details in production*
5. **AuthService refactoring**: Should we use class-based or functional approach?
   - *Current plan: Functional (consistent with existing services)*
