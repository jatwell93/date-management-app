## Context

The v1 application relied heavily on custom UI components for organization management and invites. When moving to v2 (Cloudflare, Clerk, Neon Serverless), developers built out native Clerk logic but left legacy custom paths partially connected, breaking permissions. Furthermore, key new features like CSV Upload and Stripe integrations were written but not fully integrated into the user flow. As a result, the trial experience lacks cohesion and basic manageability limits.

## Goals / Non-Goals

**Goals:**

- Transition 100% to Clerk's built-in `<OrganizationProfile>` and `<UserProfile>` for management.
- Remove arbitrary `<App>` role-gating that hides standard organizational features (like `/csv-upload` and `/settings`) from valid users.
- Re-integrate `/subscription` into the Nav to allow trial users to test Stripe Checkout properly end-to-end.
- Construct a robust multi-step `OnboardingPage.tsx` using a wizard format to push users towards catalog creation.

**Non-Goals:**

- Refactoring the entire CSV parsing engine (unless E2E tests uncover a hard blocker on Cloudflare/Neon).
- Overhauling the core UI theme or adding custom styling to Clerk components at this phase.

## Decisions

1. **Routing and Role Permissions**:
   - _Decision_: The current `effectiveUserRole` logic (fallback from `bootstrapResult.role` to Clerk's `userRole`) is correct and intentional. Debug role propagation timing to ensure bootstrap data arrives reliably within 2 seconds. If timing is solid, keep the current pattern; if flaky, simplify to Clerk's `userRole` exclusively.
   - _Alternative_: Force synchronous bootstrap before any routing. _Rejected_ because it slows UX and bootstrap is inherently async.

2. **User Management (Deprecate v1)**:
   - _Decision_: Remove the v1 PIN-based user creation/management UI from `UserManagementPage.tsx`. Refactor it to fetch and display Clerk organization members instead. Deprecate `/api/users/*` endpoints (keep them working but stop exposing the UI).
   - _Alternative_: Parallel both v1 and Clerk UIs temporarily. _Rejected_ because it creates confusion and doubles maintenance burden during the trial.

3. **Admin Invites**:
   - _Decision_: Fully rely on Clerk's `<OrganizationProfile>` out-of-the-box invitation links. This is already in use; no custom invite UI needed.
   - _Alternative_: Build custom invite UI to enforce tier limits upfront. _Rejected_ because we enforce limits asynchronously via Clerk webhooks and daily sync jobs.

4. **Onboarding UX**:
   - _Decision_: After Clerk's `<CreateOrganization />` completes, route to a multi-step `OnboardingWizard` component that offers: (1) Upload CSV Catalog, or (2) Load Demo Pharmacy Data (via new backend seed endpoint).
   - _Alternative_: Drop them on the dashboard with tooltips. _Rejected_ because the app is useless without a catalog; a hard wizard converts higher.

## Risks / Trade-offs

- **Risk: Cloudflare worker timeouts on large CSVs (10MB)**
  - _Mitigation_: We will do an E2E test. If Cloudflare limits are hit, we will scale back the max upload size or implement chunked uploading in a subsequent fast-follow PR.
- **Risk: Role propagation delay from bootstrap**
  - _Mitigation_: Add a 2-second timeout with a fallback to Clerk's `userRole`. If bootstrap doesn't arrive by then, the UI remains usable with slightly reduced visibility (fallback role applies).
- **Risk: Removing v1 PIN UI breaks workflows for existing users**
  - _Mitigation_: We keep the `/api/users/*` endpoints functional for backend scripts/tests. We only hide the UI. No data loss, just UI removal.
