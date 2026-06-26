# Proposal: Fix Scan Expiry Clerk Token

## Analysis

**Current**: `frontend/src/pages/ScanPage.tsx`

- The scan page receives the Clerk session token as a prop from `ClerkAuthProvider`.
- Expiry item submission calls `apiService.post('/inventory-items', ..., token)` with that prop.
- A prior upload fix in `frontend/src/pages/CSVUploadPage.tsx` showed this prop can become stale because Clerk session tokens are fetched once at provider startup.
- The Worker `/api/inventory-items` route already uses Clerk-aware `authenticateApiRequest`, so stale client tokens result in `401 {"error":"Invalid or expired token"}` and trigger the frontend logout path.

**Affected**: `frontend/src/pages/ScanPage.tsx`, `frontend/src/pages/__tests__/ScanPage.test.tsx`

**Pattern**: Extend the existing fresh Clerk token pattern from `CSVUploadPage` instead of creating a new auth service or changing Worker authentication.

## Reuse Strategy

- Reuse Clerk `useAuth().getToken()` directly in `ScanPage` for online API calls.
- Keep the prop token as a fallback if Clerk token refresh fails.
- Extend the existing `ScanPage` test suite with a stale-token regression.

## Implementation Steps

1. Add a failing regression test proving online expiry submission uses a fresh Clerk token instead of a stale prop token.
2. Update `ScanPage` to refresh the Clerk token at API call time for scan-page requests.
3. Preserve offline queue behavior and fallback to the existing prop token when refresh fails.
4. Run targeted frontend verification and OpenSpec validation.
