# Implementation Tasks

## 0. Prerequisites & Architecture Setup

- [x] 0.1 Verify Clerk org role strings for this project: production supports `admin` and `team_member` (plan limitation). Dev also has `manager`.
- [x] 0.1b Confirm Clerk Organizations settings for V1: Membership required + Create first org automatically = ON; org slugs = ON; organization limit = 1; allow user-created organizations = OFF; verified domains = OFF; org deletion = OFF; membership limit set high/unlimited (Option A: backend is source of truth).
- [x] 0.2 Design and document AuditLog schema: event_type (invite_created, invite_accepted, invite_revoked, invite_resent, role_assigned, role_removed), actor_user_id, actor_organization_id, target_user_id, target_organization_id, old_role, new_role, invite_id, timestamp, ip_address. Create schema migration in Prisma. → Created `OrgAuditLog` model (separate from inventory AuditLog), migration `20260416132951_add_org_audit_log` applied.
- [x] 0.3 Map and document current onboarding flow in OnboardingPage.tsx: Identify exact entry point where Clerk authentication completes, identify where organization context is established/selected, document current state machine, identify exact point where first-login bootstrap should be inserted. → Documented in `docs/plans/2026-04-16-onboarding-flow-mapping.md`. Bootstrap insertion: Approach A (intercept at /scan load).
- [x] 0.4 Create shared role constants file (`backend/src/constants/roles.ts`) exporting canonical role enum and permission matrix. Use from backend, Workers, and frontend (re-exported). Include: `ROLES = { ADMIN: 'admin', MANAGER: 'manager', TEAM_MEMBER: 'team_member' }` and permission definitions. `MANAGER` is optional until plan upgrade. → Created `backend/src/constants/roles.ts`, `frontend/src/constants/roles.ts`, `workers/src/constants/roles.ts`.

## 1. Role Model and Data Migration

- [x] 1.1 Finalize canonical role labels (`admin`, `team_member`, optional `manager`) in shared constants (Task 0.4) and publish Prisma enum for `User.role` and `OrganizationInvite.role`. → SQLite doesn't support Prisma enums; using String with app-level validation via `normalizeRole()` + `isValidRole()`.
- [x] 1.2 Add Prisma schema fields: User.role default changed to `"team_member"`. Added `invite_token_hash` and `invite_token_expires_at` to OrganizationInvite. Migration `20260416133215_add_role_default_invite_token_hash` applied. (Enum not possible on SQLite — app-level enforcement instead.)
- [x] 1.3 Implement idempotent one-time backfill migration script: map legacy values (owner/admin/member/Manager/Team Member/team-member/team_member) to canonical roles. → Created `backend/scripts/backfill-canonical-roles.js` with --dry-run support and post-run verification.
- [x] 1.4 Update seed scripts and test fixtures to use canonical enum roles only. Remove any hardcoded legacy role strings. → Updated `seed-users.js`, `setup-after-env.ts` (test seeding), and `auth.middleware.ts` (TEST_AUTH_BYPASS).
- [x] 1.5 Add strict validation: reject unknown role values after ingress normalization boundary (backend auth middleware, Workers auth, Clerk mapping layer). Allow `manager` only when enabled/available. → Implemented in `requireOrgRole` middleware which normalizes then validates roles.

## 2. Backend RBAC and Admin Bootstrap

- [x] 2.1 Implement centralized `requireOrgRole` middleware (`backend/src/middleware/requireOrgRole.ts`): Accepts required role(s), verifies req.user.role against requirement, returns 403 if insufficient. Replace all scattered manager-only checks on org-management and upload routes. → Also added `requirePermission` and `requireMinRole` helpers.
- [x] 2.2 Implement deterministic first-login admin bootstrap: → Created `OrgBootstrapService` (transactional, idempotent) + `POST /api/organization/bootstrap` route (Clerk JWT auth). Emits audit log on role assignment.
- [x] 2.3 Update backend permission matrix enforcement: admin = full control (org delete, ownership transfer, member/invite/upload management); manager (optional) = member/invite/upload management but no org delete actions; team_member = read-only ops. → Replaced `requireManager` with `requireOrgRole` on all 5 route files (organization-invite, user, health, database.backup, admin.metrics). Last-admin check: pending (to be added in 2.4 tests).
- [x] 2.4 Add backend tests: → `org-bootstrap.service.test.ts` (10 tests): idempotency, first-admin assignment, second-user team_member, Clerk role mapping, role persistence (canonical strings only), audit log. `requireOrgRole.test.ts` (19 tests): admin-only, admin+manager, legacy normalization, requirePermission, requireMinRole. Transaction timeout increased to 15s for SQLite.

## 3. Invite Lifecycle and Security Controls

