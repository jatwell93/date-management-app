# Phase 13: Security Hardening - Implementation Tasks

## 1. Setup & Dependencies

- [x] 1.1 Install security packages: `npm install zod express-rate-limit jose git-secrets`
- [x] 1.2 Install dev dependencies for testing: `npm install --save-dev jose-testing-library` (if needed)
- [x] 1.3 Create `.env.example` with new security environment variables (CORS_ORIGINS, RATE_LIMIT_WINDOW, etc.)
- [x] 1.4 Create `src/errors/` directory structure for custom error classes

## 2. Error Handling Architecture

- [x] 2.1 Create custom error classes in `src/errors/index.ts`: ValidationError, AuthenticationError, AuthorizationError, NotFoundError, ConflictError, InternalError
- [x] 2.2 Implement error handler middleware in `src/middleware/errorHandler.ts` with logging and standardized response format
- [x] 2.3 Update Express app in `src/index.ts` to register error handler as last middleware
- [x] 2.4 Update `src/config/index.ts` to include error handling configuration
- [x] 2.5 Test error handler with manual requests (verify 400, 401, 403, 404, 409, 500 responses)

## 3. Input Validation & CSV Injection Prevention

- [x] 3.1 Create validation schemas in `src/schemas/`: uploadSchema, userSchema, loginSchema, etc. using Zod
- [x] 3.2 Create `src/middleware/validateRequest.ts` middleware that validates body, params, and query
- [x] 3.3 Attach validation middleware to routes: `POST /upload`, `POST /users`, `POST /login`, etc.
- [x] 3.4 Add CSV injection sanitization to `src/services/uploadService.ts` to escape leading `=`, `+`, `-`, `@` characters
- [x] 3.5 Add unit tests for CSV sanitization in `src/services/__tests__/uploadService.test.ts`
- [x] 3.6 Test edge cases: empty cells, cells with safe formulas (no leading =), multiple injection attempts
- [x] 3.7 Update error responses to include validation field details: `{ errors: [{ field: "email", message: "..." }] }`

## 4. Rate Limiting & CORS Security

- [x] 4.1 Create rate limiter middleware in `src/middleware/rateLimiter.ts` with presets (standard, strict, upload)
- [x] 4.2 Apply strict rate limit (5/15min) to `POST /api/users/login` and `POST /api/users/register`
- [x] 4.3 Apply upload rate limit (10/hour) to `POST /api/upload`
- [x] 4.4 Apply standard rate limit (100/15min) to other endpoints via router-level middleware
- [x] 4.5 Update CORS middleware in `src/middleware/cors.ts` to use environment-based whitelist
- [x] 4.6 Configure development CORS for localhost:3000, localhost:3001
- [x] 4.7 Add CORS environment variables to `.env.example` and documentation
- [x] 4.8 Test rate limiting and CORS with curl/Postman (verify 429 and CORS headers)

## 5. Database & Request Security

- [x] 5.1 Verify `DATABASE_URL` includes `sslmode=require` parameter
- [x] 5.2 Add TLS verification check in `src/database.ts` (log success or warning on startup)
- [x] 5.3 Configure Express to limit request payload: `app.use(express.json({ limit: '10mb' }))`
- [x] 5.4 Configure multer for file uploads with size limit: `multer({ limits: { fileSize: 10 * 1024 * 1024 } })`

## 6. Secrets Scanning & Prevention

- [x] 6.1 Install and configure `git-secrets` locally with standard patterns (AWS keys, JWT, API tokens)
- [x] 6.2 Create `.git-secrets-config` or update `.gitignore-secrets` with project-specific patterns (if needed)
- [x] 6.3 Create GitHub Actions workflow `.github/workflows/secrets-scan.yml` that runs `git-secrets` on push
- [x] 6.4 Add pre-commit hook script in `scripts/pre-commit-secrets.sh` to run `git-secrets` before commit
- [x] 6.5 Document secrets scanning in `README.md`: "Run `npm run secrets-scan` before committing"
- [x] 6.6 Test secrets scanning: attempt to commit a test secret, verify hook blocks it

## 7. Workers Edge Security (JWT Validation)

- [ ] 7.1 Create JWT middleware in `workers/src/middleware/auth.ts` using `jose` library
- [ ] 7.2 Extract JWT from `Authorization: Bearer <token>` header in Workers middleware
- [ ] 7.3 Verify JWT signature using public key (from Neon Auth or environment)
- [ ] 7.4 Return 401 if token is missing, invalid, or expired
- [ ] 7.5 Pass validated user ID to backend in `x-user-id` header
- [ ] 7.6 Define public endpoints that skip JWT validation (login, register, health)
- [ ] 7.7 Test JWT validation in Workers with valid, invalid, and expired tokens

