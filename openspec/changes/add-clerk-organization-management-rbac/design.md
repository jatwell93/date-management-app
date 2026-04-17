## Context

Organization management currently spans Clerk membership data, backend Prisma models, and Workers auth handlers, but role semantics are inconsistent (`admin/member`, `Manager/Team Member`, and free-form role strings). The selected proposal defines a unified RBAC model with first-login admin bootstrap, invite role assignment, security controls, and upload authorization constraints.

**Clerk plan constraint (V1):** Production Clerk plan only supports two org roles: `admin` and `team_member` (member). The `manager` role is available in dev but not in production until plan upgrade. All specs treat `manager` as optional/future.

Current implementation baseline:

- Backend auth gates rely on `requireManager` and allow legacy role values (`Manager`, `admin`) rather than canonical org roles.
- Invite creation and acceptance currently operate on `admin/member` invite roles and map them to `Manager/Team Member` user roles.
- Workers user synchronization maps Clerk membership roles but does not enforce org role checks for upload endpoints.
- Prisma stores roles as `String` on `User` and `OrganizationInvite`, so existing data can contain mixed values.

Stakeholders:

- Pharmacy owners and managers administering users and uploads.
- Team members with restricted, read-only operational access.
- Engineering and support teams maintaining auth, onboarding, and incident response.

Constraints:

- Keep tenant isolation strict (`organizationId` always server-derived).
- Use strict canonical role persistence internally, with boundary mapping only for external role inputs.
- Keep backend and Workers authorization behavior functionally equivalent.
- Avoid broad rewrites of existing auth and upload systems.

## Goals / Non-Goals

**Goals:**

- Establish one canonical org role model across frontend, backend, and Workers.
- Implement deterministic first-login bootstrap that assigns `admin` to the initial org user.
- Implement secure invite lifecycle with explicit role assignment at acceptance.
- Enforce role-based permissions for org administration and upload flows.
- Add auditable, rate-limited security controls around invite and membership operations.

**Non-Goals:**

- Replacing Clerk as the identity provider.
- Re-architecting subscription tier logic.
- Rewriting CSV processing internals beyond role-gating entry points.
- Full permission-policy engine (ABAC or custom DSL) in this change.

## Decisions

### 1) Enum-first canonical role model with thin ingress mapping

- Decision: Migrate `User.role` and `OrganizationInvite.role` to strict canonical enum values (`admin`, `manager` (optional), `team_member`) and use those values throughout internal logic. Keep only a thin mapping layer at external ingestion boundaries (for example Clerk membership role strings) before persistence. Note: production Clerk plan only has `admin` and `team_member`; `manager` is dev-only until plan upgrade.
- Rationale: There are no production users to preserve, so this is the lowest-complexity path with the strongest long-term consistency and least authorization drift.
- Alternatives considered:
  - Canonical mapping at application boundaries while keeping string roles in persistence: avoids schema migration now, but retains long-term drift and validation complexity.
  - Keep legacy mixed roles indefinitely: lowest effort, but continues authorization drift.

### 2) First-login admin bootstrap is deterministic and idempotent

- Decision: During first authenticated onboarding for an organization, assign `admin` only when no active admin exists for that org; otherwise map from Clerk/invite role.
- Rationale: Prevents accidental multiple-admin bootstrap while keeping onboarding retry-safe.
- Alternatives considered:
  - Always assign first seen login as admin: simple but race-prone and vulnerable to ordering issues.
  - Manual admin assignment only: safer control, but poor onboarding UX and higher support burden.

### 3) Invite lifecycle uses one-time expiring tokens with identity checks

- Decision: Keep token-based invites but require one-time acceptance, expiration enforcement, and email match against verified Clerk identity at acceptance.
- Rationale: Protects against token replay and cross-account acceptance while preserving current invite UX.
- Alternatives considered:
  - Open invite links without email match: lower friction, higher account takeover risk.
  - Passwordless invite-only auth path: stronger isolation but higher implementation complexity in this phase.

### 4) Authorization guard is centralized and shared by route intent

- Decision: Introduce a role-guard contract (`requireOrgRole`) and apply it consistently to backend org-management and upload endpoints using only canonical enum roles.
- Rationale: Consolidates permission logic and reduces per-route drift.
- Alternatives considered:
  - Keep route-local if/else checks: fast to patch, but regression-prone.
  - Build full policy service now: flexible but beyond scope for this phase.

