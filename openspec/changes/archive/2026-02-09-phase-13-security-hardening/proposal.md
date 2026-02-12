# Phase 13: Security Hardening

## Why

The application currently handles sensitive user data (product inventory, storage metrics, file uploads) but lacks comprehensive security hardening across input validation, data protection, and API security layers. As we approach production deployment with Cloudflare Workers and Neon database, we must implement industry-standard security measures to protect user data, prevent common vulnerabilities (CSV injection, XSS, rate-limit bypass, secrets exposure), and ensure TLS-encrypted communication. This phase establishes the security foundation required for production readiness.

## What Changes

### Input & Data Security
- [ ] Implement CSV injection sanitization in the CSV parser to prevent malicious formula injection
- [ ] Add comprehensive input validation for all API endpoints (type checking, length limits, format validation)
- [ ] Implement request size limits (10MB max) to prevent resource exhaustion attacks
- [ ] Verify no secrets are committed to codebase using automated scanning

### API Security
- [ ] Configure CORS to whitelist production domain only (prevent unauthorized cross-origin requests)
- [ ] Configure rate limiting on upload/sensitive endpoints to prevent brute force and DoS attacks
- [ ] Implement JWT token validation in Workers to verify request authenticity at the edge

### Data Protection
- [ ] Enable TLS-only connections to Neon with sslmode=require verification
- [ ] Run security audit with `npm audit` to identify and patch known vulnerabilities

### Error Handling & Service Refactoring (Tech Debt)
- [ ] Implement global error handler with custom error types for consistent error responses
- [ ] Refactor AnalyticsService and ReportService to use Prisma ORM
- [ ] Create AnalyticsRepository and ReportRepository for data access layer separation
- [ ] Apply service-level TypeScript type fixes for strict type safety
- [ ] Improve AuthService test coverage to >80%

### Documentation
- [ ] Create comprehensive `docs/security.md` documenting all security measures and best practices

## Capabilities

### New Capabilities
- `csv-injection-prevention`: Sanitize CSV cell values to prevent formula injection attacks (e.g., =, +, -, @)
- `api-input-validation`: Comprehensive input validation middleware for all endpoints with type checking, length limits, and format validation
- `rate-limiting`: Rate limit configuration on sensitive endpoints to prevent brute force, DoS, and abuse
- `database-ssl-configuration`: Enforce TLS-only connections to Neon database with verified SSL mode
- `secrets-scanning`: Automated detection and prevention of secrets in codebase (API keys, tokens, credentials)
- `cors-security`: CORS configuration restricted to production domain to prevent unauthorized cross-origin requests
- `request-size-limits`: Enforce maximum request payload size (10MB) to prevent resource exhaustion
- `jwt-validation-edge`: JWT token validation in Cloudflare Workers at the edge for request authenticity
- `security-audit-compliance`: Regularly run `npm audit` to identify and patch known vulnerabilities in dependencies

### Modified Capabilities
- `error-handling`: Implement consistent, global error handling with custom error types across all services and layers
- `authentication-service`: Improve AuthService test coverage and robustness to >80% coverage threshold

## Impact

**Code Changes:**
- Backend: New middleware (validation, rate-limiting), updated services (Analytics, Report, Auth), error handling layer
- Frontend: Input validation on client-side forms, enhanced error display
- Workers: JWT validation logic, request inspection for security headers
- Configuration: Environment variables for CORS, rate limits, TLS settings

**Dependencies:**
- May add: `joi` or `zod` for schema validation, `express-rate-limit` for rate limiting, `npm-audit` tooling
- Verify: Neon PostgreSQL connection options for SSL configuration

**Breaking Changes:** None expected. These are additive security measures.

**Timeline:** Phase 13 tasks are independent and can be parallelized. Estimated 2-3 days for complete implementation and validation.

**Success Criteria:**
- All 16 tasks completed and marked `[x]` in tasks.md
- Security audit (`npm audit --audit-level=moderate`) passes with no vulnerabilities
- No secrets detected in codebase
- Services refactored to use Prisma with dependency injection
- Test coverage for AuthService >80%
- Documentation in `docs/security.md` complete and comprehensive
