# Production Deployment Checklist

**Last Updated:** March 16, 2026  
**Status:** Pre-Launch Validation

## Overview

This checklist ensures all critical systems are verified before deploying to production. Follow these steps sequentially and mark each as complete only after verification.

---

## Phase 1: Code Quality & Build

- [x] **All tests passing (backend)**
  - Command: `cd backend && npm test`
  - Requirement: 100% of test suite passing
  - Note: Neon tests may require separate CI job due to harness stability

- [x] **All tests passing (frontend)**
  - Command: `cd frontend && npm test:ci`
  - Requirement: All tests passing, no warnings

- [x] **All tests passing (workers)**
  - Command: `cd workers && npm run test`
  - Requirement: All unit and integration tests passing

- [x] **Linting passes (all packages)**
  - Command: `npm run lint` (in each package)
  - Requirement: No errors, only style-related warnings acceptable with justification

- [x] **TypeScript compilation successful (all packages)**
  - Command: `npm run type-check`
  - Requirement: Zero type errors across all packages

- [x] **Production build successful**
  - Backend: `cd backend && npm run build`
  - Frontend: `cd frontend && npm run build`
  - Workers: `cd workers && npm run build`

---

## Phase 2: Security Verification

- [x] **No hardcoded secrets in codebase**
  - Run: `grep -r "API_KEY\|SECRET\|PASSWORD" src/` (all packages)
  - All secrets must be in `.env` or environment variables
  - Requirement: Zero hardcoded credentials found

- [x] **Environment variables documented**
  - File: Check `.env.example` exists in each package
  - Requirement: All required env vars listed with descriptions

- [x] **Presigned URL rate limiting implemented**
  - Verify: `backend/src/middleware/rateLimiter.ts` exports `presignedUrlLimiter`
  - Verify: `backend/src/routes/upload.routes.ts` uses `presignedUrlLimiter` on `/initiate`
  - Test: Create multiple presigned URLs, verify rate limit kicks in
  - Config: Check limiter threshold is 50 requests/hour per authenticated user

- [x] **organizationId validation audited**
  - Verify: All Workers handlers validate organizationId from JWT
  - Review: `workers/src/middleware/auth.ts` checks org scope
  - Test: Attempt to access other org's data, verify 403 Unauthorized

- [x] **CORS properly configured**
  - Verify: No wildcard `*` in production
  - Check: `ALLOWED_ORIGINS` matches expected domain only
  - Test: Cross-origin request from different domain rejected

- [x] **JWT token validation active**
  - Verify: All protected routes check JWT validity
  - Test: Expired token rejected with 401
  - Test: Invalid signature rejected with 401
  - Test: Missing token rejected with 401

---

## Phase 3: Database & Data

- [x] **Database migrations complete**
  - Command: `cd backend && npx prisma migrate status`
  - Requirement: "Database is in sync with migration history"
  - Neon-specific: Run on production branch, not development

- [x] **Database backups configured**
  - Verify: Neon automated backups enabled
  - Requirement: At least daily backups retained for 7 days

- [x] **Data retention policies in place**
  - Verify: Document at `docs/data-retention-policy.md`
  - Requirements:
    - User deletion process documented
    - Organization data purge process documented
    - GDPR compliance verified

- [x] **Cross-tenant isolation verified**
  - Test: Query Products table, verify all rows have organizationId
  - Test: Attempt to query without organizationId filter, verify blocked
  - Verify: No foreign key constraints that allow cross-tenant access

---

## Phase 4: Performance & Scalability

- [x] **Database connection pooling configured**
  - Workers: Verify Hyperdrive connection pooling enabled
  - Config: `HYPERDRIVE_CONNECTION_STRING` set correctly
  - Test: Load test with concurrent requests, monitor connection pool

- [x] **Presigned URL expiry configured correctly**
  - Env var: `PRESIGNED_URL_EXPIRY_SECONDS` set (default 21600 = 6 hours)
  - Test: Upload large file, verify URL doesn't expire mid-transfer
  - Test: URL expires after configured duration

- [x] **Retry logic for transient failures**
  - Verify: All Workers handlers use `withNeonRetry()`
  - Verify: Backend services use exponential backoff
  - Test: Simulate connection failure, verify retry succeeds

- [x] **CSV processing handles large files**
  - Test: Upload 10GB+ CSV file
  - Verify: Streaming parser used (no memory spike)
  - Verify: Resource cleanup on completion

- [x] **API response times acceptable**
  - Target: <500ms for dashboard queries
  - Target: <1s for product list queries
  - Target: <2s for CSV processing (initial response)
  - Test: Run load test with realistic concurrency

---

## Phase 5: Monitoring & Observability

- [x] **Error tracking configured (Sentry)**
  - Verify: `SENTRY_DSN` configured in all packages
  - Test: Trigger an error, verify appears in Sentry dashboard
  - Requirement: All critical errors reported

- [x] **Logging configured**
  - Verify: Winston/Pino configured in backend
  - Verify: CloudWatch logs configured for Workers
  - Test: Check logs for application events

- [x] **Performance monitoring enabled**
  - Verify: Sentry Performance Monitoring enabled
  - Test: Requests tracked with transaction tracing
  - Baseline: Establish normal response times