### 5) Workers authorization parity with backend

- Decision: Extend Workers role mapping and upload handlers to enforce the same canonical role permissions (`admin`, or `manager` if enabled, for uploads).
- Rationale: Avoids split-brain authorization where edge and origin disagree.
- Alternatives considered:
  - Backend-only enforcement: simpler but inconsistent behavior depending on entry path.

### 6) Auditing and abuse controls are mandatory for invite/admin actions

- Decision: Record org role/invite state changes in audit logs and apply rate limiting to invite creation and acceptance endpoints.
- Rationale: Supports incident response, abuse detection, and compliance expectations.
- Alternatives considered:
  - Logging only errors: insufficient forensic coverage.
  - No invite-specific limits: higher abuse and spam risk.

### 7) Rate limiting via Cloudflare WAF Rules (primary) with optional backend defense-in-depth

- Decision: Implement rate limiting at Cloudflare edge using WAF Rate Limiting Rules for IP-based limits, with optional backend validation using in-memory middleware for authenticated-user tracking.
- Rationale: Cloudflare-native rate limiting requires zero external infrastructure (no Redis), operates globally at edge, integrates with existing Workers deployment, and scales automatically.
- **Specification:**
  - **Layer 1 (Edge - Required):** Cloudflare WAF rules via zone-level API/Dashboard
    - POST /api/organization/invites: 10 requests per 60 seconds per IP → 5 min block
    - POST /api/organization/invites/{id}/accept: 5 requests per 60 seconds per IP → 5 min block
    - POST /api/organization/members/{id}/role: 20 requests per 3600 seconds per IP → 1 hour block
  - **Layer 2 (Backend - Optional):** In-memory rate limit middleware on backend routes
    - Counts per authenticated userId (catches distributed attacks using multiple IPs)
    - No external storage required; in-process cache with TTL
    - Provides audit trail and more granular control
  - **Layer 3 (Workers - Future):** Durable Objects if per-organization limits needed for upload abuse
- Alternatives considered:
  - Redis backend: adds infrastructure dependency and operational burden; Cloudflare approach preferred
  - In-memory only on Workers: doesn't persist across edge locations; insufficient for distributed attacks
  - Durable Objects only: higher cost; WAF rules free and sufficient for baseline protection

## Risks / Trade-offs

- [Risk] Legacy test fixtures or seeded rows may fail enum constraints after migration. -> Mitigation: run one-time backfill script before enabling strict validation, then update fixtures and seed scripts in the same release.
- [Risk] Parallel onboarding requests could create admin-assignment race conditions. -> Mitigation: transactional admin assignment with uniqueness checks and retry-safe logic.
- [Risk] Backend and Workers may diverge again after initial rollout. -> Mitigation: shared role vocabulary constants and contract tests for protected routes.
- [Risk] Invite acceptance friction increases due to stricter identity checks. -> Mitigation: clear user-facing error messaging and resend/revoke flows.
- [Risk] Role naming mismatch (`team_member` vs `viewer`) can cause product confusion. -> Mitigation: settle canonical naming before specs finalize and keep UI label mapping explicit.

## Migration Plan

1. Finalize canonical role labels and add Prisma enum-backed role fields for `User` and `OrganizationInvite`.
2. Run an idempotent one-time backfill converting legacy role strings (`admin`, `member`, `Manager`, `Team Member`) to canonical enum values.
3. Add strict validation that rejects unknown roles after external-boundary mapping.
4. Implement backend auth guard updates and replace legacy role checks on org-management and upload routes.
5. Update invite service/routes to issue canonical roles and accept only normalized external inputs.
6. Update Workers role mapping and upload authorization checks for parity with backend.
7. **Deploy Cloudflare WAF rate limiting rules** via Cloudflare API (3 rules for invite/accept/role endpoints).
8. (Optional) Add in-memory backend rate limit middleware for authenticated-user tracking and audit trail.
9. Update frontend onboarding and user-management surfaces to present canonical roles and first-admin flow.
10. Enable audit events and endpoint rate limits; validate with integration and role-matrix tests.

Rollback strategy:

