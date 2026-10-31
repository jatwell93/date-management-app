# Code Review: Trial Store Production Security

**Date**: 2026-03-17
**Ready for Production**: No (requires remediation of Priority 1 issues)
**Critical Issues**: 4

## Scope and Review Plan

This review focused on the backend/frontend paths most relevant for first-store production risk:

1. Access control and auth/session lifecycle
2. Transport and crypto hardening
3. API/input/file-upload abuse resistance
4. Observability/incident readiness and compliance evidence
5. Supply-chain and configuration hardening

## Priority 1 (Must Fix) - Blockers

1. Database backup and restore endpoints are not manager-restricted
   - Evidence: `authenticateToken` is required but no `requireManager` on backup/restore/list routes.
   - References: `backend/src/routes/database.backup.routes.ts:15`, `backend/src/routes/database.backup.routes.ts:23`
   - Risk: Any authenticated user can create or restore backups. This is high-impact integrity/availability risk and can become tenant-wide destructive misuse.
   - Why AI checks often miss it: Many AI checks stop at "endpoint is authenticated" and do not model role-sensitive operations.
   - Remediation:
     - Add `requireManager` to all database backup routes.
     - Consider separate "platform admin" role for restore.
     - Add audit entries for each backup/restore invocation with actor and org.

2. Production HTTPS can silently downgrade to HTTP on certificate/read failure
   - Evidence: In production + `USE_HTTPS`, startup falls back to HTTP on error.
   - References: `backend/src/index.ts:341`, `backend/src/index.ts:366`
   - Risk: Confidentiality and session/token exposure in transit if TLS bootstrap fails.
   - Why AI checks often miss it: Pattern-based tools see "HTTPS supported" and fail to reason about fallback branches under fault conditions.
   - Remediation:
     - In production, fail hard if HTTPS cert/key cannot load.
     - Enforce TLS termination at edge/load balancer and restrict backend to private network.
     - Add deployment health gate that rejects non-TLS production startup.

3. Public operational/diagnostic endpoints disclose internals
   - Evidence: Public endpoints expose process/memory/cpu/db diagnostic details and error strings.
   - References: `backend/src/routes/health.routes.ts:158`, `backend/src/routes/health.routes.ts:183`, `backend/src/routes/health.routes.ts:202`, `backend/src/routes/health.routes.ts:99`
   - Risk: Information disclosure assisting recon/exploitation and targeted DoS.
   - Why AI checks often miss it: Automated checks frequently classify health routes as benign without evaluating sensitivity of payload.
   - Remediation:
     - Keep `/health` and `/ready` minimal/public.
     - Move `/metrics`, `/database-metrics`, `/database-health`, `/recent-alerts` behind auth + manager role + network allowlist.
     - Remove raw internal error messages from public responses.

4. Session/token storage in browser localStorage increases XSS blast radius
   - Evidence: Session token read/written in localStorage paths.
   - References: `frontend/src/components/ClerkAuthProvider.tsx:100`, `frontend/src/lib/offline-sync.ts:375`
   - Risk: Any XSS can exfiltrate bearer token and impersonate users.
   - Why AI checks often miss it: AI static checks may validate JWT usage but not model browser storage threat boundaries.
   - Remediation:
     - Move to httpOnly, Secure, SameSite cookies for session transport.
     - Implement short-lived access tokens and server-managed refresh rotation.
     - Add CSP hardening and script injection testing.

## Priority 2 (High)

1. Upload completion path trusts client-provided upload key without org binding check at completion entry
   - Evidence: `complete` accepts key and calls `completeUpload` directly; service checks existence/download but no upfront org-prefix assertion.
   - References: `backend/src/controllers/upload.controller.ts:85`, `backend/src/controllers/upload.controller.ts:92`, `backend/src/services/upload.service.ts:96`, `backend/src/services/upload.service.ts:99`
   - Risk: If key is leaked/guessable, cross-tenant processing abuse is possible.
   - Why AI checks often miss it: Tools detect key format validation and infer safety, missing object ownership verification.
   - Remediation:
     - Enforce key starts with `uploads/{req.organizationId}/` before processing.
     - Require upload ownership lookup by org + key in DB before download/parse.

