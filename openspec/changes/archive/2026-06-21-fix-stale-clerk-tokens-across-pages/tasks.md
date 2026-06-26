## 1. Implementation

- [x] Add a shared frontend helper/hook that requests a fresh Clerk token before authenticated API calls and falls back to the route token when refresh fails.
- [x] Migrate ScanPage authenticated API calls to resolve a fresh token at call time.
- [x] Migrate representative report, management, subscription, trial, storage, and markdown calculator API calls to resolve a fresh token at call time.
- [x] Update offline sync token providers so queued sync requests can obtain a current Clerk token before posting.
- [x] Preserve existing apiService 401 behavior so real authorization failures still dispatch the unauthorized event.

## 2. Tests

- [x] Cover token refresh success and refresh-failure fallback without logging token values.
- [x] Cover ScanPage product lookup using a fresh Clerk token instead of a stale prop token.
- [x] Cover representative dashboard, store area, markdown calculator, and offline sync fresh-token flows.
- [x] Keep affected component tests isolated from ClerkProvider by mocking the shared fresh-token hook where appropriate.

## 3. Verification

- [x] Validate the OpenSpec change with `openspec validate fix-stale-clerk-tokens-across-pages --strict`.
- [x] Run targeted frontend tests for the shared helper and migrated surfaces.
- [x] Run frontend lint and build checks.
- [x] Attempt broader verification and record environment blockers for commands that cannot run.