## 8. Service Refactoring (Prisma + Dependency Injection)

- [ ] 8.1 Refactor `src/services/analyticsService.ts` to accept Prisma client via constructor (DI)
- [ ] 8.2 Create `src/repositories/analyticsRepository.ts` with data access methods for analytics queries
- [ ] 8.3 Update `src/services/analyticsService.ts` to use repository instead of raw queries
- [ ] 8.4 Refactor `src/services/reportService.ts` similarly (DI + Prisma)
- [ ] 8.5 Create `src/repositories/reportRepository.ts` with data access methods
- [ ] 8.6 Apply TypeScript strict type annotations to refactored services
- [ ] 8.7 Update controllers to inject services with dependencies
- [ ] 8.8 Update tests to mock repositories instead of database

## 9. Authentication Service Enhancement & Testing

- [ ] 9.1 Review `src/services/authService.ts` for missing edge case tests
- [ ] 9.2 Add test for duplicate email registration: verify ConflictError is thrown
- [ ] 9.3 Add test for incorrect password login: verify AuthenticationError is thrown
- [ ] 9.4 Add test for expired token validation: verify AuthenticationError is thrown
- [ ] 9.5 Add test for tampered token signature: verify signature verification fails
- [ ] 9.6 Add test for refresh token functionality: verify new token is issued
- [ ] 9.7 Add test for authorization checks: verify permission verification works
- [ ] 9.8 Run coverage for AuthService: `npm test -- --coverage src/services/authService.ts`
- [ ] 9.9 Verify coverage exceeds 80% threshold

## 10. Security Audit & Compliance

- [ ] 10.1 Run `npm audit` to identify vulnerable dependencies: `npm audit --audit-level=moderate`
- [ ] 10.2 Update vulnerable dependencies to patched versions
- [ ] 10.3 Re-run `npm audit` to verify all moderate/critical vulns are fixed
- [ ] 10.4 Create GitHub Actions workflow `.github/workflows/audit.yml` to run `npm audit` on push
- [ ] 10.5 Document any exceptions in `SECURITY.md` with justification (if applicable)

## 11. Documentation

- [ ] 11.1 Create `docs/security.md` with sections: Overview, CSV Injection Prevention, Input Validation, Rate Limiting, TLS Configuration, Secrets Scanning, CORS, Request Limits, JWT Validation, Error Handling, Audit Compliance
- [ ] 11.2 Document each security measure: why it exists, how it works, examples, configuration
- [ ] 11.3 Add security best practices guide in `docs/security.md`
- [ ] 11.4 Update `README.md` to reference `docs/security.md`
- [ ] 11.5 Document environment variables in `.env.example` with security settings
- [ ] 11.6 Create `SECURITY.md` at repo root with vulnerability reporting guidelines and security contact

## 12. Integration & Testing

- [ ] 12.1 Run full test suite: `npm test` - verify all tests pass
- [ ] 12.2 Run linter: `npm run lint` - fix any violations
- [ ] 12.3 Run UBS (Ultimate Bug Scanner): `ubs $(git diff --name-only)` - verify no critical issues
- [ ] 12.4 Run TypeScript compiler: `npm run build` or `tsc --noEmit` - verify no type errors
- [ ] 12.5 Test error handling end-to-end: verify custom errors and global handler work
- [ ] 12.6 Test input validation end-to-end: verify invalid requests are rejected with 400
- [ ] 12.7 Test rate limiting end-to-end: verify 429 responses and Retry-After header
- [ ] 12.8 Test CORS end-to-end: verify whitelisted domains allowed, others blocked
- [ ] 12.9 Test JWT validation in Workers: verify tokens validated at edge

## 13. Final Validation

- [ ] 13.1 Verify `DATABASE_URL` has `sslmode=require` in development and production
- [ ] 13.2 Confirm all services use Prisma and dependency injection pattern
- [ ] 13.3 Verify AuthService test coverage is >80%
- [ ] 13.4 Confirm `docs/security.md` is comprehensive and up-to-date
- [ ] 13.5 Verify all 13 task groups completed (13 x checkbox markers)

---

## Notes

- Tasks can be parallelized where dependencies allow (e.g., error handling can proceed in parallel with input validation setup)
- Each task should have a corresponding test to verify completion
- Use git feature branches for implementation, e.g., `feature/phase-13-security-hardening`
- Commit incrementally after each major task group with conventional commits, e.g., `feat(security): implement error handling`