2. Rate limiting uses in-memory store, weak for multi-instance/distributed deployment
   - Evidence: default memory store is used.
   - References: `backend/src/middleware/rateLimiter.ts:50`
   - Risk: Attackers can bypass per-instance limits across replicas.
   - Why AI checks often miss it: Presence of any limiter can be incorrectly treated as complete mitigation.
   - Remediation:
     - Use Redis-backed or edge-native distributed rate limiting.
     - Apply specialized limits to webhook endpoints as well.

3. CORS allows requests with no Origin and includes credentials support
   - Evidence: no-origin requests are allowed; credentials enabled.
   - References: `backend/src/middleware/cors.ts:49`, `backend/src/middleware/cors.ts:66`
   - Risk: Not a direct browser bypass, but weakens trust assumptions and increases unexpected cross-context access surface.
   - Why AI checks often miss it: Automated checks focus on wildcard origins and may ignore nuanced no-origin handling.
   - Remediation:
     - In production, deny no-origin except explicit machine clients with API keys.
     - Keep strict origin allowlist and avoid credentialed cross-origin unless required.

4. Clerk auth error details returned to clients
   - Evidence: detailed token verification errors are returned in API response.
   - References: `backend/src/middleware/clerk-auth.middleware.ts:130`
   - Risk: Authentication probing and implementation disclosure.
   - Why AI checks often miss it: "useful debugging messages" often pass generic static checks.
   - Remediation:
     - Return generic auth failure message to client.
     - Keep detailed reason in internal logs only.

## Priority 3 (Medium)

1. Environment defaults and doc drift create security ambiguity
   - Evidence: `DEFAULT_PIN` fallback still present while docs describe PIN+refresh-token flow not reflected in active routes.
   - References: `backend/src/config/environment.ts:176`, `backend/src/routes/auth.routes.ts:9`, `docs/security.md:33`, `docs/security.md:50`, `docs/security.md:205`
   - Risk: Misconfiguration and false security assumptions during incident/debug.
   - Why AI checks often miss it: Many checks inspect code or docs separately, not their consistency.
   - Remediation:
     - Remove obsolete auth config defaults.
     - Align docs to active Clerk session model.
     - Add architecture decision record for canonical auth flow.

2. Presigned R2 uploads are not bound to explicit content constraints in signature policy
   - Evidence: presigned upload uses `PutObjectCommand` without content-length/content-type conditions.
   - References: `backend/src/storage/r2-storage.provider.ts:189`, `backend/src/storage/r2-storage.provider.ts:194`
   - Risk: Abuse with unexpected content types or object misuse.
   - Why AI checks often miss it: Presence of signed URLs is treated as complete control.
   - Remediation:
     - Add signed constraints and server-side revalidation of metadata.
     - Enforce MIME/extension checks and malware scanning for uploaded files.

3. Incident plan has placeholder contacts
   - Evidence: on-call/escalation identities are placeholders.
   - References: `docs/incident-response-plan.md:65`, `docs/incident-response-plan.md:765`
   - Risk: Delayed response during first production incident.
   - Why AI checks often miss it: Code-only checks ignore operational readiness artifacts.
   - Remediation:
     - Replace placeholders with real owners/phones/escalation chain.
     - Run and record a live pager drill before trial launch.

## Threat Model Snapshot (Trial Store)

### High-value assets

- Tenant data (products, inventory, reports)
- Billing/subscription state
- Upload pipeline and R2 objects
- Backup/restore capabilities
- Auth tokens and webhook secrets

### Top attack paths

1. Compromised browser script steals localStorage bearer token
2. Privilege misuse of backup/restore by non-manager authenticated user
3. Recon via public metrics/diagnostic endpoints followed by targeted abuse
4. Distributed brute-force/abuse bypassing memory-based limits
5. Upload key misuse across tenants if key is leaked

## Compliance Readiness (GDPR/SOC 2)

### GDPR

