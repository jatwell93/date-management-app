# Proposal: Fix Worker Upload Clerk Auth

## Analysis

**Current**: `workers/src/index-minimal.ts`

- Worker upload initiate, direct, complete, and status handlers use the legacy app JWT verifier.
- `CSVUploadPage` sends Clerk bearer tokens, so `/api/upload/initiate` returns `401 Unauthorized` before user role or upload validation runs.
- Worker API routes already use `authenticateApiRequest` to verify Clerk and resolve the internal numeric user from `users.clerk_user_id`.

**Affected**: `workers/src/index-minimal.ts`, `workers/src/health.test.ts`

**Pattern**: Extend the existing Worker API Clerk authentication path rather than adding a new auth mechanism or restoring legacy frontend JWTs.

## Reuse Strategy

- Reuse `authenticateApiRequest` for API-authenticated upload initiate, direct, complete, and status handlers.
- Reuse existing upload key ownership checks based on internal numeric `userId`.
- Preserve presigned upload token verification for `/api/upload/presigned/:key`.
- Extend existing Worker health/upload tests instead of adding a new test harness.

## Implementation Steps

1. Add a failing Worker regression test for Clerk-authenticated `/api/upload/initiate`.
2. Pass a Worker database instance into upload handlers that need API authentication.
3. Replace legacy upload handler auth checks with `authenticateApiRequest`.
4. Update existing upload tests from legacy app JWTs to Clerk-authenticated requests with a user lookup.
5. Validate OpenSpec and run targeted Worker verification.
