# Current Onboarding Flow Mapping (Task 0.3)

## State Machine

```
┌──────────────┐     Clerk sign-in      ┌──────────────────┐
│ Unauthenticated│ ──────────────────► │  Authenticated     │
│  /login        │                      │  (no org yet)      │
└──────────────┘                        └────────┬───────────┘
                                                 │
                                          redirect to /onboarding
                                                 │
                                                 ▼
                                        ┌──────────────────┐
                                        │  OnboardingPage    │
                                        │  <CreateOrganization> │
                                        └────────┬───────────┘
                                                 │
                                     afterCreateOrganizationUrl="/scan"
                                                 │
                                                 ▼
                                        ┌──────────────────┐
                                        │  Authenticated     │
                                        │  + has org → /scan │
                                        └──────────────────┘
```

## Entry Points

### ClerkAuthProvider (`frontend/src/components/ClerkAuthProvider.tsx`)

- **ClerkAuthInner** wraps all children inside `<ClerkProvider>`
- On mount: `useUser()` provides `isSignedIn`, `user`, `isLoaded`
- On mount: `useOrganization()` provides `organization`, `isLoaded: isOrgLoaded`
- When `isSignedIn && isLoaded && user`:
  - Calls `getToken()` → decodes JWT for `userId`, `role`, `userName`
  - Sets `isLoggedIn=true`, `isFullySignedIn=true`
  - Role decoded as `'Manager' | 'Team Member'` (legacy strings)
- `hasOrganization = isOrgLoaded && !!organization`

### App Route Guards (`frontend/src/App.tsx`)

- `isLoggedIn = hasSession && isFullySignedIn` (line 138)
- `/login/*` → logged in? redirect `/scan` : show `<ClerkSignInPage>`
- `/sign-up/*` → logged in? redirect `/scan` : show `<ClerkSignUpPage>`
- `/onboarding`, `/onboarding/*` → logged in + has org? redirect `/scan` : logged in + no org? `<OnboardingPage>` : redirect `/login`
- `/settings`, `/settings/*` → logged in + `userRole === 'Manager'`? `<SettingsPage>` : redirect `/scan` or `/login`
- All other protected routes → logged in? render : redirect `/login`

### OnboardingPage (`frontend/src/pages/OnboardingPage.tsx`)

- Renders Clerk's `<CreateOrganization>` component
- Props: `routing="path"`, `path="/onboarding"`, `afterCreateOrganizationUrl="/scan"`
- After org creation, Clerk redirects to `/scan`
- **No backend bootstrap call exists** — org creation happens entirely within Clerk

## Bootstrap Insertion Point

The first-login admin bootstrap should be inserted **between Clerk org creation and the first protected route load**. Two approaches:

### Approach A: Intercept at `/scan` load (recommended)

- After `<CreateOrganization>` completes → redirects to `/scan`
- Before rendering `/scan`, call backend bootstrap endpoint
- Backend: verify Clerk org context → create DB org if needed → assign admin if no active admin → return membership context
- This is retry-safe (idempotent) and doesn't require modifying Clerk's `<CreateOrganization>` callbacks

### Approach B: Add callback on `<CreateOrganization>` completion

- Use Clerk's `afterCreateOrganizationUrl` as a custom route (e.g., `/onboarding/complete`)
- Call backend bootstrap from that route, then redirect to `/scan`
- Slightly more explicit but adds a transient route

**Recommendation:** Approach A — add bootstrap call as an effect in `AppContent` (or a dedicated wrapper) that fires when `isLoggedIn && hasOrganization` transitions to true and the backend user record doesn't exist yet.

## Current Role Usage (Legacy)

| Location                         | Role values used                                                         |
| -------------------------------- | ------------------------------------------------------------------------ |
| `ClerkAuthProvider`              | `'Manager'`, `'Team Member'`                                             |
| `App.tsx` route guards           | `userRole === 'Manager'` for `/settings`                                 |
| `auth.middleware.ts`             | `requireManager` checks `'Manager' \|\| 'admin'`                         |
| `organization-invite.service.ts` | `InviteRole = 'admin' \| 'member'`, maps to `'Manager' \| 'Team Member'` |
| Test auth bypass                 | `role: 'Manager'`                                                        |

All of the above need migration to canonical roles (`admin`, `team_member`, optional `manager`).
