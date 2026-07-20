# Proposal: Fix Launch-Blocking Issues

## Why

**Current State:** Pre-launch verification uncovered three blocking categories preventing deployment:

1. **9/91 backend test suites failing** (dev environment) due to org-scoped key mismatches and auth context mocking issues
2. **207 ESLint errors** preventing merge gate from passing (E2E parse errors, undefined globals, formatting)
3. **1 critical + 1 medium security findings** from UBS scan (webhook signature logging, unhandled JSON.parse)

These issues were discovered in comprehensive pre-launch verification and must be resolved before production deployment.

**Opportunity:** Systematically remediate each category with targeted fixes, verified by test suite and linter gates.

**Why Now:** Pre-launch safety check identified these blockers; fixing now ensures production-ready codebase and prevents runtime failures.

## What Changes

We will implement:

- **Backend Test Fixes:** Resolve org-scoped key mismatches in upload service tests and auth context mocking in presigned flow tests
- **Prisma Production Test Config:** Fix datasource mismatch between jest.config.neon.js and prisma/schema.prisma
- **Lint Error Remediation:** Resolve E2E parse errors, CommonJS undefined globals, and Prettier formatting violations
- **Security Hardening:** Remove webhook signature from error logs (CWE-532) and wrap JSON.parse calls in try/catch (crash prevention)
- **Coverage Validation:** Verify backend 59% and frontend 40% coverage with test suite fixes

**Outcome:** All verification gates passing:

- Backend: 91/91 test suites passing (both dev and prod)
- Frontend: 29/29 suites passing (maintained)
- Lint: 0 errors (warnings acceptable)
- TypeScript: All passing (maintained)
- Security: CWE-532 and JSON crash vectors mitigated

## Capabilities

### New Capabilities

None (all fixes are within existing architectures)

### Modified Capabilities

- `backend-test-suite`: Fix org-scoped key validation in upload tests
- `presigned-upload-flow`: Fix auth context mock attachment to requests
- `jest-configuration`: Separate or adapt test setup for SQLite vs PostgreSQL
- `webhook-service`: Remove sensitive data from error logs
- `json-parsing`: Add error handling for data layer JSON unmarshaling
- `linter-configuration`: Fix E2E parse errors and undefined globals

## Impact

**Files with Changes:**

- `backend/src/services/upload.service.ts` - Add org context validation fixes
- `backend/src/tests/services/upload.service.test.ts` - Fix test mocking patterns
- `backend/src/tests/setup-after-env.ts` - Prisma config adaptation
- `backend/src/services/webhook.service.ts` - Remove signature from logs
- `backend/src/controllers/upload.controller.ts` - Add JSON.parse error handling
- `backend/src/routes/admin.metrics.routes.ts` - Add JSON.parse error handling
- `eslint.config.js` - Fix E2E file parsing or exclude logic
- `frontend/src/__mocks__/uuid.js` - Define jest globals
- `shared/types/subscription.js` - Fix CommonJS exports

**Test Coverage:**

- Backend coverage remains 59% (fix test suite completeness)
- Frontend coverage remains 40%
- No new coverage requirements, focus on test suite passing

**Risk Level:** Low (targeted fixes within existing patterns, no architectural changes)

## Prior Art / Implementation References

- Org-scoped key validation pattern exists in `backend/src/middleware/organization.middleware.ts`
- JSON.parse error handling used in `backend/src/routes/subscription.routes.ts` (example pattern)
- Webhook logging patterns reviewed from `backend/src/services/stripe.service.ts`

## Timeline

**Phase 1 (2 hours):** Backend test fixes (org keys + auth mocking)
**Phase 2 (1.5 hours):** Prisma prod test configuration
**Phase 3 (2 hours):** Security hardening (webhook + JSON.parse)
**Phase 4 (2 hours):** Lint error resolution (E2E + globals + formatting)
**Verification (30 min):** Run full test suite + lint + type-check

**Total Estimate:** 7.5 hours

## Success Criteria

- ✅ `npm run test:backend:coverage` exits with code 0 (all suites passing)
- ✅ `npm run test:frontend:coverage` exits with code 0 (maintained)
- ✅ `npm run test:prod --prefix backend` exits with code 0 (prod config working)
- ✅ `npm run lint` exits with code 0 (207 errors → 0 errors)
- ✅ `npm run type-check` exits with code 0 (maintained)
- ✅ UBS scan shows 0 CWE-532 and 0 JSON crash findings
- ✅ All verification gates in APPROVAL state ready for production deployment
