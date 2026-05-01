## 1. Phase 1: Navigation & Accounts (Clerk-First)

- [x] 1.1 Debug and verify role propagation timing in `App.tsx`. The `effectiveUserRole` pattern (fallback from `bootstrapResult.role` to Clerk's `userRole`) is correct. Add a console.warn if bootstrap takes >2 seconds. Confirm admin-only nav links show within 2-3 seconds of login.
- [x] 1.2 Verify `CSV Upload`, `Expiry Import`, `Store Areas`, `User Management`, and `Settings` options dynamically display in the Nav bar for admin users. Test with both admin and non-admin roles.
- [x] 1.3 Audit `SettingsPage.tsx` and confirm it is fully rendering `<OrganizationProfile routing="path" path="/settings" />` from Clerk.
- [x] 1.4 Refactor `UserManagementPage.tsx` to display Clerk organization members instead of v1 PIN-based users. Use Clerk's `useOrganization()` hook to fetch members. Hide or remove the legacy "Create User" and "Reset PIN" forms.
- [x] 1.5 Create a new user profile dropdown in the navbar (next to the Reports dropdown). Add options: "Profile" (routes to `/profile`), "Logout". Add `<Route path="/profile" element={<UserProfile routing="path" path="/profile" />} />` to `App.tsx`.

## 2. Phase 2: Subscriptions

- [x] 2.1 Import `SubscriptionSettingsPage` in `App.tsx`.
- [x] 2.2 Add `<Route path="/subscription" element={<SubscriptionSettingsPage token={token} />} />` (wrapped in auth check).
- [x] 2.3 Add "Billing" below "Settings" in the main site Navigation linking to `/subscription`.
- [ ] 2.4 E2E Test the Stripe Checkout session redirect by clicking "Upgrade" locally and asserting the correct Stripe test key triggers.

## 3. Phase 3: The Catalog Data Engine

- [ ] 3.1 Run tests `npm run test:backend:functional` focusing on upload ingestion.
- [ ] 3.2 If Neon/Cloudflare timeout occurs for 10MB test files, implement necessary timeout extensions or document findings.

## 4. Phase 4: The Onboarding Wizard

- [ ] 4.1 Refactor `OnboardingPage.tsx`. Instead of redirecting immediately to `/scan`, introduce `step` state (0: CreateOrg, 1: CatalogChoice, 2: Orientation).
- [ ] 4.2 **Step 0**: Render `<CreateOrganization afterCreateOrganizationUrl="/onboarding?step=1" />`. This will redirect to `/onboarding?step=1` on completion.
- [ ] 4.3 **Step 1**: Render wizard panel offering two choices: "Upload CSV Catalog" (redirects to `/csv-upload?return=/onboarding?step=2`) OR "Load Demo Data" (calls new seed endpoint, then redirects to step 2).
- [ ] 4.4a **(NEW: Backend)** Create `POST /api/organization/seed-demo-data` endpoint that:
  - Checks if requester is org admin
  - Creates 5-10 sample pharmacy products (Vitamins, Pain Relief, etc.) with realistic SKUs and expiry dates
  - Creates 2-3 sample store areas ("Front Shelf", "Back Storage", "Cooler")
  - Returns `{ success: true, productsCreated: N, areasCreated: M }`
- [ ] 4.4b **(NEW: Frontend)** Hook up the "Load Demo Data" button in the onboarding wizard to call the new seed endpoint. Show a loading state. On success, redirect to `/onboarding?step=2`.
- [ ] 4.5 **Step 2**: Brief 3-slide visual orientation carousel explaining Dashboard > Catalog > Scans. Final button: "Go to Dashboard" redirects to `/scan`.
