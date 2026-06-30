/**
 * Integration Test Fixtures & Utilities
 *
 * Provides test data, mock database setup, and assertion helpers
 * for multi-tenant integration tests
 */

import { expect } from 'vitest';
import type { Env } from '../types/env';

/**
 * Test organization factory for creating isolated test data
 */
export function createTestOrgId(prefix: string = 'test-org'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * JWT token creator for testing
 */
export interface JWTTestPayload {
  organizationId: string;
  sub?: string;
  email?: string;
  tier_level?: 'starter' | 'professional' | 'concierge';
  exp?: number;
}

export function createTestJWT(payload: JWTTestPayload): string {
  // Create a minimal valid JWT structure for testing
  // Header.Payload.Signature (base64url encoded)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

  const claims = {
    organizationId: payload.organizationId,
    sub: payload.sub || 'test-user-123',
    email: payload.email || 'test@example.com',
    tier_level: payload.tier_level || 'starter',
    exp: payload.exp || Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    iss: 'test-issuer',
  };

  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = Buffer.from('test-signature').toString('base64url');

  return `${header}.${body}.${signature}`;
}

/**
 * Test environment setup
 */
export const testEnv: Env = {
  NODE_ENV: 'test' as unknown as 'development',
  STORAGE_PROVIDER: 'r2',
  MAX_FILE_SIZE: '10485760',
  CSV_BATCH_SIZE: '100',
  RATE_LIMIT_WINDOW: '60000',
  RATE_LIMIT_MAX_REQUESTS: '100',
  RATE_LIMIT_MAX_AUTHENTICATED: '1000',
  NEON_CONNECTION_STRING: process.env.NEON_TEST_CONNECTION_STRING || '',
  JWT_SECRET: 'test-secret-key',
  CLERK_WEBHOOK_SECRET: 'whsec_test',
  R2_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET_NAME: 'test-bucket',
  CSV_UPLOADS: {} as unknown as R2Bucket,
  HYPERDRIVE: {
    connectionString: process.env.NEON_TEST_CONNECTION_STRING || '',
  } as unknown as Hyperdrive,
};

/**
 * Test data generators
 */
export const testData = {
  product: (organizationId: string, overrides?: any) => ({
    name: 'Test Product',
    barcode: `TEST-${Date.now()}`,
    description: 'Test product description',
    category: 'Test Category',
    organization_id: organizationId,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  }),

  inventoryItem: (organizationId: string, productId: number, overrides?: any) => ({
    product_id: productId,
    quantity: 100,
    expiry_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days from now
    store_area_id: null,
    status: 'Normal',
    organization_id: organizationId,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  }),

  storeArea: (organizationId: string, overrides?: any) => ({
    name: 'Test Store Area',
    description: 'Test area description',
    sub_department: 'Test Dept',
    organization_id: organizationId,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  }),

  organization: (overrides?: any) => ({
    organization_id: createTestOrgId('org'),
    name: 'Test Organization',
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  }),

  subscription: (
    arg1?: string | { [key: string]: any },
    tierLevel: string = 'professional',
    overrides?: any,
  ) => {
    // Support both call patterns used in tests:
    // 1) subscription({ status: 'canceled' })
    // 2) subscription(orgId, 'starter', { status: 'trial' })
    if (typeof arg1 === 'object' || arg1 === undefined) {
      const objectOverrides = (arg1 as any) || {};
      return {
        organization_id: createTestOrgId('org'),
        tier_level: 'professional',
        status: 'active',
        billing_period_start: new Date(),
        billing_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        created_at: new Date(),
        updated_at: new Date(),
        ...objectOverrides,
      };
    }

    return {
      organization_id: arg1,
      tier_level: tierLevel,
      status: 'active',
      billing_period_start: new Date(),
      billing_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides,
    };
  },
};

/**
 * Tier limits for testing
 */
export const tierLimits = {
  starter: {
    max_skus: 500,
    max_users: 1,
    max_storage: 1024 * 1024 * 100, // 100MB
    features: ['basic_inventory', 'product_management'],
  },
  professional: {
    max_skus: 2000,
    max_users: 10,
    max_storage: 1024 * 1024 * 1024, // 1GB
    features: ['basic_inventory', 'product_management', 'advanced_analytics', 'bulk_export'],
  },
  concierge: {
    max_skus: Infinity,
    max_users: Infinity,
    max_storage: Infinity,
    features: [
      'basic_inventory',
      'product_management',
      'advanced_analytics',
      'bulk_export',
      'api_access',
      'custom_integrations',
    ],
  },
};

/**
 * Helper assertions for integration tests
 */
export const testAssertions = {
  /**
   * Assert that a query result contains only data from a specific organization
   */
  assertOrgIsolation(results: any[], organizationId: string, orgField = 'organization_id') {
    expect(results).toBeDefined();
    results.forEach((result) => {
      expect(result[orgField]).toBe(organizationId);
    });
  },

  /**
   * Assert that a value is within a tier's limits
   */
  assertWithinLimit(actual: number, limit: number, message: string) {
    expect(actual).toBeLessThanOrEqual(limit);
  },

  /**
   * Assert error response
   */
  assertErrorStatus(response: any, expectedStatus: number, expectedMessage?: string) {
    expect(response.status).toBe(expectedStatus);
    if (expectedMessage && response.body) {
      expect(JSON.stringify(response.body)).toContain(expectedMessage);
    }
  },
};

/**
 * Mock context for Workers
 */
export function createMockContext() {
  return {
    waitUntil: (promise: Promise<any>) => {},
    passThroughOnException: () => {},
  };
}