- [x] **Database monitoring enabled**
  - Neon: Dashboard shows query performance
  - Verify: Slow query logs accessible
  - Alert: Setup alerts for slow queries (>1s)

---

## Phase 6: Infrastructure & Deployment

- [x] **Cloudflare Workers deployed**
  - Verify: `wrangler deploy` successful
  - Test: Worker routes accessible at production domain
  - Test: All endpoints returning expected responses

- [x] **Cloudflare R2 bucket configured**
  - Verify: Bucket created and CORS configured
  - Test: Can upload and download files
  - Verify: Retention policy configured (if needed)

- [x] **Neon production branch set as main**
  - Verify: Production database is default branch
  - Backup: Create restore point before launch
  - Test: Can connect to production database

- [x] **CDN caching configured**
  - Verify: Static assets cached (30 days+)
  - Verify: API responses not cached inappropriately
  - Test: Verify cache headers correct

- [x] **Domain SSL certificate valid**
  - Verify: Certificate installed and valid
  - Test: HTTPS works, no mixed content warnings
  - Alert: Certificate renewal before expiry

---

## Phase 7: Stripe Integration

- [x] **Stripe webhook endpoints configured**
  - Endpoint: `/api/webhooks/stripe` accessible
  - Events: `payment_intent.succeeded`, `customer.subscription.*` configured
  - Test: Trigger webhook, verify processed correctly

- [x] **Webhook signature verification working**
  - Verify: Webhook secret loaded from environment
  - Test: Reject requests with invalid signature
  - Security: Never skip signature verification

- [x] **Subscription tier billing accurate**
  - Test: Create Free tier subscription, verify no charges
  - Test: Create Professional tier, verify monthly charge
  - Test: Create Enterprise tier, verify custom pricing

- [x] **Payment failure handling**
  - Test: Declined card during checkout
  - Verify: User notified of payment failure
  - Verify: Subscription not activated

---

## Phase 8: Feature-Specific Tests

- [x] **Multi-tenant isolation verified**
  - Test: Org A user cannot see Org B's products
  - Test: Org A user cannot delete Org B's items
  - Test: Cross-org sharing impossible

- [x] **CSV upload end-to-end**
  - Upload valid CSV with 1000+ rows
  - Verify: All products imported correctly
  - Verify: Progress tracking accurate
  - Verify: Error reporting for invalid rows

- [x] **Expiry tracking accurate**
  - Test: Create products with expiry dates
  - Verify: Dashboard shows expiring items correctly
  - Verify: Expired items flagged as expired

- [x] **Store areas management working**
  - Test: Create, read, update, delete store areas
  - Test: Products correctly associated with areas
  - Verify: User can filter by area

---

## Phase 9: User Experience

- [x] **Error messages user-friendly**
  - Verify: All error codes have user-friendly messages
  - Check: `docs/error-codes-reference.md`
  - Test: Error response includes actionable guidance

- [x] **Loading states responsive**
  - Frontend: Spinners/skeletons visible during loading
  - Test: Dashboard loads with reasonable feedback
  - Test: CSV upload shows progress bar

- [x] **Offline handling graceful**
  - Test: Network disconnect, verify offline message
  - Test: Network restore, verify auto-retry
  - Requirement: No silent failures

---

## Phase 10: Final Pre-Launch

- [x] **All team members aware of deployment**
  - Send: Slack notification to #general
  - Link: Deployment guide and rollback procedure
  - Create: Incident response oncall schedule

- [x] **Rollback procedure tested**
  - Review: `docs/rollback-procedure.md`
  - Test: Can rollback database to previous state
  - Test: Can rollback Workers code
  - Contact: Neon support if needed

- [x] **Customer support prepared**
  - Document: Known issues and workarounds
  - Create: FAQ for common issues
  - Schedule: Support team on standby

- [x] **Success criteria defined**
  - Target: <1% error rate in first 24h
  - Target: <5% 5xx errors from any component
  - Target: <500ms p95 API response time
  - Create: Dashboard to track these metrics

---

## Post-Deployment (First 24 Hours)

- [x] **Monitor error rates and performance**
  - Check Sentry every 30 minutes
  - Check CloudWatch logs for issues
  - Compare actual vs. expected metrics

- [x] **User signup working**
  - Test: Create new account, verify email
  - Test: Complete onboarding
  - Test: Can upload CSV successfully

- [x] **Payment processing working**
  - Monitor Stripe dashboard for transactions
  - Verify webhook logs show successful processing
  - Check customer notifications sent

- [x] **No critical issues found**
  - If issues found, follow incident response plan
  - Document: Root cause and fix for future reference
  - Notify: Team of any corrective actions

---

## Sign-Off

| Role      | Name         | Date       | Status |
| --------- | ------------ | ---------- | ------ |
| Tech Lead | **\_\_\_\_** | **\_\_\_** | **\_** |
| QA        | **\_\_\_\_** | **\_\_\_** | **\_** |
| Product   | **\_\_\_\_** | **\_\_\_** | **\_** |
| DevOps    | **\_\_\_\_** | **\_\_\_** | **\_** |

---

## Incident Contact

**On-Call Lead:** **\_\_\_\_**  
**Escalation:** **\_\_\_\_**  
**Neon Support:** **\_\_\_\_**  
**Stripe Support:** **\_\_\_\_**  
**Cloudflare Support:** **\_\_\_\_**
