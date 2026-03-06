/**
 * Task 7.7: Tests for Workers JWT Authentication
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  verifyJWT,
  createJWT,
  authenticateRequest,
  createAuthMiddleware,
  addUserIdHeader,
  unauthorized,
  getPublicEndpoints,
  JWTPayloadData,
} from '../middleware/auth';

describe('Workers JWT Authentication (Task 7)', () => {
  const testSecret = 'test-jwt-secret-key-for-testing';
  const testUserId = 42;
  const testOrganizationId = 'org_test123';

  describe('Task 7.3: JWT Signature Verification', () => {
    it('should create and verify valid JWT', async () => {
      // Create token
      const token = await createJWT(testUserId, testOrganizationId, testSecret);
      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');

      // Verify token
      const payload = await verifyJWT(token, testSecret);
      expect(payload).toBeTruthy();
      expect(payload?.userId).toBe(testUserId);
      expect(payload?.organizationId).toBe(testOrganizationId);
    });

    it('should reject invalid token signature', async () => {
      const token = await createJWT(testUserId, testOrganizationId, testSecret);
      const wrongSecret = 'wrong-secret-key';

      const payload = await verifyJWT(token, wrongSecret);
      expect(payload).toBeNull();
    });

    it('should reject malformed token', async () => {
      const badToken = 'not.a.valid.jwt.token';
      const payload = await verifyJWT(badToken, testSecret);
      expect(payload).toBeNull();
    });

    it('should include userId in payload', async () => {
      const token = await createJWT(123, testOrganizationId, testSecret);
      const payload = await verifyJWT(token, testSecret);
      
      expect(payload?.userId).toBe(123);
    });
  });

  describe('Task 7.2: Extract JWT from Authorization Header', () => {
    it('should authenticate valid request with Bearer token', async () => {
      const token = await createJWT(testUserId, testOrganizationId, testSecret);
      
      // Create mock request
      const mockRequest = new Request('https://example.com', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const result = await authenticateRequest(mockRequest, testSecret);
      expect(result.authenticated).toBe(true);
      expect(result.userId).toBe(testUserId);
      expect(result.organizationId).toBe(testOrganizationId);
    });

    it('should reject request without Authorization header', async () => {
      const mockRequest = new Request('https://example.com', {
        headers: {},
      });

      const result = await authenticateRequest(mockRequest, testSecret);
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('Missing');
    });

    it('should reject request with malformed Authorization header', async () => {
      const mockRequest = new Request('https://example.com', {
        headers: {
          'Authorization': 'NotBearer token',
        },
      });

      const result = await authenticateRequest(mockRequest, testSecret);
      expect(result.authenticated).toBe(false);
    });

    it('should reject request with invalid token', async () => {
      const mockRequest = new Request('https://example.com', {
        headers: {
          'Authorization': 'Bearer invalid.token.here',
        },
      });

      const result = await authenticateRequest(mockRequest, testSecret);
      expect(result.authenticated).toBe(false);
      expect(result.error).toContain('Invalid');
    });
  });

  describe('Task 7.5: Pass User ID to Backend', () => {
    it('should add x-user-id header to request', () => {
      const request = new Request('https://example.com', {
        headers: {},
      });

      const newRequest = addUserIdHeader(request, testUserId);
      expect(newRequest.headers.get('x-user-id')).toBe(String(testUserId));
    });

    it('should preserve existing headers when adding user ID', () => {
      const request = new Request('https://example.com', {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer token',
        },
      });

      const newRequest = addUserIdHeader(request, testUserId);
      expect(newRequest.headers.get('x-user-id')).toBe(String(testUserId));
      expect(newRequest.headers.get('Content-Type')).toBe('application/json');
      expect(newRequest.headers.get('Authorization')).toBe('Bearer token');
    });
  });

  describe('Task 7.4: Return 401 for Invalid Tokens', () => {
    it('should return 401 Unauthorized response', () => {
      const response = unauthorized('Test error message');
      expect(response.status).toBe(401);
    });

    it('should include WWW-Authenticate header', () => {
      const response = unauthorized();
      expect(response.headers.get('WWW-Authenticate')).toBe('Bearer realm="API"');
    });

    it('should return JSON error format', async () => {
      const response = unauthorized('Custom message');
      const body = await response.json() as any;
      
      expect(body.code).toBe('UNAUTHORIZED');
      expect(body.message).toBe('Custom message');
      expect(body.timestamp).toBeTruthy();
    });
  });

  describe('Task 7.6: Define Public Endpoints', () => {
    it('should return list of public endpoints', () => {
      const endpoints = getPublicEndpoints();
      expect(endpoints).toContain('/auth/login');
      expect(endpoints).toContain('/auth/register');
      expect(endpoints).toContain('/health');
    });

    it('should have at least some public endpoints', () => {
      const endpoints = getPublicEndpoints();
      expect(endpoints.length).toBeGreaterThan(0);
    });
  });

  describe('Task 7.1: Auth Middleware Factory', () => {
    it('should create middleware function', () => {
      const middleware = createAuthMiddleware(testSecret);
      expect(typeof middleware).toBe('function');
    });

    it('should bypass authentication for public endpoints', async () => {
      const middleware = createAuthMiddleware(testSecret);
      
      const result = await middleware(
        new Request('https://example.com'),
        { pathname: '/auth/login' }
      );

      expect(result.authenticated).toBe(true);
      expect(result.shouldBypass).toBe(true);
    });

    it('should require authentication for protected endpoints', async () => {
      const middleware = createAuthMiddleware(testSecret);
      
      const request = new Request('https://example.com/api/users', {
        headers: {},
      });

      const result = await middleware(request, { pathname: '/api/users' });
      expect(result.authenticated).toBe(false);
      expect(result.shouldBypass).toBe(false);
    });

    it('should authenticate valid token on protected endpoint', async () => {
      const middleware = createAuthMiddleware(testSecret);
      const token = await createJWT(testUserId, testOrganizationId, testSecret);

      const request = new Request('https://example.com/api/users', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const result = await middleware(request, { pathname: '/api/users' });
      expect(result.authenticated).toBe(true);
      expect(result.userId).toBe(testUserId);
      expect(result.organizationId).toBe(testOrganizationId);
      expect(result.shouldBypass).toBe(false);
    });
  });

  describe('JWT Expiration', () => {
    it('should include expiration time in token', async () => {
      const token = await createJWT(testUserId, testOrganizationId, testSecret, '24h');
      const payload = await verifyJWT(token, testSecret);
      
      expect(payload?.exp).toBeTruthy();
      expect(payload?.iat).toBeTruthy();
    });
  });

  describe('Integration: Request Flow', () => {
    it('should complete full auth flow', async () => {
      // 1. Create token
      const token = await createJWT(testUserId, testOrganizationId, testSecret, '24h');
      
      // 2. Create request with token
      let request = new Request('https://example.com/api/users', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      // 3. Authenticate
      const result = await authenticateRequest(request, testSecret);
      expect(result.authenticated).toBe(true);
      
      // 4. Add user ID to headers
      request = addUserIdHeader(request, result.userId!);
      expect(request.headers.get('x-user-id')).toBe(String(testUserId));
    });
  });
});
