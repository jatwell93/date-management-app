/**
 * Authentication integration — POINTER FILE (task 3.1.0d).
 *
 * This file held 18 tests. It imported **no production module at all** — every
 * assertion ran against a local `fixtures.ts`, so the suite described an auth
 * system rather than exercising one. Fourteen of the eighteen were
 * `const expected = true; expect(expected).toBe(true)` under names like
 * "Missing Authorization header returns 401" and "organizationId extracted from
 * token, never from request body". The remaining four asserted that fixture
 * objects contained the values the same file had just written into them.
 *
 * Deleting `authenticateClerkRequest` outright would not have failed a single
 * one of them.
 *
 * **Real coverage now lives in `../clerk/request-authentication.test.ts`**, which
 * calls the live `authenticateClerkRequest` with only Clerk's `verifyToken`
 * mocked — header parsing, the missing-secret branch, the missing-subject guard
 * and the organization-from-token property are all real code there. Each
 * assertion was verified to fail when the corresponding branch is removed.
 *
 * Skipped rather than deleted because ~98 rows in
 * `openspec/changes/retire-express-unify-on-postgres/audit/` cite this path as
 * searched-and-empty evidence, and those citations must keep resolving. The skip
 * says "relocated", not "not yet written".
 */
import { describe, it } from 'vitest';

describe.skip('Auth integration — relocated to clerk/request-authentication.test.ts', () => {
  it('is asserted there against the live authenticator, not here against fixtures', () => {
    throw new Error('unreachable: this suite is skipped');
  });
});
