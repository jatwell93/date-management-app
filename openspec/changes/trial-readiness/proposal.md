## Why

The application currently has several powerful UI components (like Stripe subscriptions, CSV catalog uploads, and built-in Clerk organization management) that are disconnected, hidden behind broken role-gating, or missing entirely from the main router. To conduct our first real-world user trial, we need these features to be discoverable, functional, and organized into a coherent onboarding and management flow. In short: these gaps prevent a user from successfully signing up, managing their organization, uploading their catalog, and paying for the service.

## What Changes

- **Navigation & Accounts**: Expose Clerk's native `<UserProfile>` and `<OrganizationProfile>` components in the app routing. Deprecate all legacy v1 PIN-based user management and team member management. Fix role propagation timing so admin-only routes reliably display. Add a user profile dropdown for personal account settings.
- **Subscriptions**: Add the orphaned `SubscriptionSettingsPage` to the router so users can view and upgrade their Stripe plan.
- **Catalog Data Engine**: Verify the CSV Upload UI and backend parser function correctly end-to-end on the new Cloudflare/Neon stack. Add a demo data seeding endpoint.
- **Onboarding Wizard**: Replace the abrupt Clerk Organization Create redirect with a multi-step onboarding wizard guiding users to upload their first catalog or load sample pharmacy data.

## Capabilities

### New Capabilities

- `onboarding-flow`: Multi-step orientation wizard for new users (Create Org -> Setup Catalog -> Dashboard).
- `subscription-ui`: Exposing the Stripe integration UI for trial conversion and tier changes.

### Modified Capabilities

- `user-navigation`: Restructuring the router and mobile/desktop nav to include Profile, Organization Settings, and Billing.
- `csv-catalog-upload`: Ensuring the existing CSV capabilities are discoverable and proven to work with Cloudflare workers.

## Impact

- **Frontend Router (`App.tsx`)**: Needs new routes (user profile dropdown, /subscription), updated role propagation timing checks, and user management page refactor.
- **User Management (`UserManagementPage.tsx`)**: Migrate from v1 PIN-based users to displaying Clerk organization members.
- **Onboarding (`OnboardingPage.tsx`)**: Significant visual and logical overhaul including demo data loading.
- **Settings (`SettingsPage.tsx`)**: Already uses Clerk's `<OrganizationProfile>`; no changes needed.
- **Backend Routes**: Deprecate `/api/users/*` (v1 PIN endpoints); create `/api/organization/seed-demo-data` endpoint.
- **API (`upload.routes.ts`)**: E2E testing to ensure Neon/Cloudflare don't time out on valid files.
