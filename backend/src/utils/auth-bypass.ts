/**
 * Utility for handling test authentication bypass
 * This should only be used in test environments
 */
export const TEST_AUTH_BYPASS_ORG_ID = 'default-org';

/**
 * Whether the test auth bypass is active.
 *
 * Both halves are required, and deliberately so: this must agree with the two
 * middleware guards (`middleware/auth.middleware.ts:129`,
 * `middleware/clerk-auth.middleware.ts:79`), which have always been `&&`. When
 * this predicate was `||`, a deployment that set `TEST_AUTH_BYPASS=true` outside
 * `NODE_ENV=test` left the middleware failing closed while `getOrganizationId`
 * below failed *open*, handing every org-less service construction the shared
 * `'default-org'` tenant. Tightening the loosest of three siblings is the whole
 * point; do not re-broaden it to a bare `NODE_ENV === 'test'` check.
 */
export const isTestAuthBypassEnabled = (): boolean => {
  return process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
};

/**
 * Get organization ID with safety checks
 * Throws unless an organization id was supplied or the test auth bypass is active
 */
export const getOrganizationId = (organizationId?: string): string => {
  if (organizationId) {
    return organizationId;
  }

  if (isTestAuthBypassEnabled()) {
    return TEST_AUTH_BYPASS_ORG_ID;
  }

  throw new Error('Organization ID is required in production environments');
};
