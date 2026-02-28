/**
 * Utility for handling test authentication bypass
 * This should only be used in test environments
 */
export const TEST_AUTH_BYPASS_ORG_ID = 'default-org';

/**
 * Check if we're in a test environment
 */
export const isTestEnvironment = (): boolean => {
  return process.env.NODE_ENV === 'test' || process.env.TEST_AUTH_BYPASS === 'true';
};

/**
 * Get organization ID with safety checks
 * Throws an error if no organizationId is provided in production
 */
export const getOrganizationId = (organizationId?: string): string => {
  if (organizationId) {
    return organizationId;
  }
  
  if (isTestEnvironment()) {
    return TEST_AUTH_BYPASS_ORG_ID;
  }
  
  throw new Error('Organization ID is required in production environments');
};
