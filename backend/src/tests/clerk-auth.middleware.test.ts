import { Request, Response, NextFunction } from 'express';
import {
  clerkAuth,
  clerkAuthOptional,
  ClerkAuthRequest,
} from '../middleware/clerk-auth.middleware';
import * as ClerkBackend from '@clerk/backend';

// Mock Clerk backend module
jest.mock('@clerk/backend');

// Mock environment config with CLERK_SECRET_KEY set
jest.mock('../config/environment', () => ({
  envConfig: {
    CLERK_SECRET_KEY: 'test_secret_key',
    CLERK_PUBLISHABLE_KEY: 'pk_test_example',
    CLERK_WEBHOOK_SECRET: 'whsec_test_example',
  },
}));

describe('Clerk Auth Middleware', () => {
  let mockReq: Partial<ClerkAuthRequest>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = {
      headers: {},
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Test bypass', () => {
    it('should bypass auth in test mode with TEST_AUTH_BYPASS=true', async () => {
      process.env.NODE_ENV = 'test';
      process.env.TEST_AUTH_BYPASS = 'true';

      await clerkAuth(mockReq as ClerkAuthRequest, mockRes as Response, mockNext);

      expect(mockReq.auth).toBeDefined();
      expect(mockReq.auth?.userId).toBe('user_test_123');
      expect(mockReq.auth?.username).toBe('testuser');
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled(); // No error
    });
  });

  describe('Authorization header validation', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production'; // Disable bypass
      process.env.TEST_AUTH_BYPASS = 'false';
    });

    it('should reject request with missing Authorization header', async () => {
      mockReq.headers = {};

      await clerkAuth(mockReq as ClerkAuthRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Missing or invalid Authorization header',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject request with invalid Bearer token format', async () => {
      mockReq.headers = {
        authorization: 'InvalidToken',
      };

      await clerkAuth(mockReq as ClerkAuthRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Missing or invalid Authorization header',
      });
    });
  });

  describe('Token verification', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.TEST_AUTH_BYPASS = 'false';
    });

    it('should attach Clerk user context on valid token', async () => {
      const mockToken = 'valid_token_here';
      mockReq.headers = {
        authorization: `Bearer ${mockToken}`,
      };

      const mockDecoded = {
        sub: 'user_clerk_123',
        email: 'john@example.com',
        username: 'jsmith',
        org_id: 'org_clerk_123',
      };

      (ClerkBackend.verifyToken as jest.Mock).mockResolvedValue(mockDecoded);

      await clerkAuth(mockReq as ClerkAuthRequest, mockRes as Response, mockNext);

      expect(mockReq.auth).toEqual({
        userId: 'user_clerk_123',
        email: 'john@example.com',
        username: 'jsmith',
        organizationId: 'org_clerk_123',
      });
      expect(mockReq.userId).toBe('user_clerk_123');
      expect(mockReq.userEmail).toBe('john@example.com');
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled(); // No error
    });

    it('should hydrate email from Clerk user when token has no email claim', async () => {
      const mockToken = 'valid_token_without_email';
      mockReq.headers = {
        authorization: `Bearer ${mockToken}`,
      };

      const mockDecoded = {
        sub: 'user_clerk_123',
        org_id: 'org_clerk_123',
      };
      const getUser = jest.fn().mockResolvedValue({
        primaryEmailAddress: { emailAddress: 'hydrated@example.com' },
        username: 'hydrated-user',
      });

      (ClerkBackend.verifyToken as jest.Mock).mockResolvedValue(mockDecoded);
      (ClerkBackend.createClerkClient as jest.Mock).mockReturnValue({
        users: { getUser },
      });

      await clerkAuth(mockReq as ClerkAuthRequest, mockRes as Response, mockNext);

      expect(getUser).toHaveBeenCalledWith('user_clerk_123');
      expect(mockReq.auth).toEqual({
        userId: 'user_clerk_123',
        email: 'hydrated@example.com',
        username: 'hydrated-user',
        organizationId: 'org_clerk_123',
      });
      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject request with invalid token', async () => {
      mockReq.headers = {
        authorization: 'Bearer invalid_token',
      };

      (ClerkBackend.verifyToken as jest.Mock).mockRejectedValue(
        new Error('Token verification failed'),
      );

      await clerkAuth(mockReq as ClerkAuthRequest, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Invalid or expired token',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should hydrate identity for tokens without optional email/username fields', async () => {
      mockReq.headers = {
        authorization: 'Bearer minimal_token',
      };

      const mockDecoded = {
        sub: 'user_clerk_minimal',
        // No email, username, org_id
      };

      (ClerkBackend.verifyToken as jest.Mock).mockResolvedValue(mockDecoded);
      (ClerkBackend.createClerkClient as jest.Mock).mockReturnValue({
        users: {
          getUser: jest.fn().mockResolvedValue({
            primaryEmailAddress: { emailAddress: 'minimal@example.com' },
            username: undefined,
          }),
        },
      });

      await clerkAuth(mockReq as ClerkAuthRequest, mockRes as Response, mockNext);

      expect(mockReq.auth).toEqual({
        userId: 'user_clerk_minimal',
        email: 'minimal@example.com',
        username: undefined,
        organizationId: undefined,
      });
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('Optional auth middleware', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      process.env.TEST_AUTH_BYPASS = 'false';
    });

    it('should allow requests without authorization header', async () => {
      mockReq.headers = {};

      await clerkAuthOptional(mockReq as ClerkAuthRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled(); // No error
      expect(mockReq.auth).toBeUndefined(); // No auth context attached
    });

    it('should attach auth context if valid token provided', async () => {
      mockReq.headers = {
        authorization: 'Bearer valid_token',
      };

      const mockDecoded = {
        sub: 'user_optional_123',
        email: 'test@example.com',
      };

      (ClerkBackend.verifyToken as jest.Mock).mockResolvedValue(mockDecoded);

      await clerkAuthOptional(mockReq as ClerkAuthRequest, mockRes as Response, mockNext);

      expect(mockReq.auth).toEqual({
        userId: 'user_optional_123',
        email: 'test@example.com',
        username: undefined,
        organizationId: undefined,
      });
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled(); // No error
    });

    it('should ignore verification errors and continue', async () => {
      mockReq.headers = {
        authorization: 'Bearer invalid_token',
      };

      (ClerkBackend.verifyToken as jest.Mock).mockRejectedValue(
        new Error('Token verification failed'),
      );

      await clerkAuthOptional(mockReq as ClerkAuthRequest, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled(); // Still continues
      expect(mockRes.status).not.toHaveBeenCalled(); // No error response
      expect(mockReq.auth).toBeUndefined(); // Auth context not attached
    });
  });
});
