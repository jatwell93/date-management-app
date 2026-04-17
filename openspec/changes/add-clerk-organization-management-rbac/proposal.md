## Why

The current Clerk-backed organization flow is only partially implemented and uses mixed role models (`admin/member`, `Manager/Team Member`), which creates authorization drift across frontend, backend, and Workers. We need a single organization-management contract now to safely support first-login admin setup, role-controlled collaboration, and protected upload operations before additional tenant and onboarding work expands usage.

## What Changes

- Define a first-login organization bootstrap flow where the first authenticated user creates or claims an organization and is assigned the highest privilege role (`admin`).
- Standardize organization roles to `admin`, `manager` (optional, dev-only until Clerk plan upgrade), and `team_member`, including explicit permission boundaries for user management, invites, settings, and upload operations.
- Add a complete invite lifecycle: create invite, resend/revoke invite, token-based accept flow, and role assignment at acceptance with organization scoping.
- Align backend and Workers authorization enforcement so role checks are consistent across Express routes and Cloudflare edge endpoints.
- Add security controls for invites and org-management actions: token expiry/one-time use, email-verification checks before acceptance, rate limiting, and audit log coverage.
- Restrict product data uploads (CSV/XLSX/XLS) so only `admin` (and `manager` if enabled) can upload, while `team_member` remains read-only.

## Capabilities

### New Capabilities
- `clerk-org-first-login-bootstrap`: First-time login workflow that ensures organization creation/selection and assigns `admin` to the initial organization user.
- `organization-rbac-admin-manager-team-member`: Canonical role model and permission matrix applied to organization management, member administration, and settings. `manager` is optional until Clerk plan upgrade.
- `organization-invite-role-assignment`: End-to-end invite workflow with role selection, acceptance flow, and membership provisioning.
- `organization-security-controls`: Security requirements for invite tokens, email verification, rate limiting, and auditability of org/role/invite actions.

### Modified Capabilities
- `cloudflare-workers-api`: Add role-aware authorization requirements and consistent org-context enforcement for org and membership endpoints served at the edge.
- `csv-upload-processing`: Add role-based authorization requirements so upload initiation and processing are limited to `admin` (and `manager` if enabled) roles.

## Impact

- **Backend routes and middleware**: `backend/src/routes/organization-invite.routes.ts`, `backend/src/routes/user.routes.ts`, `backend/src/middleware/auth.middleware.ts`, and upload-related routes will require unified role checks and invite acceptance constraints.
- **Backend services and data model**: `backend/src/services/organization-invite.service.ts`, `backend/src/services/organization.service.ts`, `backend/src/services/user.service.ts`, and `backend/prisma/schema.prisma` will require role normalization and backward-compatible mapping from legacy role values.
- **Workers edge API**: `workers/src/index-minimal.ts` auth and upload handlers will require aligned role enforcement and invite/org access behavior.
- **Frontend organization UX**: `frontend/src/pages/OnboardingPage.tsx`, organization/member management views, and invite flows will require first-login admin bootstrap and role-aware UI states.
- **Security and observability**: Audit-log coverage for org-role changes, invite events, and upload authorization denials will be expanded; rate-limiting and token policies will be applied to invite endpoints.