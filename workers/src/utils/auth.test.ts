/**
 * Unit Tests for Multi-Tenant Auth Context
 * Phase 8B Task 1: Auth Context Extraction (Tests 8B.1.7-1.8)
 *
 * Tests JWT verification, organizationId extraction, and subscription validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  verifyJWT,
  extractOrganizationId,
  validateOrganizationStatus,
  authenticateWorkerRequest,
  extractJWTFromHeader,
  TokenPayload,
  SubscriptionStatus,
  SubscriptionTierData,
} from './auth';
import { SignJWT } from 'jose';

/**
 * Test utilities
 */
const TEST_JWT_SECRET = 'test-secret-key-for-unit-tests';
const TEST_ORG_ID = 'test-org-123';
const TEST_USER_ID = 1;

/**
 * Create valid JWT for testing
 */
async function createTestJWT(
  userId: number = TEST_USER_ID,
  organizationId: string = TEST_ORG_ID,
  expiresIn: string = '24h',
): Promise<string> {
  const encoder = new TextEncoder();
  const secretKey = encoder.encode(TEST_JWT_SECRET);

  return await new SignJWT({
    userId,
    organizationId,
    role: 'Manager',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(expiresIn)
    .setIssuedAt()
    .sign(secretKey);
}

/**
 * Mock subscription tier data
 */
function createMockSubscription(
  tierLevel: 'starter' | 'professional' | 'premium' | 'concierge' = 'professional',
  status: SubscriptionStatus = SubscriptionStatus.ACTIVE,
): SubscriptionTierData {
  return {
    id: 'sub-123',
    organizationId: TEST_ORG_ID,
    tierLevel,
    status,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2026-01-01'),
    stripeSubscriptionId: 'stripe-sub-123',
  };
}

/**
 * Test Suite: JWT Verification (Task 8B.1.2)
 */
describe('verifyJWT', () => {
  it('should verify valid JWT with all required fields', async () => {
    // Arrange
    const token = await createTestJWT();

    // Act
    const payload = await verifyJWT(token, TEST_JWT_SECRET);

    // Assert
    expect(payload).toBeTruthy();
    expect(payload?.userId).toBe(TEST_USER_ID);
    expect(payload?.organizationId).toBe(TEST_ORG_ID);
  });

  it('should return null for expired JWT', async () => {
    // Arrange
    const token = await createTestJWT(TEST_USER_ID, TEST_ORG_ID, '-1h');

    // Act
    const payload = await verifyJWT(token, TEST_JWT_SECRET);

    // Assert
    expect(payload).toBeNull();
  });

  it('should return null for JWT with wrong secret', async () => {
    // Arrange
    const token = await createTestJWT();
    const wrongSecret = 'wrong-secret-key';

    // Act
    const payload = await verifyJWT(token, wrongSecret);

    // Assert
    expect(payload).toBeNull();
  });

  it('should return null for malformed JWT', async () => {
    // Arrange
    const malformedToken = 'not.a.valid.jwt.token.at.all';

    // Act
    const payload = await verifyJWT(malformedToken, TEST_JWT_SECRET);

    // Assert
    expect(payload).toBeNull();
  });
});

/**
 * Test Suite: Extract OrganizationId (Task 8B.1.3)
 */
describe('extractOrganizationId', () => {
  it('should extract organizationId from valid token', async () => {
    // Arrange
    const token = await createTestJWT();
    const payload = await verifyJWT(token, TEST_JWT_SECRET);

    // Act
    const orgId = extractOrganizationId(payload);

    // Assert
    expect(orgId).toBe(TEST_ORG_ID);
  });

  it('should return null for null token', () => {
    // Act
    const orgId = extractOrganizationId(null);

    // Assert
    expect(orgId).toBeNull();
  });

  it('should return null for token without organizationId', async () => {
    // Arrange
    const encoder = new TextEncoder();
    const secretKey = encoder.encode(TEST_JWT_SECRET);
    const tokenWithoutOrg = await new SignJWT({
      userId: TEST_USER_ID,
      // organizationId intentionally omitted
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('24h')
      .sign(secretKey);

    const payload = await verifyJWT(tokenWithoutOrg, TEST_JWT_SECRET);

    // Act
    const orgId = extractOrganizationId(payload);

    // Assert
    expect(orgId).toBeNull();
  });

  it('should return null for empty string organizationId', async () => {
    // Arrange
    const encoder = new TextEncoder();
    const secretKey = encoder.encode(TEST_JWT_SECRET);
    const tokenWithEmptyOrg = await new SignJWT({
      userId: TEST_USER_ID,
      organizationId: '',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('24h')
      .sign(secretKey);

    const payload = await verifyJWT(tokenWithEmptyOrg, TEST_JWT_SECRET);

    // Act
    const orgId = extractOrganizationId(payload);

    // Assert
    expect(orgId).toBeNull();
  });
});

/**
 * Test Suite: Validate Organization Status (Task 8B.1.5)
 */
describe('validateOrganizationStatus', () => {
  it('should validate active subscription', () => {
    // Arrange
    const subscription = createMockSubscription('professional', SubscriptionStatus.ACTIVE);

    // Act
    const result = validateOrganizationStatus(subscription, TEST_ORG_ID);

    // Assert
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should reject canceled subscription', () => {
    // Arrange
    const subscription = createMockSubscription('professional', SubscriptionStatus.CANCELED);

    // Act
    const result = validateOrganizationStatus(subscription, TEST_ORG_ID);

    // Assert
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('canceled');
  });

  it('should reject null subscription', () => {
    // Act
    const result = validateOrganizationStatus(null, TEST_ORG_ID);

    // Assert
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('not configured');
  });

  it('should accept trialing subscription', () => {
    // Arrange
    const subscription = createMockSubscription('professional', SubscriptionStatus.TRIALING);

    // Act
    const result = validateOrganizationStatus(subscription, TEST_ORG_ID);

    // Assert
    expect(result.isValid).toBe(true);
  });

  it('should accept past_due subscription', () => {
    // Arrange
    const subscription = createMockSubscription('professional', SubscriptionStatus.PAST_DUE);

    // Act
    const result = validateOrganizationStatus(subscription, TEST_ORG_ID);

    // Assert
    expect(result.isValid).toBe(true);
  });
});

/**
 * Test Suite: Extract JWT from Header (Task 8B.1.6)
 */
describe('extractJWTFromHeader', () => {
  it('should extract JWT from valid Bearer header', () => {
    // Arrange
    const token = 'eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0';
    const request = new Request('http://localhost', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    // Act
    const extracted = extractJWTFromHeader(request);

    // Assert
    expect(extracted).toBe(token);
  });

  it('should return null for request without Authorization header', () => {
    // Arrange
    const request = new Request('http://localhost');

    // Act
    const extracted = extractJWTFromHeader(request);

    // Assert
    expect(extracted).toBeNull();
  });

  it('should return null for malformed Bearer header', () => {
    // Arrange
    const request = new Request('http://localhost', {
      headers: {
        Authorization: 'NotBearer token123',
      },
    });

    // Act
    const extracted = extractJWTFromHeader(request);

    // Assert
    expect(extracted).toBeNull();
  });

  it('should return null for Authorization header without token', () => {
    // Arrange
    const request = new Request('http://localhost', {
      headers: {
        Authorization: 'Bearer ',
      },
    });

    // Act
    const extracted = extractJWTFromHeader(request);

    // Assert
    expect(extracted).toBeNull();
  });
});

/**
 * Test Suite: Full Authentication Flow (Task 8B.1.8)
 * Integration test of auth context extraction
 */
describe('authenticateWorkerRequest', () => {
  let mockDbClient: any;

  beforeEach(() => {
    // Mock database client
    mockDbClient = vi.fn();
  });

  it('should return valid auth context with active subscription', async () => {
    // Arrange
    const token = await createTestJWT();
    const subscription = createMockSubscription('professional');
    mockDbClient.mockResolvedValue([
      {
        id: subscription.id,
        organizationId: subscription.organizationId,
        tierLevel: subscription.tierLevel,
        status: subscription.status,
        createdAt: subscription.createdAt.toISOString(),
        updatedAt: subscription.updatedAt.toISOString(),
        stripeSubscriptionId: subscription.stripeSubscriptionId,
      },
    ]);

    // Act
    const context = await authenticateWorkerRequest(token, TEST_JWT_SECRET, mockDbClient);

    // Assert
    expect(context.isValid).toBe(true);
    expect(context.userId).toBe(TEST_USER_ID);
    expect(context.organizationId).toBe(TEST_ORG_ID);
    expect(context.tierLevel).toBe('professional');
    expect(context.error).toBeUndefined();
  });

  it('should reject request with no token', async () => {
    // Act
    const context = await authenticateWorkerRequest(null, TEST_JWT_SECRET, mockDbClient);

    // Assert
    expect(context.isValid).toBe(false);
    expect(context.error).toContain('No token');
  });

  it('should reject request with invalid token', async () => {
    // Act
    const context = await authenticateWorkerRequest(
      'invalid.token.here',
      TEST_JWT_SECRET,
      mockDbClient,
    );

    // Assert
    expect(context.isValid).toBe(false);
    expect(context.error).toContain('Invalid');
  });

  it('should reject request with token missing organizationId', async () => {
    // Arrange
    const encoder = new TextEncoder();
    const secretKey = encoder.encode(TEST_JWT_SECRET);
    const tokenWithoutOrg = await new SignJWT({
      userId: TEST_USER_ID,
      // organizationId intentionally omitted
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('24h')
      .sign(secretKey);

    // Act
    const context = await authenticateWorkerRequest(tokenWithoutOrg, TEST_JWT_SECRET, mockDbClient);

    // Assert
    expect(context.isValid).toBe(false);
    expect(context.error).toContain('tenant context');
  });

  it('should reject request when subscription lookup fails', async () => {
    // Arrange
    const token = await createTestJWT();
    mockDbClient.mockResolvedValue([]);

    // Act
    const context = await authenticateWorkerRequest(token, TEST_JWT_SECRET, mockDbClient);

    // Assert
    expect(context.isValid).toBe(false);
    expect(context.error).toContain('not configured');
  });

  it('should reject request with canceled subscription', async () => {
    // Arrange
    const token = await createTestJWT();
    const canceledSub = createMockSubscription('professional', SubscriptionStatus.CANCELED);
    mockDbClient.mockResolvedValue([
      {
        id: canceledSub.id,
        organizationId: canceledSub.organizationId,
        tierLevel: canceledSub.tierLevel,
        status: canceledSub.status,
        createdAt: canceledSub.createdAt.toISOString(),
        updatedAt: canceledSub.updatedAt.toISOString(),
      },
    ]);

    // Act
    const context = await authenticateWorkerRequest(token, TEST_JWT_SECRET, mockDbClient);

    // Assert
    expect(context.isValid).toBe(false);
    expect(context.error).toContain('canceled');
  });
});