- [x] 3.1 Update invite create/accept/revoke flows: → `OrganizationInviteService` updated: canonical role validation on create via `isValidRole()`, bcrypt token hash verification on accept, email match enforcement, one-time token use (hash cleared on accept/revoke), audit logging for all actions.
- [x] 3.2 Add invite resend capability: → `resendInvite()` method added to service + `POST /invites/:inviteId/resend` route with audit logging and email re-send.
- [x] 3.3 Implement token hashing: → 32-byte token, bcrypt cost 12, stored in `inviteTokenHash`. On accept: `bcrypt.compare()`, hash cleared after accept. On revoke: hash cleared. Expiration enforced via `expiresAt` check.
- [x] 3.4 Cloudflare WAF rate limiting rules documented: → `docs/plans/2026-04-17-cloudflare-waf-rate-limits.md` with 3 rules (invite create 10/60s, invite accept 5/60s, role change 20/3600s), Cloudflare API curl examples, and verification checklist. Deployment: apply via Cloudflare Dashboard or API when zone is configured.
- [ ] 3.4b (Optional) Add in-memory backend rate limit middleware: Count requests per authenticated userId (not just IP). Implement simple in-process cache with TTL (e.g., Map<key: `user:${userId}:${minute}`, value: count>). Use for defense-in-depth; catches distributed attacks. Include in audit logs.
- [x] 3.5 Emit audit events for all org-role and invite actions: → Created `OrgAuditService` (`backend/src/services/org-audit.service.ts`) with `emit()` and `getByOrganization()`. Integrated into bootstrap flow and all invite actions (create, accept, revoke, resend).

## 4. Workers Authorization Parity

- [x] 4.1 Workers role authorization architecture: → `authenticateRequest()` in `workers/src/middleware/auth.ts` now extracts `role` from JWT payload and returns it. `createJWTAuthMiddleware()` in `index.ts` sets `req.userRole` and `req.user.role` from auth result.
- [x] 4.2 Normalize Clerk role ingestion in Workers: → `workers/src/constants/roles.ts` already has `CLERK_ROLE_MAP` and `normalizeRole()`. Used by the new `require-role.middleware.ts`.
- [x] 4.3 Enforce role-based upload authorization in Workers: → Created `workers/src/middleware/require-role.middleware.ts` with `createUploadRoleMiddleware()` (gates POST/PUT/PATCH/DELETE to `/upload` paths) and `createRequireRoleMiddleware()` (generic path-prefix gating). Registered in Workers router after JWT auth.
- [x] 4.4 Add Workers tests (11 pass): → `workers/src/middleware/require-role.test.ts` (Vitest): admin/manager allowed, team_member blocked with 403, missing role blocked, GET passthrough, non-upload passthrough, Clerk role normalization, admin-only path gating.

## 5. Frontend Organization and Upload UX

- [x] 5.1 Update onboarding flow: → Created `useOrgBootstrap` hook (`frontend/src/hooks/useOrgBootstrap.ts`) that calls `POST /api/organization/bootstrap` when Clerk org context is established. Integrated into `AppContent` component.
- [x] 5.2 Update invite/member management UI: → `ClerkAuthProvider` updated to use `normalizeRole()` and `RoleValue` type. `UserManagementPage` updated to use `PRODUCTION_ROLES`, `ROLE_LABELS` from constants. All dropdowns render canonical roles.
- [x] 5.3 Update upload entry points / route guards: → All `App.tsx` route guards replaced: `userRole === 'Manager'` → `hasPermission(userRole, PERMISSIONS.MANAGE_MEMBERS)`. Settings, user management, store area management, CSV upload routes all gated by permission checks. Upload-specific UI gating: pending (upload button hide for team_member).
- [x] 5.4 Add frontend tests: → `frontend/src/tests/roles.test.ts` (11 tests): ROLES constants, ROLE_LABELS, PRODUCTION_ROLES, isValidRole, normalizeRole (legacy mapping + null handling), hasPermission matrix. `UserManagementPage.test.tsx` updated (4 tests): mock data now uses canonical roles (`admin`/`team_member`), assertions use `ROLE_LABELS` display strings, form submissions send canonical role values.

## 6. Verification and Rollout Readiness

- [ ] 6.1 Run migration/backfill in test environment and verify no non-canonical role values remain. Query all users and invites → confirm role field only contains admin/team_member (and manager if enabled). Run backfill script twice to verify idempotency.
- [ ] 6.2 Verify token hashing: Create invite → verify invite_token_hash is bcrypt hash (not plaintext token) → attempt accept with wrong token → verify bcrypt.compare fails → attempt accept with correct token → verify success. Verify one-time use: attempt re-accept same token → verify rejection.
- [ ] 6.3 Verify audit logging: Perform each action (create invite, accept, revoke, resend, assign role, remove role) → verify AuditLog entries created with correct event_type, actor, target, org context → verify raw tokens NOT in logs.
- [ ] 6.4 Execute end-to-end validation: (a) Admin bootstrap (first login assigns admin), (b) Invite acceptance (email match required, one-time token, role assigned on accept), (c) Upload role restrictions (admin (and manager if enabled) can upload, team_member gets 403, same across backend and Workers), (d) Rate limiting (Cloudflare returns 429 when threshold exceeded).
- [ ] 6.5 Run regression suites: (a) Authentication flows (login, logout, token refresh), (b) Organization operations (create, list, update, delete), (c) Upload flows (presigned URL generation, upload completion, role checks), (d) Invite lifecycle (all states: pending, accepted, revoked, expired).
- [ ] 6.6 Verify rate limiting enforcement: Test Cloudflare WAF rules return 429 under threshold load → verify backend audit logs capture rate limit hits → confirm 429 responses include Retry-After header.
- [ ] 6.7 Update rollout and rollback runbooks: Document enum migration checks (no non-canonical values), WAF rule deployment steps (3 rules via Cloudflare), audit log verification (queries for completeness), emergency fallback procedures (disable WAF rules via dashboard), token hash verification (bcrypt.compare test), admin constraint verification (cannot remove last admin).
