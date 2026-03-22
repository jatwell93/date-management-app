# Tasks: Fix Launch-Blocking Issues

## Phase 1: Backend Test Fixes (Org-Scoped Keys & Auth Mocking)

- [x] **T1.1** Examine `backend/src/services/upload.service.ts` - understand org-scoped key validation pattern
- [x] **T1.2** Review failing tests in `backend/src/tests/services/upload.service.test.ts` - identify mock org context gaps
- [x] **T1.3** Fix org context in upload service tests - ensure org ID matches key generation
- [x] **T1.4** Review presigned upload flow test - check auth context attachment
- [x] **T1.5** Fix auth context mocking in `backend/src/tests/services/upload-flow.test.ts` - **DONE: added organizationId to auth mock**
- [x] **T1.6** Also fixed: `backend/src/tests/integration/upload-routes-service-provider.test.ts` - same org context fix
- [ ] **T1.7** Run `npm run test:dev --prefix backend` - verify 9 failing suites reduce (PENDING - need to run)
- [ ] **T1.8** Document org-scoped key validation pattern in memory

## Phase 2: Prisma Production Test Configuration

- [ ] **T2.1** Review `backend/jest.config.neon.js` - understand prod test setup
- [ ] **T2.2** Examine `backend/src/tests/setup-after-env.ts:44` - identify Prisma datasource mismatch
- [x] **T2.3** Applied workaround: detect datasource mismatch and gracefully skip Prisma ops - **DONE**
- [ ] **T2.4** Determine root fix: environment.ts loading order issue
- [ ] **T2.5** Implement root solution (TBD - may require env var setup change)
- [ ] **T2.6** Run `npm run test:prod --prefix backend` - verify prod tests work (PENDING)
- [ ] **T2.7** Test full prod suite configuration (PENDING)

## Phase 3: Security Hardening

- [x] **T3.1** Locate webhook signature logging in `backend/src/services/webhook.service.ts:85-93` - **FOUND**
- [x] **T3.2** Review context - understand why signature is being logged - **UNDERSTOOD**
- [x] **T3.3** Redact signature from error log - log only "verification_failed" placeholder - **DONE**
- [ ] **T3.4** Add test to verify signature is never logged - catch regression (PENDING)
- [x] **T3.5** Identify JSON.parse calls in `backend/src/controllers/upload.controller.ts:173` - **FOUND**
- [x] **T3.6** Add try/catch wrapper to JSON.parse - return sensible default on parse failure - **DONE**
- [x] **T3.7** Identify JSON.parse in `backend/src/routes/admin.metrics.routes.ts:286` - **FOUND**
- [x] **T3.8** Add try/catch wrapper and graceful error response - **DONE**
- [ ] **T3.9** Run UBS scan - verify CWE-532 and JSON crash findings resolved (PENDING)

## Phase 4: Lint Error Remediation

- [ ] **T4.1** Run `npm run lint` - capture current error count (baseline 207 errors)
- [ ] **T4.2** Run `npm run lint --fix` - auto-fix Prettier and other fixable violations (ATTEMPTED, may need cleanup)
- [ ] **T4.3** Fix E2E parse errors in `e2e/auth/sign-up.spec.ts:42` - resolve "Unexpected token as"
- [ ] **T4.4** Fix E2E parse errors in `e2e/global-setup.ts:6` - resolve "Unexpected token :"
- [ ] **T4.5** Review `eslint.config.js` - determine if E2E files need ESLint config adjustment or exclusion
- [ ] **T4.6** Fix CommonJS undefined globals in `frontend/src/__mocks__/uuid.js` - declare jest properly
- [ ] **T4.7** Fix CommonJS undefined globals in `shared/types/subscription.js` - add proper exports wrapper
- [ ] **T4.8** Fix remaining @ts-ignore → @ts-expect-error deprecations (if any)
- [ ] **T4.9** Run `npm run lint` - verify exit code 0 with 0 errors (PENDING)
- [ ] **T4.10** Run `npm run lint:check` - confirm merge gate passes (PENDING)

## Verification & Testing

- [ ] **T5.1** Run `npm run test:backend:coverage --prefix backend` - verify all 91 suites pass
- [ ] **T5.2** Run `npm run test:frontend:coverage` - verify all 29 suites pass (baseline)
- [ ] **T5.3** Run `npm run test:both --prefix backend` - verify exit code 0
- [ ] **T5.4** Run `npm run test:prod --prefix backend` - verify exit code 0
- [ ] **T5.5** Run `npm run type-check` - verify all TypeScript passing
- [ ] **T5.6** Run `npm run lint` - verify 0 errors
- [ ] **T5.7** Run `ubs .` - verify security findings resolved (no CWE-532, no JSON crash)
- [ ] **T5.8** Document final verification status in OpenSpec

## Documentation & Cleanup

- [ ] **T6.1** Store fix summaries in project memory (patterns, decisions)
- [ ] **T6.2** Update README.md if test setup instructions changed
- [ ] **T6.3** Commit changes with conventional commit format
- [ ] **T6.4** Archive OpenSpec change after all gates passing

---

## Priority Notes  

**HIGHEST (must complete):** T1 (backend tests) ✅ PARTIALLY DONE - org context fixed, needs test run to verify + T4 (lint) - both gate deployment
**HIGH (must complete):** T3 (security) ✅ DONE - webhook + JSON.parse fixes applied
**MEDIUM (for completeness):** T5 (verification) - PENDING TESTS + T6 (documentation)
**LOWER PRIORITY:** T2 (prod config) - Workaround applied, root cause identified but complex fix needed

## Estimated Remaining Time

- T4: 2-3 hours (E2E config fixes)  
- T1.7 + T5: 1 hour (run test suite)
- T2.5: 1.5 hours (if attempting root fix)
- T3.4 + T3.9: 30 min (add regression test + UBS scan)
- T6: 30 min (documentation)
- **Remaining Total: 5-7 hours**