- Keep pre-migration snapshots/branch state so enum migration can be reverted cleanly if needed.
- If issues occur, temporarily relax only ingress normalization rules while preserving canonical enum persistence.
- Roll back route-level strict checks only as an emergency path, while preserving audit logging and invite expiration protections.
- WAF rate limiting rules can be disabled/deleted from Cloudflare dashboard without code changes if needed.

## Resolved Questions (Locked Decisions)

- **Rate Limiting Strategy (Resolved):** Use Cloudflare WAF Rate Limiting Rules as primary edge-level protection (Layer 1), with optional in-memory backend middleware (Layer 2) for defense-in-depth. See RATE-LIMITING-RESEARCH.md for full analysis.

- **Role Naming: "team_member" (Locked, Updated)** Lowest privilege role is `team_member` (underscore, not dash). Rationale: Matches Clerk's `org:team_member` role string in production; clear semantics in domain context (pharmacy team members), consistent across all artifacts. UI labels can map to product-friendly names if needed.

- **Invite Token Hashing: Bcrypt with cost 12 (Locked)** Tokens SHALL be stored hashed (not plaintext) using bcrypt with cost factor 12. On token generation: create 32-byte random, hash it, store hash, return random to user. On acceptance: hash incoming token, compare against stored hash. Timing-safe comparison required. Rationale: Prevents token theft via database compromise; aligns with security best practices.

- **Multiple Admins Per Organization (Locked, Updated)** Organizations SHALL support multiple admins (not single admin). Rationale: Enterprise continuity (prevents single point of failure); first-login bootstrap assigns first user as admin; subsequent admins can be added by existing admins. Permission check: admin cannot remove themselves if they are the last active admin.

- **Error Responses: Generic 403 Forbidden (Locked)** Upload/role-management authorization denials SHALL return HTTP 403 Forbidden without role details. Rationale: Security best practice (prevents role enumeration); clear denial message without system internals.

- **Invite Resend Semantics (Locked)** Resend SHALL issue a new token (not reuse old). On resend: generate new token, hash, update invite with new hash, send new email. Rationale: Prevents token exhaustion; allows replay-attack prevention; cleaner state management. Cannot resend ACCEPTED/REVOKED/EXPIRED invites (validation requirement).

- **Bootstrap Flow Semantics (Locked, Updated)** First-login bootstrap occurs AFTER successful Clerk authentication and within onboarding flow. Exact sequence: (1) User authenticates with Clerk → (2) Backend verifies organization context from Clerk org ID → (3) Check if org exists: if no, create org with clerkOrganizationId; if yes, proceed → (4) Check if active admin exists: if no, assign admin to current user (transactional); if yes, map from Clerk membership role → (5) Return membership and org context to frontend. Bootstrap is idempotent (retry-safe) using transactional uniqueness constraints.

- **Workers Role Authorization Architecture (Locked, Updated)** Workers receives role via Bearer token (JWT from frontend). Workers validates token signature and extracts canonical role claim. Authorization: (1) Parse Bearer token from Authorization header → (2) Verify signature using Clerk public key (cached in Workers) → (3) Extract `org_role` claim (value: admin/team_member, optional manager) → (4) Compare against required role for endpoint (uploads require admin, or manager if enabled) → (5) Return 401 for invalid token, 403 for insufficient role. Caching: Token is valid for 5 minutes (standard JWT exp claim); no additional KV caching needed.

- **Audit Logging Requirements (Locked)** AuditLog table SHALL track: event_type (invite_created, invite_accepted, invite_revoked, invite_resent, role_assigned, role_removed), actor_user_id, actor_organization_id, target_user_id, target_organization_id, old_role, new_role (if applicable), invite_id (if applicable), timestamp, ip_address. Sensitive fields (raw tokens) MUST be excluded. Query/export endpoint: admin GET /api/organization/{id}/audit-logs with timestamp/event filtering.

- **Invite Email Notification (Locked)** Email sent synchronously on invite creation (not async queue). Template: "You've been invited to {org_name} by {inviter_name}. Click [link] to join as {role}. Link expires in 7 days." Email includes: organization name, inviter name, proposed role, clickable accept link (frontend URL with invite token), expiration date, rejection/report link (optional). Resend uses same template with updated timestamp; can be sent unlimited times until accepted/expired/revoked.
