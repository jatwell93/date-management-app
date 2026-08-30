/**
 * Real coverage for request authentication (task 3.1.0d).
 *
 * Replaces the auth behaviours that `__tests__/auth-integration.test.ts` only
 * *claimed* to cover. That file imported no production module at all — every
 * assertion ran against a local `fixtures.ts`, so it described a login system
 * that did not exist and could not have failed if `authenticateClerkRequest`
 * were deleted outright.
 *
 * The tests below call the real `authenticateClerkRequest` with a mocked Clerk
 * `verifyToken`, which is the only external boundary. Everything on this side
 * of it — header parsing, the missing-secret branch, claim handling — is live
 * code, so each test fails if that code changes.
 *
 * Existing 401 coverage in `minimal-api-routes.test.ts` mocks this function
 * wholesale to prove *dispatch* reaches auth; it deliberately says nothing
 * about whether auth itself is correct. That is the gap this file fills.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../types/env';

const mockedVerifyToken = vi.hoisted(() => vi.fn());

vi.mock('@clerk/backend', () => ({
  verifyToken: mockedVerifyToken,
  createClerkClient: vi.fn(),
}));

import { authenticateClerkRequest } from './bootstrap-handler';

const env = { CLERK_SECRET_KEY: 'sk_test_secret', NODE_ENV: 'production' } as unknown as Env;

const requestWith = (headers: Record<string, string>) =>
  new Request('https://example.com/api/products', { headers });

describe('authenticateClerkRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The header gate runs BEFORE the token is read, so a malformed header must
  // never reach Clerk. Asserting verifyToken was not called is the half that
  // matters: a rewrite that parsed loosely and let `verifyToken(undefined)`
  // decide would still answer 401 here, but would be sending junk upstream on
  // every unauthenticated request.
  it.each([
    ['no Authorization header at all', {}],
    ['a bare token with no scheme', { Authorization: 'sk_live_abc123' }],
    ['the wrong scheme', { Authorization: 'Basic dXNlcjpwYXNz' }],
    ['a lowercase bearer scheme', { Authorization: 'bearer abc123' }],
    ['an empty header value', { Authorization: '' }],
  ])('answers 401 for %s, without calling Clerk', async (_label, headers) => {
    const response = await authenticateClerkRequest(requestWith(headers), env);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(401);
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it('answers 401 when the token fails verification', async () => {
    mockedVerifyToken.mockRejectedValue(new Error('jwt expired'));

    const response = await authenticateClerkRequest(
      requestWith({ Authorization: 'Bearer expired-token' }),
      env,
    );

    expect((response as Response).status).toBe(401);
  });

  // A verified token with no `sub` is not an identity. Falling through with
  // `clerkUserId: undefined` would make the users lookup in
  // `authenticateApiRequest` match on NULL, so this branch is load-bearing.
  it('answers 401 when a verified token carries no subject claim', async () => {
    mockedVerifyToken.mockResolvedValue({ org_id: 'org_123' });

    const response = await authenticateClerkRequest(
      requestWith({ Authorization: 'Bearer no-sub' }),
      env,
    );

    expect((response as Response).status).toBe(401);
  });

  // 500, not 401: an unconfigured secret is an operator error, and answering
  // 401 would tell a legitimate caller their credentials were wrong.
  it('answers 500, not 401, when the Clerk secret is unset', async () => {
    const response = await authenticateClerkRequest(
      requestWith({ Authorization: 'Bearer good-token' }),
      { NODE_ENV: 'production' } as unknown as Env,
    );

    expect((response as Response).status).toBe(500);
    expect(mockedVerifyToken).not.toHaveBeenCalled();
  });

  it('returns the identity from the verified token claims', async () => {
    mockedVerifyToken.mockResolvedValue({
      sub: 'user_clerk_9',
      email: 'Person@Example.COM',
      org_id: 'org_from_token',
      org_role: 'org:admin',
    });

    const result = await authenticateClerkRequest(
      requestWith({ Authorization: 'Bearer good-token' }),
      env,
    );

    expect(result).not.toBeInstanceOf(Response);
    expect(result).toMatchObject({
      clerkUserId: 'user_clerk_9',
      organizationId: 'org_from_token',
      organizationRole: 'org:admin',
    });
    // Lower-cased so a differently-cased sign-in cannot create a second user
    // row for the same person.
    expect((result as { email: string }).email).toBe('person@example.com');
  });

  // The security property the deleted file asserted against a constant: the
  // caller's organization comes from the token, and a request body claiming a
  // different one changes nothing. Anything else would be a cross-tenant hole
  // of the same shape as #462/#466.
  it('takes the organization from the token, ignoring one supplied in the body', async () => {
    mockedVerifyToken.mockResolvedValue({ sub: 'user_clerk_9', org_id: 'org_from_token' });

    const result = await authenticateClerkRequest(
      new Request('https://example.com/api/products', {
        method: 'POST',
        headers: { Authorization: 'Bearer good-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: 'org_attacker', name: 'Milk' }),
      }),
      env,
    );

    expect((result as { organizationId: string }).organizationId).toBe('org_from_token');
  });
});