- Strengths:
  - Retention and incident docs exist.
- Gaps:
  - Code search found no implemented GDPR deletion workflow entities referenced in policy text.
  - Token/session data handling currently localStorage-based in frontend.
- References: `docs/data-retention-policy.md:1`, `frontend/src/components/ClerkAuthProvider.tsx:100`
- Actions:
  - Implement and evidence DSAR deletion/export workflows.
  - Add data processing inventory and lawful basis mapping.

### SOC 2 (Security/Availability/Confidentiality)

- Strengths:
  - Logging, Sentry instrumentation, and runbooks are present.
- Gaps:
  - Least-privilege gap on destructive routes.
  - Transport downgrade path in production startup.
  - Public diagnostics increase confidentiality risk.
- Actions:
  - Enforce role-based controls for admin operations.
  - Add immutable audit trail for privileged operations.
  - Add control evidence collection in CI/CD (policy-as-code checks).

## Blind Spots Commonly Missed by AI-Based Checks

1. Business-logic authorization (auth present but wrong role)
   - Seen here: backup/restore endpoints.
2. Fault-path security regressions
   - Seen here: HTTPS fallback to HTTP under startup error.
3. Ops-to-code drift
   - Seen here: security docs claim flows not currently active in routes/frontend.
4. Cross-layer session risks
   - Seen here: secure backend auth logic with insecure browser storage.
5. Real deployment topology effects
   - Seen here: in-memory rate limiting that degrades under horizontal scale.

## Continuous Security Assurance for Trial Store Rollout

1. Pre-launch hard gate (must pass before enabling first trial tenant)
   - Block deploy if any Priority 1 findings remain open.
   - Add CI checks for route-level RBAC on sensitive endpoints.
2. Automated scanning pipeline
   - SAST: Semgrep/CodeQL on PR.
   - SCA: Dependabot + npm audit + Snyk/OSV scans.
   - Secrets: gitleaks/trufflehog.
   - IaC/config lint for Worker/backend env policies.
3. Dynamic testing
   - DAST with OWASP ZAP against staging.
   - AuthZ tests: IDOR/BOLA route fuzzing with multi-tenant fixtures.
   - Upload abuse tests: oversized, polyglot, content-type mismatch, malware scan path.
4. Operational security drills
   - Pager/on-call drill and webhook failure game day.
   - Backup restore drill with role separation.
5. Evidence and governance
   - Maintain control evidence folder per release (test logs, scan reports, approvals).
   - Map controls to SOC 2 criteria and GDPR obligations quarterly.

## Recommended Immediate Next Actions (7-day window)

1. Add `requireManager` to backup routes and test role enforcement.
2. Remove HTTP fallback in production and add startup fail-fast.
3. Restrict diagnostics endpoints to authenticated admin/internal network only.
4. Move token handling away from localStorage for production sessions.
5. Add org-bound validation in upload completion path.

## Remediation Status Update (2026-03-17)

### Completed

- Backup and restore routes are now manager-restricted.
- Production HTTPS startup now fails hard instead of downgrading to HTTP.
- Public diagnostics were reduced and privileged health/metrics endpoints now require authenticated manager access.
- Upload completion now enforces organization-scoped keys before storage access.
- Clerk auth failures no longer return verification details to clients.
- Browser-persistent bearer token storage was removed from the active frontend auth flow. Clerk tokens now remain in memory and offline sync receives the current token through an injected provider instead of `localStorage`.
- Production CORS now blocks requests with no `Origin` header by default unless explicitly enabled via `ALLOW_NO_ORIGIN_IN_PRODUCTION=true`.

### Residual Risk / Follow-up

- Frontend session transport still uses bearer tokens accessible to application JavaScript at runtime. This is materially better than persistent browser storage, but it is not equivalent to `httpOnly` cookie isolation. Full cookie-based session transport remains a larger architectural change.
- Distributed rate limiting remains open. The app currently lacks a shared rate-limit store such as Redis or equivalent edge-backed coordination, so multi-instance enforcement still depends on infrastructure that is not yet wired into this backend.
